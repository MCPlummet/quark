# Quark — A CLI-Styled Matrix Client

The authoritative spec and reference for Quark: architecture, UI layout, Matrix
feature support, the vim keybinding config syntax (`quarkrc`), theming (TOML
structure), and config files. Read it before implementing a new feature.

Work — bugs, features, and release QA — is tracked in
[GitHub issues](https://github.com/mcplummet/quark/issues), not in this file.

## Overview

Quark is a keyboard-driven, CLI-aesthetic Matrix client that renders in a GUI window (not a raw terminal) to support inline images, custom emoji, and stickers. It uses vim-style navigation throughout and offers deep theme customization.

---

## Architecture

### Stack: Tauri v2 + matrix-sdk (Rust) + Web Frontend

```
┌─────────────────────────────────────┐
│        Web Frontend (TypeScript)    │
│   Monospace / terminal-styled UI    │
│   Renders HTML, images, emoji       │
├─────────────────────────────────────┤
│          Tauri v2 IPC Bridge        │
├─────────────────────────────────────┤
│         Rust Backend (Core)         │
│   matrix-sdk  ·  Vodozemac E2EE     │
│   Sliding Sync  ·  Media cache      │
└─────────────────────────────────────┘
```

**Why Tauri over Electron?** ~10x smaller binary, ~3-5x less RAM. The Rust backend uses `matrix-sdk` directly — the same SDK powering Element X — giving us best-in-class E2EE, Sliding Sync, and protocol coverage without FFI wrappers.

**Why not a real TUI?** Inline custom emoji (`<img data-mx-emoticon>`) and stickers require rendering images inline with text flow. Terminal image protocols (Sixel/Kitty) can't do this reliably across terminals. The CLI aesthetic is achieved purely through CSS (monospace fonts, dark background, prompt-style input).

### Backend (Rust)

The backend handles all Matrix protocol interaction and exposes commands to the frontend via Tauri's IPC.

**Crates:**
- `matrix-sdk` — client, sync, room operations, E2EE (Vodozemac), Sliding Sync
- `matrix-sdk-crypto` — cross-signing, key backup, device verification
- `tauri` — windowing, IPC, system tray, file dialogs
- `serde` / `serde_json` — serialization
- `tokio` — async runtime
- `directories` — XDG-compliant config/data paths

**Responsibilities:**
- Login (OIDC via MAS + legacy password fallback)
- Sliding Sync room list management & subscriptions
- Sending/receiving messages, reactions, edits, redactions
- E2EE: device verification (SAS emoji, QR), key backup, cross-signing
- Media download/upload with authenticated media (MSC3916)
- Custom emoji/sticker pack resolution (MSC2545)
- Theme file loading and validation
- Local encrypted database — matrix-sdk SQLite store opened with a keyring-held passphrase; store key + session in the OS keyring (`secrets.rs`)

### Frontend (TypeScript)

A single-page app styled as a terminal interface. No framework required initially — vanilla TS + a lightweight reactive layer (Preact or Solid) if needed.

**Responsibilities:**
- Rendering the message timeline (text, images, replies, threads, reactions, custom emoji, stickers)
- Vim-mode input handling and command bar
- Emoji/sticker picker (keyboard-navigable)
- Theme application from user config
- Room list, member list, space hierarchy display

### Mobile lifecycle

iOS reclaims memory by killing the WKWebView's *content* process while an app is backgrounded. The app process itself survives, so the app resumes to a live window wrapping a dead page — a blank screen that nothing but a force-quit clears (#39). Tauri ≥ 2.11 implements WebKit's `webViewWebContentProcessDidTerminate:` callback and reloads the webview in response, which is why `src-tauri/Cargo.toml` floors `tauri` at `2.11` rather than `2`; dropping back to a 2.10.x lock reintroduces the blank screen.

Recovery is a full page reload, so it costs the user their scroll position and any unsent draft. The reloaded page re-runs the normal startup path — `restore_session` reads the session back out of the keyring and lands on the room list — and because `start_sync` aborts any running loop before spawning one, a reload can never leave two sync loops polling the homeserver.

### Push notifications

Desktop holds a live sync connection, so it never needs push. Mobile does: iOS
suspends a backgrounded app outright, and on Android the alternative is
`SyncForegroundService` holding the connection open — which costs battery, shows
a permanent shade entry, and loses to Doze and OEM task-killers. Push inverts
that: the homeserver POSTs to a **push gateway**, the gateway wakes the device
through the platform transport, and the device runs a bounded sync.

Two invariants shape the design.

**Nothing readable leaves the homeserver.** Every pusher registers with
`format: event_id_only` (`push.rs`), so a push carries a room id, an event id
and an unread count — no ciphertext, no sender, no room name. Turning that back
into a notification happens on-device through the existing `notify` pipeline,
which is why `notify::evaluate` is pure and transport-agnostic: the same
function serves the warm sync path and a push-woken one.

**Filtering has to be server-side.** A locally-muted room the homeserver doesn't
know about still wakes the phone for every message, only for the device to
discard it — the exact cost push exists to remove. So muting a room sets the
Matrix push rule (`commands.rs::set_room_mute`), which also syncs the mute to the
user's other clients.

**The push rule is the mute; `mute_rooms` is a cache of the attempt to set it.**
Once the rule exists it empties `push_actions`, and `notify::evaluate` drops
anything the push rules didn't select — so the room is already silenced without
consulting the local list at all. The list earns its place on exactly one path:
`set_room_mute` is best-effort, and if the rule write fails the local entry is
what stops a mute appearing to do nothing on this device. That narrow job has
three consequences worth stating, because treating the list as a general-purpose
fallback gets each of them wrong:

- **Nothing reconciles the two.** Both are written by the same command and never
  compared afterwards, so a mute set from another client is invisible here and a
  failed rule write leaves the list claiming a mute the homeserver never got.
- **The list must not be read for display.** It answers "did we try to mute this
  here", not "is this room muted", and those diverge whenever the above happens.
  UI that asks the question must ask the ruleset.
- **A failed rule write cannot stay silent.** `mute_room` / `unmute_room` return
  a `MuteOutcome` (`notifications.rs`) saying whether the rule reached the
  homeserver, and the frontend surfaces the warning. Deliberately not an `Err`:
  the change *did* take effect locally, so failing the whole call would
  misreport it. The two failures carry different messages because they cost
  different things — a failed mute only wastes battery, while a failed unmute
  leaves a rule that keeps the room silent on every client while this one shows
  it as unmuted.

Unmuting must never be the half that fails. A server-side Mute rule empties
`push_actions`, and `notify::evaluate` drops anything the push rules didn't
select — so a rule left behind after the local list says "unmuted" silences the
room permanently while the UI insists otherwise. Unmuting normally needs the
room's shape (encrypted? one-to-one?) to know which default to restore, which a
room not yet synced can't supply; rather than skip the rule, that case clears the
room's user-defined rules outright so the account default applies.

Because these each have an effect outside the config file, **`set_notification_config`
only accepts the fields Settings owns** (`NotificationConfig::with_preferences`):
enabled, preview, sender, quiet hours. Mutes, background sync and push have
dedicated commands, and the Settings dialog builds its draft from a config it
cached when it opened — so treating that draft as authoritative would let [save]
silently undo a mute or a push opt-out taken while the dialog was open.

The transports differ, and so does what each costs to run:

| Platform | Transport | Gateway | Infrastructure |
| --- | --- | --- | --- |
| Android | UnifiedPush (ntfy, NextPush, …) | the distributor's own, found by discovery, else `matrix.gateway.unifiedpush.org` | none — the UnifiedPush gateway is a protocol translator holding no secrets, so any client may use it |
| iOS | APNs | self-hosted Sygnal at `push.quark.tel` | required — only the holder of the APNs key for `tel.quark.app` can push to it |

`push_gateway_override` in `notifications.toml` beats discovery
(`push.rs::resolve_gateway`) — the escape hatch for a distributor that
advertises no Matrix gateway. It is deliberately not editable from Settings:
pointing a device at the wrong gateway silently stops push, and nothing in the
UI could explain the failure.

`app_id` is part of the deployment contract, since Sygnal keys its config
literally by that string: `tel.quark.app.android`, and `tel.quark.app.ios.dev` /
`.ios.prod` for the two APNs environments. iOS registrations also carry a
`default_payload` with `mutable-content: 1`, without which iOS never routes the
push through the notification service extension.

Push is opt-in and off by default (`push_enabled` in `notifications.toml`),
toggled in Settings → Notifications. That section appears only where the
platform is capable *and* the build wires a transport up
(`push.rs::supports_push`). Both mobile platforms now satisfy both halves —
Android through UnifiedPush, iOS through APNs — but the claims stay separate
rather than collapsing into one const, because a capable platform whose build
supplies no pushkey would otherwise advertise a toggle that can never leave
"waiting". That is exactly what iOS was between the shared plumbing landing and
the APNs transport landing. The opt-in is enforced inside
`push::register`, not by each transport remembering to check: registration is
what hands a third-party gateway this device's address, so the gate belongs on
the handing over.

**"Enabled" and "working" are different states**, and everything between them is
software Quark doesn't control — a distributor the user installs, a gateway that
may decline, a homeserver round-trip that may fail. `PushReadiness` names the
four (`off`, `no_transport`, `waiting`, `ready`) and Settings reports them
separately, because collapsing any two produces the failure push can least
afford: telling someone it works while nothing delivers it. `no_transport` earns
its own state on Android as both the likeliest cause and the only one the user
can fix — the foreground service remains the fallback there.

The ladder asks about a **registered pusher first**, ahead of the transport
probe. `transport_status` cannot distinguish a device with no distributor from
a probe that failed — the Kotlin `status` command catches its own errors and
answers with an empty list — so checking it first let a binder hiccup report a
device that was happily receiving pushes as having nothing installed. A live
pusher is positive evidence the whole chain worked, and no probe result
afterwards is better news than that.

**More than one distributor is a state, not an error.** The connector declines
to guess which installed app should carry this device's push traffic, which is
the right call and, on its own, a dead end: registration fails and readiness
sits at `waiting` with nothing the user can act on. So `PushStatus` carries the
whole `distributors` list, Settings offers it as a choice, and
`select_push_distributor` commits to one. Reporting a stall the user cannot
resolve is the failure this section exists to prevent, and it applies as much
to *too many* transports as to none.

#### Android: the cold path

A push arrives at a process that may have no Tauri in it at all, which is what
makes this more than a second sync trigger.

`PushEventService` (the connector's `PushService`; `MessagingReceiver` is
deprecated in 3.x) receives everything the distributor sends and hands messages
to `PushSyncService`, a `shortService` foreground service — a broadcast receiver
gets about ten seconds, and a cold sync that is killed partway through has spent
the battery without showing the notification it was woken for. When Android
refuses a background foreground-service start, the work runs inline on the still
alive `PushEventService` rather than being dropped. When it refuses *later* —
the start succeeded but `startForeground` did not — the service stops itself
immediately and finishes the push as an ordinary background service. Pressing on
is the one thing it must not do: a service started with `startForegroundService`
that never reaches the foreground is killed outright, so swallowing a recoverable
refusal converts it into a certain kill.

From there it crosses into Rust through `push_jni.rs`, the one place Kotlin
calls Rust without Tauri in between. It owns what Tauri would otherwise have
provided: an async runtime, a panic boundary (unwinding into the JVM is
undefined behaviour), and a logcat sink — the app's `tracing` subscriber writes
to stdout, which Android discards, and is installed by `run()`, which never
executes here. Without that sink a failing push is completely silent.

`push_wake::run_wake` then runs a **bounded sync**, not a fetch of the single
event the push named. The SDK's `Vec<Action>` extractor hands the handler the
homeserver's own push-rule evaluation, so `notify::evaluate` sees inputs
identical to the warm path — same mutes, same highlight decision, no second
decision matrix to drift — and the sync sweeps up everything else that arrived
in the same window. The rendered `NotificationSpec`s serialise back to Kotlin,
where `PushNotifier` posts them; matching the notification plugin's ids,
channels, group keys and *intent extras* is what makes a cold notification
behave like a warm one when tapped.

Three guards matter here, all of them against work this app has previously
overwhelmed its own homeserver with:

- **A warm app wins — while it is actually working.** `push_wake` keeps a
  process-wide flag set by `start_sync`, *and* a clock stamped every time the
  loop completes a sync. Deferring on the flag alone asked the wrong question:
  an Android process kept resident but frozen by Doze still owns a sync task, so
  every push stood down for a loop stalled at the top of its backoff ladder —
  push declining to work in precisely the situation it was added for. A loop
  that has not synced within `WARM_SYNC_LIVENESS_MS` no longer holds push off.
  The progress stamp comes from `sync_with_callback`, because `Client::sync`
  loops internally and returns only on error: its success arm is reached about
  as often as never.
- **A burst coalesces.** `WakeGuard` admits one push sync at a time, released on
  `Drop` so a panicking sync reopens it instead of wedging push shut.
- **One `Client` per store.** `background_client` reuses the app's client when
  there is one; two `Client`s over one store means two `OlmMachine`s, the
  documented cause of Olm-account corruption. Where no Tauri exists the cold
  client is built once and shared, through a `ClientCell` whose real job is not
  caching but refusing to build twice at once — the wake path holds `WakeGuard`
  but the distributor callbacks (`register_stored_endpoint`, `on_unregistered`)
  hold nothing, and an endpoint re-announced alongside a queued message is an
  ordinary wake-up, not an exotic race. A mutex rather than a `OnceCell`,
  because the slot also has to be *emptied*, and a `OnceCell` in a `static`
  never can be. The client owns I/O registered against the runtime each JNI
  entry point builds and drops per call, so one cached past that point would
  leave the next push driving a dead reactor; and once Tauri starts in the same
  process the app builds its own client over the same store, which is the
  two-`OlmMachine` hazard again. So it is released before a runtime goes, and
  when the app takes over.
- **Collectors come off the client again.** The cold path registers the warm
  path's own event handlers, and both clients it may register them against
  outlive the wake. A leaked handler goes on racing `events::maybe_notify` for
  `claim_notification`, and each race it wins is a notification the user never
  sees — the spec is claimed into a `Vec` nobody reads. Hence drop guards.
- **A cut-short wake still posts what it rendered.** The 20 s `WAKE_BUDGET` and
  a failing sync both used to return an error and drop everything the handlers
  had already collected. That loses those notifications permanently, not
  temporarily: matrix-sdk persists the sync token *before* it dispatches
  handlers, so by the time a spec exists the homeserver already counts this
  device as having read that far, and no later sync offers the event again. The
  collector's output therefore lives in `run_wake`, outside the future
  `timeout` can cancel, and `salvage` posts whatever is in it — still capped —
  whenever the sync ends early with something to show. The error survives only
  when there is nothing to salvage, because "empty because it timed out" and
  "empty because nothing was worth showing" are different bug reports.

**A wake can also subtract.** A counts-only push carries no event but does carry
a room id, and it is what a homeserver sends when the room was read on another
device. That is answered with a dismissal — `WakeOutcome.dismiss`, honoured by
`PushNotifier.cancelRoom` — without a client, a lease or a byte of network. The
alternative is notifications the user already dealt with elsewhere sitting in
the shade until they next open the app.

"Read elsewhere" is a claim, though, and `counts.unread` is what backs it. A
counts push whose count went *up* is a badge update, not a room the user has
dealt with, and dismissing on it would clear notifications they have never seen
— so only a count that is absent or zero dismisses (`IgnoreReason::StillUnread`
covers the rest). Absent still dismisses because not every homeserver sends
counts, and silence is not evidence the room is still waiting.

Notification dismissal asks Android for the live set rather than the in-process
registry, which only knows what *this* process posted — after a cold push it is
empty while the shade is not. The room id doubles as the notification group key
(`notify.rs`), which is what makes a dismissal addressable at all.

Gateway discovery probes the endpoint's **origin** (`unifiedpush.rs`): the path
and query identify this device's mailbox, not the server's capabilities. A
refusal (401/403/404/405/406) is trustworthy and falls back to the public
gateway, which is how a plain ntfy.sh user gets working push with no setup. A
5xx or a dead socket is *not* a refusal, and keeps the user's own host — the two
mistakes are not symmetric. Falling back would route their room and event ids
through a third party silently and durably, since the choice is persisted;
keeping their host risks an outage they can see in Settings and fix.

**Already-read is asked of the read markers, and of all four of them.** A wake
syncs a batch, so most of what it sees may already have been read elsewhere;
`already_seen` drops those. The signal has to come from the *private* receipt as
much as the public one: `mark_room_read` sends `m.read` only when the
`send_read_receipts` preference is on, while `m.read.private` always goes out.
Consulting the public receipt alone made the filter a permanent no-op for
everyone who had turned that preference off — silently, because a filter that
never fires is indistinguishable from one with nothing to do. Both receipt types
are read, unthreaded and main, and the newest wins.

#### iOS: the notification service extension

iOS has no cold path in the Android sense, because there is nothing to wake: the
app is suspended or gone, and it does not get to run. What runs instead is a
**notification service extension** (`gen/apple/QuarkNSE`), a second process iOS
launches for each push carrying `mutable-content: 1`, with roughly 30 seconds
and 24 MB to rewrite the notification before it is shown. Without that flag —
emitted in the pusher's `default_payload` by `push::apns_default_payload` — the
extension is never consulted and the user sees the `loc-key` placeholder.

The homeserver POSTs to our own Sygnal at `push.quark.tel`, which signs for APNs;
`apns.rs` is the transport module, and unlike `unifiedpush.rs` it discovers
nothing. The OS is the transport and the only gateway that can sign for
`tel.quark.app` is the one holding the APNs key, so both are constants. The
pushkey is the device token base64-encoded, because Sygnal's
`convert_device_token_to_hex` default makes it base64-*decode* what it is given;
hex registers cleanly and never delivers. `app_id` selects sandbox or production
(`tel.quark.app.ios.dev` / `.prod`) off `debug_assertions`, and must agree with
the `aps-environment` entitlement — a mismatch fails silently at APNs, visible
only in Sygnal's logs.

**Tauri owns the app delegate**, so there is no compile-time place to put the
remote-notification callbacks: `main.mm` adds them at runtime to whichever class
wry instantiated, then re-assigns the delegate to itself so UIKit re-reads which
methods exist. A token that arrives before Tauri's `setup()` has resolved a
config dir is parked in `apns.rs` and drained by `settle_pending_pushers`; APNs
does not re-issue on request, so without that the ordering would leave push dead
until the next launch.

**The extension is Swift only** — no Rust, no matrix-sdk, and so no decryption.
It resolves the room id and event id the pusher sends with one authenticated
`/context` request and renders through the same shape as
`notifications::format_notification`, so a pushed notification reads like one
the running app posts. Encrypted rooms render a fixed string; decryption needs a
crypto store the extension can open, which is a later phase.

Two things cross into it, and both go through the **app group**
(`group.tel.quark.app`), because an extension cannot read the app's keychain —
the `keyring` crate cannot set a keychain access group. `secrets.rs` writes the
homeserver and access token, marked
`NSFileProtectionCompleteUntilFirstUserAuthentication`: the default class would
make the file unreadable while the device is locked, which is precisely when
pushes arrive, so the bug would pass every hand test. It writes the
`show_body` / `show_sender` flags separately and *unprotected*, because the
failure mode of an unreadable flags file has to be showing less rather than
more. Logout deletes the credentials — a token in a shared container outlives
the session otherwise — and keeps the flags, which are a preference.

What the extension cannot do is decline to show a notification. Quiet hours are
therefore not honoured on a pushed iOS notification, and cannot be from here;
the only mechanism that can suppress delivery is a server-side push rule, which
is what room mutes already use.

#### The pusher ledger

`push.json` stores the transport address separately from the registered pusher.
`last.pushkey` is what the homeserver was told; `endpoint` is what the platform
handed us. They diverge whenever registration hasn't caught up — an endpoint
rotated while the app wasn't running — and writing the address down on arrival
is what lets registration happen at the next login instead of dying with the
process that heard about it. Switching push **off** forgets the address rather
than waiting to be told: the opt-out ends by removing the saved distributor, so
the `onUnregistered` callback that would have done it has no route home. A stale
endpoint is worse than none — `should_request_endpoint` reads it as "already
have one" and no later login ever asks the transport again.

**A pusher can outlive everything that knows about it.** It is server-side
state created by an access token, and once no local record names it, nothing can
delete it — the homeserver goes on waking a dead endpoint forever. So
`push.json` is not treated as a mirror of the homeserver but as a ledger of what
is owed:

- Registrations are keyed by `(user_id, app_id, pushkey)`. Only the account that
  created a pusher can replace or delete it, and one install can serve several
  accounts offering the *same* transport address — so without the user id a
  re-login or account switch reads its own address as already registered and
  never registers at all.
- An address is written down as a **pending delete before** the round-trip that
  creates it, and promoted to `last` only once the homeserver acknowledges. The
  window where a pusher exists that nothing remembers is what makes one
  undeletable, and a timeout cannot say which side of it we are on. Deleting a
  pusher that was never created is a no-op, so owing the delete is safe both ways.
- Deletes that can't be performed — offline, or push switched off while logged
  out — stay on the pending list rather than being dropped, and are paid off by
  `retry_pending_deletes` at the next login. Dropping them leaves a gateway
  holding a live address for a user who opted out, with nothing in the UI left to
  act on.
- `logout` unregisters *before* revoking the token, since afterwards there is
  nothing to delete with. `clear_session` can't, so it forgets the records
  instead: they went with the token, and keeping them would convince the next
  login it was already registered.
- Writes are atomic (temp file + rename) and an unreadable `push.json` is moved
  to `push.json.corrupt` rather than overwritten — it may be the only surviving
  record of a live pusher.

Reads never mint state: `get_push_status` uses `load_push_state`, so opening
Settings on desktop doesn't create a `push.json` for a platform that can never
use one.

### Mobile touch behaviour

**Nothing the user composes on pans the viewport.** With the keyboard up, iOS keeps the layout viewport at full height and lets the visual viewport be panned within it, so any drag the page doesn't consume pans the shell — including drags on a compose bar, which has nothing of its own to scroll (#33). `touch-action` handles the leaves it can, but it cannot express the rule for a region: it intersects down the tree, so `none` on `.input-bar` or the compose box would take the text field's own `pan-y` with it. `guardViewportPan` (`src/app/mobile.ts`) is the enforcement — a non-passive `touchmove` listener on a container that swallows every drag except the one element with something of its own to scroll. Three surfaces carry one, because each is a container the others don't reach into:

| Surface | Guarded element | Let through |
| --- | --- | --- |
| Main composer | `.input-bar-wrap` (`Input`) | `.input-bar__field` — it scrolls past six lines |
| Autocomplete popover | `.shortcode-preview` (`ShortcodePreview` / `MentionPreview`, mounted on `.content-area`, so outside the wrap) | itself, but only while the list actually overflows |
| Thread overlay compose row | `.thread-view__input-bar` (`ThreadView` builds its own row; it does not use `Input`) | nothing — the reply field is one line |

Adding chrome inside one of those containers needs no new `touch-action` rule. Adding a *new* compose surface does need its own guard. The guard is attached only while mobile mode is on, so desktop never pays for a blocking touch path, and it stands down while the page is pinch-zoomed, where panning is how the user reaches the rest of the shell.

**Overlays follow the pan.** The shell compensates for the pan with a transform on `#app` (`--viewport-pan`, published by `mobile.ts`). Overlays mount on `<body>` so nothing can clip them, which puts them outside that element — so they mount through `mountOverlay` (`src/ui/overlay.ts`), which tags them with `.quark-overlay` and earns them the same offset. Without it the two shear apart as the pan grows: toasts land off-screen and the emoji picker floats away from the compose bar it is anchored to. The offset uses the individual `translate` property, not `transform`, so it composes with the `translate(-50%, -50%)` that dialogs centre themselves with. The shell and the overlay layer therefore share a coordinate space that client rects do not: an overlay placed off an anchor's `getBoundingClientRect()` must subtract `viewportPan()`, or it lands a pan below its anchor.

**Pinch-zoom is off, but the layout is still zoom-aware.** The viewport meta (`user-scalable=no`, `maximum-scale=1`) disables page zoom — on iOS the meta is the only mechanism, since WebKit does not let `touch-action` suppress its page-level pinch; a body-level `touch-action: pan-x pan-y` covers engines that do honor it. Zoom can still happen regardless: Android's "force enable zoom" accessibility setting overrides the meta, and a ≤768px desktop window can be trackpad-pinched. A pinch shrinks the visual viewport to roughly `layoutHeight / scale`, which from a height difference alone is indistinguishable from an open keyboard — so `viewportMetrics` takes `visualViewport.scale` and claims neither a keyboard inset nor a pan while zoomed, and the compose guards stand down there too. `ImageLightbox` implements its own pinch-to-zoom for images in JS; the meta does not affect it.

---

## UI Design

### Layout

```
┌────┬───────────┬──────────────────────────────┐
│    │           │ #general · 42 members         │
│ S  │  Rooms    ├──────────────────────────────┤
│ P  │           │                               │
│ A  │  #general │ <alice> hey check this out    │
│ C  │  #dev     │ <alice> :custom_emoji:  ← img │
│ E  │  #random  │ <bob> ┊ replying to alice     │
│ S  │  #off-top │ <bob> ┊ nice!                 │
│    │           │ <carol> [sticker: partyblob]  │
│ 🌐 │  ──────── │ ─── reactions: 🎉 3  :cool: 2 │
│ 🎮 │  DMs      │                               │
│ 🏠 │  @friend  │ :> I love :parti|             │
│    │           │ ┌────────────────┐            │
│    │           │ │ 🎉 :partyblob: │ ← preview  │
│    │           │ │ 🥳 :partytime: │            │
│    │           │ └────────────────┘            │
└────┴───────────┴──────────────────────────────┘
```

All panels, borders, and text use monospace rendering. Colors, borders, and glyph styles are controlled by themes.

### Spaces (Cinny-Style)

The room list has a two-column layout inspired by Cinny:

**Left strip — Space selector:**
- Narrow vertical strip showing space icons (avatar images or first-letter fallback)
- A "Home" icon at the top for rooms not in any space, and a "DMs" icon
- Spaces display their avatar/icon; this is the only place icons appear in the room list
- `j/k` (or rebound keys) to navigate spaces, `Enter` to select
- Selecting a space filters the room list to show only that space's children
- Each space remembers its own last-active chat: switching to a space loads that
  chat into the timeline (or its first room on first visit), so the timeline
  never lingers on a room from the space you just left. Memory is session-only.

**Right column — Room list (text only, no icons):**
- Rooms listed by name in a **fixed, deterministic order** (not sorted by activity):
  - Order follows the `m.space.child` state event `order` field if set
  - Fallback: alphabetical by room name
  - User can pin rooms to top via `:pin` command
- No room avatars or icons — text only, matching the CLI aesthetic
- Unread indicators via color (theme-configurable) and optional badge count
- Nested spaces shown as indented sections with collapsible headers
- Categories/sections within a space rendered as visual dividers (using `m.space.child` ordering)

This mirrors Cinny's approach: spaces have visual identity through icons, but the channel list itself is clean text in a stable order, so rooms don't jump around based on activity.

### Vim-Style Navigation

**Modes:**
- **Normal** — navigate rooms, scroll messages, select items
- **Insert** — compose messages in the input bar
- **Command** — `:` prefix for client commands
- **Visual** — select text/messages for quoting or copying

**Key bindings (defaults, all rebindable via quarkrc — see below):**

| Context       | Key           | Action                        |
|---------------|---------------|-------------------------------|
| Global        | `i`           | Enter insert mode             |
| Global        | `Esc`         | Return to normal mode         |
| Global        | `:`           | Open command bar              |
| Room list     | `j/k`         | Move down/up                  |
| Room list     | `Enter`       | Open room                     |
| Room list     | `/`           | Search/filter rooms           |
| Room list     | `gs`          | Go to spaces view             |
| Timeline      | `j/k`         | Scroll down/up                |
| Timeline      | `g/G`         | Jump to top/bottom            |
| Timeline      | `r`           | Reply to selected message     |
| Timeline      | `e`           | React to selected message     |
| Timeline      | `t`           | Open/enter thread             |
| Timeline      | `dd`          | Redact own message            |
| Timeline      | `E` / `c`     | Edit own message              |
| Insert        | `Ctrl-e`      | Open emoji/sticker picker     |
| Insert        | `Ctrl-g`      | Open GIF search               |
| Insert        | `Tab`         | Autocomplete :shortcode:      |
| Insert        | `Enter`       | Send staged image (typed text = caption) |
| Insert        | `Esc`         | Discard staged image (first press)       |
| Picker        | `j/k/h/l`     | Navigate grid                 |
| Picker        | `Enter`       | Select emoji/sticker/GIF      |
| Picker        | `/`           | Search within picker          |
| Picker        | `Tab`         | Switch emoji ↔ sticker ↔ GIF  |

**Compose box ↔ timeline:** with a draft in the compose box, `Esc` drops into
Normal-mode editing of the draft (vim motions/operators on the text). The
compose box then behaves like the message just below the timeline — pressing the
up key (`k`) on the draft's first line moves focus up into the timeline, and the
down key (`j`) past the last message drops back into the draft (caret at the
top). `i` resumes editing. An empty compose box is left untouched by `j` at the
bottom of the timeline; press `i` to start composing.

### Keybinding Configuration (quarkrc)

Keybindings are configured via `~/.config/quark/quarkrc`, using a vimrc-inspired syntax. This file is sourced on startup and on `:source` command.

```vim
" ~/.config/quark/quarkrc

" Remap navigation to ijkl (scandalous but valid)
nmap i     mode-insert
nmap j     nav-left
nmap k     nav-down
nmap l     nav-up        " yes, really
nmap ;     nav-right

" Context-scoped mappings
tmap k     scroll-down          " timeline: scroll down
tmap l     scroll-up            " timeline: scroll up
rmap k     room-next            " room list: next room
rmap l     room-prev            " room list: prev room
pmap k     picker-down          " picker: move down
pmap l     picker-up            " picker: move up
pmap j     picker-left          " picker: move left
pmap ;     picker-right         " picker: move right

" Multi-key sequences
nmap gg    jump-top
nmap G     jump-bottom
nmap dd    redact

" Leader key (default: space)
let mapleader = " "
nmap <leader>e  emoji-picker
nmap <leader>g  gif-search
nmap <leader>s  sticker-picker
nmap <leader>t  thread-open
nmap <leader>v  verify-device

" Unmap a default binding
nunmap gs

" Set options (like :set in vim)
set scrolloff=5               " keep 5 messages visible above/below cursor
set shortcode_preview=true    " show emoji preview while typing :shortcode:
set gif_provider=tenor        " tenor | giphy
set gif_rating=pg             " g | pg | pg-13 | r
set home_dm_limit=12          " chats shown on the Home canvas
```

**Map command syntax:**
- `nmap` — normal mode mapping
- `imap` — insert mode mapping
- `tmap` — timeline-scoped mapping (normal mode, timeline focused)
- `rmap` — room list-scoped mapping (normal mode, room list focused)
- `pmap` — picker-scoped mapping (emoji/sticker/GIF picker)
- `cmap` — command mode mapping
- `vmap` — visual mode mapping
- `nunmap`, `iunmap`, etc. — remove a mapping
- `noremap` variants (`nnoremap`, etc.) — non-recursive mappings

Scoped maps (`tmap`, `rmap`, `pmap`) take precedence over global `nmap` when that panel is focused. This allows the same key to do different things depending on context.

**quarkrc also supports:**
- `source <path>` — include another rc file
- `colorscheme <name>` — shorthand for `:theme`
- `set <option>=<value>` — set config options inline
- `" comments` — lines starting with `"` are ignored
- `autocmd` — hooks for events (e.g., `autocmd RoomEnter * set scrolloff=3`)

### Commands

```
:join #room:server.org       Join a room
:leave                       Leave current room
:topic <text>                Set room topic
:invite @user:server.org     Invite user
:verify                      Start device verification
:upload <path>               Upload file/image
:theme <name>                Switch theme
:keys                        Show/edit keybindings
:stickers                    Browse sticker packs
:emoji                       Manage emoji packs
:gif <query>                 Search and send a GIF
:search [query]              Search messages in the current room
:source <path>               Reload quarkrc or source a file
:roomsettings                Open room settings (name/topic/access/permissions)
:spacesettings               Open space settings (name/topic/children)
:debug                       Open debug viewer for current room state events
:debug $eventId              Open debug viewer for a specific event
:version                     Show the current app version
```

### Settings Dialog

Opened via `:settings` or the settings UI affordance. The dialog has eight tabs, rendered in this order:

| Tab | Contents |
|-----|----------|
| **General** | Theme selector, notification toggles, send-key behaviour, read-receipt toggles, confirm-redact toggle |
| **Account** | Devices & Verification — see below |
| **Media** | Image auto-load, max dimensions, cache-size limit |
| **GIF** | Provider (Tenor / Giphy / Klipy), API key, content rating |
| **Emoji** | Shortcode autocomplete toggle, minimum-character threshold |
| **Notifications** | Quiet-hours window, per-room mute list |
| **Themes** | Theme picker and hot-reload path |
| **About** | App version, Quark on GitHub link, Updates section (desktop only — see below) |

The tab strip never scrolls horizontally; long option text is constrained within each tab's panel.

#### Account tab — Devices & Verification

- **Session list** — all devices registered on the account, each showing: display name, last-seen timestamp + IP address, and a trust badge (verified / unverified / unknown).
- **Rename device** — edit the display name of your current device or any other session.
- **Remove session** — delete another device; requires password re-authentication (UIAA).
- **Verify another user** — enter a `@user:server` Matrix ID to initiate SAS emoji verification with that user's device.
- **Reset cross-signing** — regenerates cross-signing keys; requires password re-authentication (UIAA).
- **Key backup status** — read-only line showing whether backup is enabled and whether a backup exists on the server (`Backup: enabled/disabled · on server: yes/no`). Enabling or restoring key backup from the settings UI is not yet supported.
- **Prompt to verify on startup** — toggle (moved here from General).
- **Log out** — ends the current session and returns to the login screen.

#### About tab

Shows the running app version, a "Quark on GitHub" link (opens in the system browser), and the **Updates** section. The Updates section (release channel dropdown + auto-check toggle) is shown on **desktop only**; it is hidden on mobile, where in-app updates are not supported.

---

## Matrix Feature Support

### Core Protocol
- [x] Login: OIDC (MAS) + legacy password + SSO
- [x] Sliding Sync (MSC4186) — native, no proxy
- [x] E2EE: Megolm via Vodozemac, cross-signing, key backup (SSSS)
- [x] Device verification: SAS emoji, QR code
- [x] Room creation, join, leave, invite, kick, ban
- [x] Room directory & federated room search
- [x] In-room message search — header search box (`:search`) with four tiers: loaded window (instant) · local cache (matrix-sdk event cache, offline) · back-to-date · entire history. Server tiers stream results one page at a time (bounded memory) and are cancelable.
- [x] Spaces: hierarchy display, space-scoped room lists, restricted joins
- [x] Threads (m.thread relation)
- [x] Rich replies (m.in_reply_to)
- [x] Reactions (m.annotation) — Unicode + custom emoji
- [x] Message editing & redaction
- [x] Read receipts (public m.read + private m.read.private) — displayed Element-style as shifting, overlapping avatars at the bottom-right of each other user's last-read message (seeded on room open via `get_room_receipts`, updated live). Settings toggles: "send my read receipts" (private-only when off) and "show others' read receipts".
- [x] Typing indicators
- [x] Presence (when homeserver enables it)
- [x] Authenticated media (MSC3916)
- [x] Room summary previews (MSC3266)

### Custom Emoji & Stickers (MSC2545 — im.ponies)

Full compatibility with Cinny, FluffyChat, Nheko, and SchildiChat.

**Pack sources:**
- `im.ponies.room_emotes` — room state events (per-room packs)
- `im.ponies.user_emotes` — account data (personal packs)
- Packs distinguish emoji (`usage: ["emoticon"]`) from stickers (`usage: ["sticker"]`)

**Sending custom emoji in messages:**
- User types `:shortcode:` → autocomplete resolves from available packs
- Sent as `formatted_body` HTML: `<img data-mx-emoticon height="32" src="mxc://..." alt=":shortcode:" title=":shortcode:" />`
- Plain `body` contains `:shortcode:` as fallback
- Format field: `org.matrix.custom.html`

**Sending stickers:**
- Sticker picker (keyboard-navigable grid) sourced from packs with `usage: ["sticker"]`
- Sent as `m.sticker` event with `url` (mxc://), `body`, and `info` (mimetype, dimensions, thumbnail)
- Rendered in timeline at larger size than emoji, standalone (not inline with text)

**Custom emoji in reactions:**
- Reaction key is `:shortcode:`
- Client resolves the mxc:// URL from loaded packs for display
- Falls back to text `:shortcode:` if pack not available

**Custom emoji in replies:**
- Reply preview renders custom emoji images inline
- `<mx-reply>` fallback contains `:shortcode:` text

**Pack management UI:**
- View available packs (room + personal)
- Create/edit personal packs (set state on account data)
- Create/edit room packs (if user has state event permissions)
- Import packs from other rooms

### GIF Search

Discord-style integrated GIF search, accessible from insert mode or command bar.

**Providers (configurable in quarkrc):**
- Tenor (default) — `set gif_provider=tenor`
- Giphy — `set gif_provider=giphy`
- Klipy — `set gif_provider=klipy`
- Content rating filter: `set gif_rating=pg` (g / pg / pg-13 / r)

**UX flow:**
1. User presses `Ctrl-g` (insert mode) or runs `:gif <query>`
2. A search overlay appears with a text input and a grid of GIF thumbnails
3. Thumbnails are animated previews (low-res for performance)
4. Navigate grid with `j/k/h/l`, search with `/`, send with `Enter`
5. `Tab` to load more results, `Esc` to dismiss
6. Selected GIF is uploaded to the homeserver as media and sent as an `m.image` event with `info.mimetype: "image/gif"` — this avoids linking to external URLs that may break or track users

**Backend:**
- Rust backend handles API calls to Tenor/Giphy/Klipy (API keys stored in config)
- Downloads selected GIF, uploads to homeserver via media API
- Caches recent search results and thumbnails locally

### Emoji Shortcode Preview

When the user types `:` followed by characters in insert mode, an inline autocomplete popup appears:

```
:> I think this is :aweso|
  ┌──────────────────────────┐
  │ 😎  :awesome:            │  ← Unicode emoji
  │ [img] :awesome_face:     │  ← Custom emoji (shows image)
  │ 🌟  :awesome_star:       │
  └──────────────────────────┘
```

- Each row shows the emoji **image or glyph** alongside the `:shortcode:`
- Custom emoji display their actual `mxc://` image thumbnail (small, inline)
- Unicode emoji display the native glyph
- List updates as user types, fuzzy-matched against all available packs
- `Tab` / arrow keys to select, `Enter` to insert, `Esc` to dismiss
- Triggered after `shortcode_min_chars` characters (default: 2, configurable via `set shortcode_min_chars=2` in quarkrc)
- Sources: Unicode emoji database + `im.ponies.user_emotes` + `im.ponies.room_emotes` from current room

### Media Handling
- Authenticated media download via `/_matrix/client/v1/media/download/`
- Inline image previews in timeline (configurable max dimensions)
- **Image attachments & captions (MSC2530):** pasting an image — or picking one
  via the attach button — stages it in a preview above the compose bar rather
  than sending immediately. Enter (or the ➤ / preview Send button) sends it;
  any text typed first becomes the caption, sent as a single `m.image` with
  `body` = caption and `filename` = original name (no caption ⇒ `body` =
  filename, `filename` omitted). The first `Esc` discards the staged image
  (modal-close semantics — mode, reply, and edit state untouched); staging a
  second image replaces the first, keeping the typed caption. An armed reply
  attaches to the image send and clears on success; a failed send restores the
  staged image and caption to the composer. Committing an inline edit takes
  precedence — the staged image stays pending. Staged images persist across
  room switches like text drafts and send to the room current at send time.
  Videos and non-image files still upload immediately. Known limitation: with
  a thread open, images post to the main timeline (no thread relation).
- Hovering a message reveals the exact send time (HH:MM:SS) in the action bar;
  its tooltip (and the header timestamps') shows the full localized date
- Inline video playback — `m.video` plays inline and seekable: a loopback HTTP server (Range requests) on Linux/WebKitGTK, the asset protocol on macOS/Windows/iOS; graceful fallback to the external player on decode failure
- Sticker rendering (larger than emoji, centered)
- Image uploads with thumbnail generation
- Blurhash placeholders during loading
- Media cache on disk with configurable size limit

### Not in Scope (v1)
- VoIP / MatrixRTC (group calls) — fundamentally incompatible with CLI aesthetic
- Widgets — no iframe support in terminal-styled UI

---

## Theming

Themes are TOML files stored in `~/.config/quark/themes/`. The active theme is set in `~/.config/quark/config.toml`.

### Theme File Structure

```toml
[meta]
name = "Phosphor"
author = "user"
version = "1.0"

[colors]
background = "#0a0a0a"
foreground = "#b0b0b0"
cursor = "#00ff41"
selection_bg = "#1a3a1a"
selection_fg = "#00ff41"
border = "#333333"

[colors.accent]
primary = "#00ff41"
secondary = "#00aaff"
error = "#ff3333"
warning = "#ffaa00"
success = "#00ff41"
link = "#00aaff"

[colors.messages]
own = "#00ff41"
other = "#b0b0b0"
system = "#555555"
timestamp = "#444444"
mention_bg = "#1a1a00"
mention_fg = "#ffaa00"
reply_border = "#555555"
thread_indicator = "#00aaff"

[colors.roomlist]
active_bg = "#1a1a1a"
active_fg = "#00ff41"
unread = "#ffffff"
mention_badge = "#ff3333"
muted = "#444444"

[colors.reactions]
background = "#1a1a1a"
border = "#333333"
own_bg = "#1a3a1a"
count = "#888888"

[typography]
font_family = "JetBrains Mono, Fira Code, monospace"
font_size = 14
line_height = 1.5
message_spacing = 4           # px between messages

[borders]
style = "single"              # single | double | rounded | ascii | none
room_list_width = "25%"

[emoji]
size = 32                     # px, inline custom emoji height
sticker_max_size = 256        # px, max sticker dimension
reaction_size = 20            # px, emoji in reaction bar

[prompt]
symbol = ":>"                 # input prompt glyph
normal_indicator = "NOR"      # mode indicator in normal mode
insert_indicator = "INS"
command_indicator = "CMD"
visual_indicator = "VIS"
```

### Built-in Themes
- **Phosphor** — green-on-black CRT terminal
- **Amber** — amber phosphor CRT
- **Dracula** — based on Dracula color scheme
- **Nord** — based on Nord palette
- **Solarized Dark / Light**
- **Catppuccin Mocha / Latte**
- **Gruvbox Dark**
- **High Contrast** — accessibility-focused

### Theme Hot-Reloading
Themes reload on file save (watched via `notify` crate / filesystem events passed through Tauri). No restart required.

---

## Configuration

`~/.config/quark/config.toml`:

```toml
[general]
theme = "phosphor"
notifications = true
confirm_redact = true
send_key_behavior = "auto"    # auto | enter | newline — what the Enter key does
                              #   auto:    send on desktop, newline on mobile
                              #   enter:   always send (Shift+Enter inserts a newline)
                              #   newline: always newline (send via button / Ctrl·Cmd+Enter)
                              # A dedicated send button appears on mobile, or whenever
                              # Enter won't send. Also: `:set send_key_behavior=…` and
                              # Settings → General → Input.

[sync]
sliding_sync = true           # use Sliding Sync (MSC4186)
timeline_limit = 50           # initial messages to load per room

[media]
auto_load_images = true
max_image_width = 600
max_image_height = 400
sticker_max_size = 256
cache_size_mb = 500

[gif]
provider = "tenor"            # tenor | giphy
api_key = ""                  # user provides their own API key
rating = "pg"                 # g | pg | pg-13 | r
cache_results = true

[emoji]
shortcode_autocomplete = true
autocomplete_min_chars = 2    # chars before autocomplete triggers

[home]
dm_limit = 12                 # chats shown on the Home canvas

[cache]
image_memory_mb = 150         # in-memory cap for decoded message images
timeline_rooms = 30           # rooms kept in memory for instant re-open

[updater]
channel = "stable"            # stable | beta — which release channel to follow
auto_check = true             # check for an update shortly after sync starts

# Keybindings are configured in ~/.config/quark/quarkrc (see Keybinding Configuration)
# NOT in this file — quarkrc uses vimrc-style syntax for full flexibility
```

---

## Auto-update

Desktop builds update themselves in-app over two release channels:

- **stable** — final tags only (`vX.Y.Z`).
- **beta** — early releases (`vX.Y.Z-beta.N`) *and* every stable release.

A release feeds the channels by tag shape: a final tag (`v1.2.3`) publishes to **both** stable and beta; a pre-release (`v1.2.3-beta.4`) publishes to **beta only**. Each channel is a static manifest served from the project site:

```
https://quark.tel/updates/stable/latest.json
https://quark.tel/updates/beta/latest.json
```

The manifest follows Tauri's static-update schema (`version`, `pub_date`, and a `platforms` map of `{ signature, url }` keyed by target triple). Update payloads are signed with a minisign key; the public key is embedded in the app, so a tampered or unsigned bundle is rejected.

### UX — notify and confirm

Quark never installs silently. When `auto_check` is on, it checks the configured channel a few seconds after sync starts; `:update` runs the same check on demand. If an update is available, a non-modal banner offers **Install & restart** (downloads, installs, and relaunches) or **Later** (dismisses — the same version won't re-nag until you run `:update` again). A failed download leaves the offer in place so it can be retried.

### Configuration

The `[updater]` section (above) holds the prefs; both are also editable live:

- `:set update_channel=stable|beta`
- `:set auto_update=true|false`
- Settings → About → **Updates** (channel dropdown + auto-check toggle; desktop only — hidden on mobile).

### Platform scope

In-app update covers the **AppImage** (Linux x86_64), the **`.app`** (macOS Apple-Silicon / `aarch64` only), and the **NSIS `-setup.exe`** (Windows x86_64). `.deb`/`.rpm`/Flatpak/Android builds update through their own package channels, not this updater. macOS auto-update is best-effort until Apple notarization is configured (Gatekeeper may still warn on a freshly downloaded build).

**Immutable installs** (Flatpak, Snap, Nix) are detected at runtime — `FLATPAK_ID`/`/.flatpak-info`, `SNAP`, an executable under `/nix/store`, or the `QUARK_IMMUTABLE_INSTALL=1` env var (set by the Nix wrapper) — and the updater disables itself: `update_check` reports "no update", `:update` explains that updates come from the system package manager, and Settings → About swaps the Updates controls for the same hint (the `update_supported` IPC command carries the flag to the frontend).

### F-Droid repository (Android)

Android updates ship through a **self-hosted F-Droid repository** at `https://quark.tel/fdroid/repo` (added in an F-Droid client via that URL plus the repo fingerprint). It is not the official f-droid.org repo — no submission or review is involved.

The repo is assembled on every Pages deploy (`pages.yml`): CI downloads the newest published release's `*-android.apk` from GitHub Releases, then `fdroid update` (config in `fdroid/`) generates and signs the package index into the Pages artifact — no APK or index is ever committed to git. Two signing keys are involved: the APK key (`ANDROID_KEYSTORE_*` secrets, signs the app) and the repo key (`FDROID_KEYSTORE_*` secrets, signs the index; its certificate's SHA-256 is the pinned fingerprint users add). If the F-Droid secrets are absent the site deploys without `/fdroid/repo`. App listing metadata (name, description, license) lives in `fdroid/metadata/tel.quark.app.yml`.

---

## Project Structure

```
quark/
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs           # Tauri entry point
│   │   ├── matrix/           # Matrix client logic
│   │   │   ├── client.rs     # Login, sync, session management
│   │   │   ├── rooms.rs      # Room operations
│   │   │   ├── timeline.rs   # Message timeline handling
│   │   │   ├── threads.rs    # Thread support
│   │   │   ├── reactions.rs  # Reactions (Unicode + custom emoji)
│   │   │   ├── emoji.rs      # MSC2545 pack resolution
│   │   │   ├── stickers.rs   # Sticker pack handling & sending
│   │   │   ├── media.rs      # Authenticated media, cache
│   │   │   ├── crypto.rs     # E2EE, verification, key backup
│   │   │   └── spaces.rs     # Space hierarchy
│   │   ├── gif/              # GIF search integration
│   │   │   ├── mod.rs
│   │   │   ├── tenor.rs      # Tenor API client
│   │   │   ├── giphy.rs      # Giphy API client
│   │   │   └── klipy.rs      # Klipy API client
│   │   ├── config/           # Config & theme loading
│   │   │   ├── mod.rs
│   │   │   ├── theme.rs      # Theme parsing, validation
│   │   │   └── quarkrc.rs    # vimrc-style keybinding parser
│   │   └── commands.rs       # Tauri IPC command handlers
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                      # Web frontend
│   ├── index.html
│   ├── main.ts               # Entry point, Tauri IPC bindings
│   ├── ui/
│   │   ├── App.ts            # Root layout (room list + timeline + input)
│   │   ├── ModalManager.ts   # Open-overlay registry (replaces isVisible switchyards)
│   │   ├── DialogBase.ts     # Shared dialog chrome: overlay, header, Esc, form rows
│   │   ├── PickerBase.ts     # Shared picker overlay + keymap-driven SelectionList
│   │   ├── RoomList.ts       # Room list panel
│   │   ├── Timeline.ts       # Message rendering
│   │   ├── MessageRow.ts     # Single message (text, images, emoji)
│   │   ├── ReplyPreview.ts   # Inline reply rendering
│   │   ├── ThreadView.ts     # Thread timeline
│   │   ├── Reactions.ts      # Reaction bar
│   │   ├── Input.ts          # Compose bar with mode indicator
│   │   ├── EmojiPicker.ts    # Keyboard-navigable emoji/sticker picker
│   │   ├── StickerPicker.ts  # Sticker grid browser
│   │   ├── GifPicker.ts      # GIF search overlay
│   │   ├── ShortcodePreview.ts # Inline emoji preview popup
│   │   ├── MemberList.ts     # Room member sidebar
│   │   └── Verification.ts   # SAS/QR verification UI
│   ├── vim/
│   │   ├── mode.ts           # Mode state machine
│   │   ├── keybindings.ts    # Keymap resolution
│   │   └── commands.ts       # : command parser
│   ├── theme/
│   │   ├── loader.ts         # Apply theme from backend
│   │   └── vars.css          # CSS custom properties
│   └── style/
│       └── base.css          # Monospace terminal base styles
├── themes/                   # Built-in theme files
│   ├── phosphor.toml
│   ├── amber.toml
│   ├── dracula.toml
│   └── ...
└── README.md
```
