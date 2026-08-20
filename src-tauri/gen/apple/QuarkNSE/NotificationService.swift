import Intents
import UserNotifications

/// Turns a metadata push into something worth reading.
///
/// The pusher registers `format: event_id_only`, so all that arrives is a room
/// id and an event id — deliberately, since anything more would mean message
/// content passing through our gateway. Resolving it costs one authenticated
/// request against the homeserver.
///
/// No decryption happens here: encrypted rooms render a fixed string until the
/// Rust NSE crate lands. Everything is best-effort — any failure delivers the
/// push unmodified (the `loc-key` placeholder) rather than nothing at all.
final class NotificationService: UNNotificationServiceExtension {
    private var delivery: Delivery?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        let content = (request.content.mutableCopy() as? UNMutableNotificationContent)
            ?? UNMutableNotificationContent()
        let delivery = Delivery(handler: contentHandler, fallback: content)
        self.delivery = delivery

        let roomId = request.content.userInfo["room_id"] as? String

        // Group by room on every path, including the ones below that bail out:
        // a notification that could not be resolved still belongs to its room's
        // stack, not loose at the top of the list.
        if let roomId {
            content.threadIdentifier = roomId
        }

        guard
            let roomId,
            let eventId = request.content.userInfo["event_id"] as? String,
            let shared = SharedState.load()
        else {
            return delivery.send(content)
        }

        Task {
            guard let event = try? await shared.context(roomId: roomId, eventId: eventId) else {
                return delivery.send(content)
            }
            delivery.send(await event.render(into: content, roomId: roomId, preferences: shared))
        }
    }

    /// About 30s of wall clock, then iOS delivers whatever was last set. Hand
    /// back the unmodified content rather than a half-filled one.
    override func serviceExtensionTimeWillExpire() {
        delivery?.expire()
    }
}

// ─── Delivering exactly once ─────────────────────────────────────────────────

/// The content handler must be called once and only once, and two things race
/// to call it: the fetch finishing, and iOS running out of patience. Calling it
/// twice is undefined; never calling it drops the notification.
private final class Delivery {
    private let handler: (UNNotificationContent) -> Void
    private let fallback: UNNotificationContent
    private let lock = NSLock()
    private var sent = false

    init(handler: @escaping (UNNotificationContent) -> Void, fallback: UNNotificationContent) {
        self.handler = handler
        self.fallback = fallback
    }

    func send(_ content: UNNotificationContent) {
        lock.lock()
        let alreadySent = sent
        sent = true
        lock.unlock()
        if !alreadySent {
            handler(content)
        }
    }

    func expire() {
        send(fallback)
    }
}

// ─── What the app left in the shared container ───────────────────────────────

/// The app group is the only channel between the app and this process: an
/// extension cannot read the app's keychain, and the config directory is not
/// shared. `secrets.rs` writes both files.
private struct SharedState {
    let homeserver: String
    let accessToken: String
    let showBody: Bool
    let showSender: Bool

    private static let appGroup = "group.tel.quark.app"

    private struct Credentials: Decodable {
        let homeserver_url: String
        let access_token: String
    }

    private struct Display: Decodable {
        let show_body: Bool
        let show_sender: Bool
    }

    static func load() -> SharedState? {
        guard
            let dir = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: appGroup)
        else { return nil }

        // No credentials means logged out, or a file the device is too locked to
        // read. Either way there is nothing to fetch with.
        guard
            let data = try? Data(contentsOf: dir.appendingPathComponent("nse-credentials.json")),
            let credentials = try? JSONDecoder().decode(Credentials.self, from: data)
        else { return nil }

        // Missing display preferences fall back to showing everything, matching
        // `NotificationConfig::default`. This file is written unprotected so
        // that a locked device cannot silently turn "hide previews" back on.
        let display = (try? Data(contentsOf: dir.appendingPathComponent("nse-display.json")))
            .flatMap { try? JSONDecoder().decode(Display.self, from: $0) }

        return SharedState(
            homeserver: credentials.homeserver_url,
            accessToken: credentials.access_token,
            showBody: display?.show_body ?? true,
            showSender: display?.show_sender ?? true
        )
    }
}

// ─── Resolving the event ─────────────────────────────────────────────────────

