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

        guard
            let roomId = request.content.userInfo["room_id"] as? String,
            let eventId = request.content.userInfo["event_id"] as? String,
            let shared = SharedState.load()
        else {
            return delivery.send(content)
        }

        Task {
            guard let event = try? await shared.context(roomId: roomId, eventId: eventId) else {
                return delivery.send(content)
            }
            event.render(into: content, roomId: roomId, preferences: shared)
            delivery.send(content)
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
/// to name the room and its sender, without a second round trip.
private struct ResolvedEvent {
    let type: String
    let sender: String
    let body: String?
    let roomName: String?
    let senderName: String?

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
        var path = "\(homeserver.hasSuffix("/") ? String(homeserver.dropLast()) : homeserver)"
        path += "/_matrix/client/v3/rooms/\(escape(roomId))/context/\(escape(eventId))?limit=0"
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
        var senderName: String?
        for stateEvent in state {
            switch stateEvent["type"] as? String {
            case "m.room.name":
                roomName = (stateEvent["content"] as? [String: Any])?["name"] as? String
            case "m.room.member" where stateEvent["state_key"] as? String == sender:
                senderName =
                    (stateEvent["content"] as? [String: Any])?["displayname"] as? String
            default:
                break
            }
        }

        return ResolvedEvent(
            type: type,
            sender: sender,
            body: content?["body"] as? String,
            roomName: roomName?.isEmpty == false ? roomName : nil,
            senderName: senderName?.isEmpty == false ? senderName : nil
        )
    }
}

// ─── Rendering ───────────────────────────────────────────────────────────────

private extension ResolvedEvent {
    /// Mirrors `notifications::format_notification` so a pushed notification
    /// reads the same as one the running app posts — same "sender in room"
    /// title, and the same two placeholders when the privacy flags are off.
    func render(into content: UNMutableNotificationContent, roomId: String, preferences: SharedState) {
        let sender = senderName ?? self.sender
        let room = roomName ?? roomId

        content.title = preferences.showSender ? "\(sender) in \(room)" : "New Message"
        content.body = renderedBody(showBody: preferences.showBody)
        // Groups a room's notifications together, the way the app's own do.
        content.threadIdentifier = roomId
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