/// What one `/context` request yields: the event itself plus enough room state
/// to name the room and its sender — and their avatars — without a second
/// round trip.
private struct ResolvedEvent {
    let type: String
    let sender: String
    let body: String?
    let roomName: String?
    let senderName: String?
    let roomAvatarMxc: String?
    let senderAvatarMxc: String?

    var isEncrypted: Bool { type == "m.room.encrypted" }
}

extension SharedState {
    /// One authenticated GET. `limit=0` asks for no surrounding messages — the
    /// event and the room state are all this needs — and the lazy-loading filter
    /// keeps the state from carrying every member of a large room, which would
    /// be the bulk of the response and most of the 24 MB an extension gets.
    func context(roomId: String, eventId: String) async throws -> ResolvedEvent? {
        if let event = try await requestContext(roomId: roomId, eventId: eventId, lazyLoad: true) {
            return event
        }
        // A homeserver that rejects the filter is worth one retry without it;
        // the alternative is every notification on that server staying generic.
        return try await requestContext(roomId: roomId, eventId: eventId, lazyLoad: false)
    }

    private func requestContext(
        roomId: String,
        eventId: String,
        lazyLoad: Bool
    ) async throws -> ResolvedEvent? {
        // Room and event ids contain `!`, `$` and `:`. Encoding everything but
        // the alphanumerics is over-broad and always correct; an unencoded room
        // id produces a 404 that reads like a permissions problem.
        let escape = { (s: String) in
            s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
        }
        var path = "\(base)/_matrix/client/v3/rooms/\(escape(roomId))/context/\(escape(eventId))?limit=0"
        if lazyLoad {
            path += "&filter=\(escape("{\"lazy_load_members\":true}"))"
        }
        guard let url = URL(string: path) else { return nil }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        // Well inside the extension's budget, leaving room to fall back.
        request.timeoutInterval = 10

        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { return nil }
        return Self.parse(data)
    }

    private var base: String {
        homeserver.hasSuffix("/") ? String(homeserver.dropLast()) : homeserver
    }

    private static func parse(_ data: Data) -> ResolvedEvent? {
        guard
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let event = root["event"] as? [String: Any],
            let type = event["type"] as? String,
            let sender = event["sender"] as? String
        else { return nil }

        let content = event["content"] as? [String: Any]
        let state = root["state"] as? [[String: Any]] ?? []

        var roomName: String?
        var roomAvatar: String?
        var senderName: String?
        var senderAvatar: String?
        for stateEvent in state {
            let stateContent = stateEvent["content"] as? [String: Any]
            switch stateEvent["type"] as? String {
            case "m.room.name":
                roomName = stateContent?["name"] as? String
            case "m.room.avatar":
                roomAvatar = stateContent?["url"] as? String
            case "m.room.member" where stateEvent["state_key"] as? String == sender:
                senderName = stateContent?["displayname"] as? String
                senderAvatar = stateContent?["avatar_url"] as? String
            default:
                break
            }
        }

        return ResolvedEvent(
            type: type,
            sender: sender,
            body: content?["body"] as? String,
            roomName: roomName?.isEmpty == false ? roomName : nil,
            senderName: senderName?.isEmpty == false ? senderName : nil,
            roomAvatarMxc: roomAvatar,
            senderAvatarMxc: senderAvatar
        )
    }

    /// Fetch an avatar thumbnail, or nil — a notification without an avatar
    /// beats one that never arrives because a media fetch hung.
    ///
    /// The authenticated media endpoint is Matrix 1.11; the unauthenticated v3
    /// path is the fallback for older homeservers.
    func thumbnail(mxc: String?) async -> INImage? {
        guard let mxc, mxc.hasPrefix("mxc://") else { return nil }
        let parts = mxc.dropFirst("mxc://".count).split(separator: "/", maxSplits: 1)
        guard parts.count == 2 else { return nil }
        let escape = { (s: Substring) in
            String(s).addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? String(s)
        }
        let suffix = "thumbnail/\(escape(parts[0]))/\(escape(parts[1]))?width=192&height=192&method=crop"

        for path in [
            "\(base)/_matrix/client/v1/media/\(suffix)",
            "\(base)/_matrix/media/v3/\(suffix)",
        ] {
            guard let url = URL(string: path) else { continue }
            var request = URLRequest(url: url)
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
            request.timeoutInterval = 5
            guard
                let (data, response) = try? await URLSession.shared.data(for: request),
                (response as? HTTPURLResponse)?.statusCode == 200,
                !data.isEmpty
            else { continue }
            return INImage(imageData: data)
        }
        return nil
    }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

private extension ResolvedEvent {
    /// Render as a communication notification — the API that gets a sender
    /// avatar and a native "sender, in group" header, the way Messages does.
    ///
    /// Falls back to plain title/body text mirroring
    /// `notifications::format_notification`, so the two paths always agree on
    /// the privacy flags: with `show_sender` off nothing identifying is shown,
    /// which also rules the intent out entirely — it exists to display exactly
    /// what that flag hides.
    func render(
        into content: UNMutableNotificationContent,
        roomId: String,
        preferences: SharedState
    ) async -> UNNotificationContent {
        let senderDisplay = senderName ?? sender

        // A DM has no m.room.name, and naming it by its room id helps nobody:
        // the sender *is* the conversation.
        content.title = preferences.showSender
            ? roomName.map { "\(senderDisplay) in \($0)" } ?? senderDisplay
            : "New Message"
        content.body = renderedBody(showBody: preferences.showBody)
        content.threadIdentifier = roomId

        guard preferences.showSender else { return content }
        return await communicationStyled(
            content, roomId: roomId, senderDisplay: senderDisplay, preferences: preferences
        )
    }

    private func communicationStyled(
        _ content: UNMutableNotificationContent,
        roomId: String,
        senderDisplay: String,
        preferences: SharedState
    ) async -> UNNotificationContent {
        // DMs wear the sender's face; named rooms wear the room's. Either way
        // the other is the fallback — a wrong avatar beats a grey monogram.
        let avatarMxc = roomName == nil
            ? (senderAvatarMxc ?? roomAvatarMxc)
            : (roomAvatarMxc ?? senderAvatarMxc)
        let avatar = await preferences.thumbnail(mxc: avatarMxc)

        let senderPerson = INPerson(
            personHandle: INPersonHandle(value: sender, type: .unknown),
            nameComponents: nil,
            displayName: senderDisplay,
            image: roomName == nil ? avatar : nil,
            contactIdentifier: nil,
            customIdentifier: sender
        )
        // The recipient is this device's user. iOS only renders the group name
        // when the intent actually describes a group — a sender alone reads as
        // a DM regardless of speakableGroupName.
        let me = INPerson(
            personHandle: INPersonHandle(value: "self", type: .unknown),
            nameComponents: nil,
            displayName: nil,
            image: nil,
            contactIdentifier: nil,
            customIdentifier: nil,
            isMe: true
        )

        let intent = INSendMessageIntent(
            recipients: [me],
            outgoingMessageType: .outgoingMessageText,
            content: content.body,
            speakableGroupName: roomName.map { INSpeakableString(spokenPhrase: $0) },
            conversationIdentifier: roomId,
            serviceName: nil,
            sender: senderPerson,
            attachments: nil
        )
        if roomName != nil, let avatar {
            intent.setImage(avatar, forParameterNamed: \.speakableGroupName)
        }

        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        try? await interaction.donate()

        // `updating(from:)` re-titles from the intent (sender name, group
        // name) and attaches the avatar. If iOS declines — the communication
        // entitlement missing is the usual cause — the plain rendering above
        // already says everything but the picture.
        return (try? content.updating(from: intent)) ?? content
    }

    private func renderedBody(showBody: Bool) -> String {
        guard showBody else { return "You have a new message" }
        if isEncrypted {
            // Phase 4 gives the extension a crypto store to open. Until then
            // this is the honest answer, not a failure.
            return "Encrypted message"
        }
        if let body = body, !body.isEmpty {
            // Lock-screen notifications are one line; a pasted stack trace
            // should not push the room name off the top of it.
            return body.replacingOccurrences(of: "\n", with: " ")
        }
        switch type {
        case "m.sticker":
            return "Sent a sticker"
        case "m.room.member":
            return "Invited you"
        default:
            return "You have a new message"
        }
    }
}
