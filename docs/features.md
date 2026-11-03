# WhatsAppSharp

ASP.NET Core 10, Razor Pages, SignalR, and MySQL. Includes direct and group chat, replies, editing, deletion, emoji reactions, read receipts, typing, attachments, message search, dark/light themes, and an installable PWA with standards-based web push.

Default person avatars use the first two letters of the display name; groups use the supplied WhatsApp group symbol. Each account and group gets a random, readable colour stored in MySQL. Existing rows receive a colour once during migration. Colours stay unchanged when a name changes or the app restarts, and chosen photo URLs remain in use.

## Run locally

1. Install the .NET 10 SDK and start MySQL 8 or later. The database user needs permission to create the database and apply SQL migrations from `src/MessagingApp/Database/Migrations`.
2. Copy `.env.example` to `.env` and set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_CHARSET`. The app loads `.env` on startup.
3. Start the development server:

```powershell
dotnet run --project src/MessagingApp --launch-profile http
```

Use the URL printed by the server. The app applies schema migrations without creating demo accounts. Startup removes the original seeded accounts identified by their exact username, example.com email, and known demo password, plus their messages and demo-only conversations. Other accounts remain. Development VAPID keys are generated once and stored encrypted in ignored `App_Data/vapid.protected`, outside the public web directory. Keep this file and the ASP.NET Data Protection key store across restarts.

## Google sign-in

Create a Google OAuth client with application type **Web application**. Configure the consent screen and add test users while the project is in testing. Set `Authentication__Google__ClientId` and `Authentication__Google__ClientSecret` in your ignored `.env`, environment, or secret store. Register the exact app origin plus `/signin-google` as an authorized redirect URI (for example `http://localhost:5287/signin-google`; use the actual port printed by your server). Production requires your HTTPS domain. Restart after changing credentials. [Microsoft Google OAuth setup](https://learn.microsoft.com/en-us/aspnet/core/security/authentication/social/google-logins?view=aspnetcore-10.0)

Google sign-in creates a profile on first use and recognizes returning users by their Google subject ID. Only verified Google email is accepted; existing password accounts are not automatically linked by email. Existing email collisions require an explicit account migration; Google never links an unverified password account automatically. The remember checkbox controls cookie persistence. Without both credentials, the screen explains that Google sign-in is unavailable when clicked; there is no password sign-in or local registration route. Google creates profiles on first sign-in. No Google access or refresh tokens are saved.

The login illustration is generated with the built-in image tool and saved at `src/MessagingApp/wwwroot/images/login-connect.png`; its generation prompt is recorded in `src/MessagingApp/wwwroot/images/login-assets.md`. The Google mark is a local SVG. Login follows the supplied cream background and outlined white panel reference, without QR sign-in.

Open two browser profiles, sign in as different accounts, and exchange messages. Browser tabs in the same profile share one signed-in account.

## Install and notifications

Open **Chats → Settings** using the three-dot button. Choose **Install app**, then **Enable notifications**. Notification permission is requested only after clicking that button. Settings also provides theme switching, profile access, and sign-out on mobile.

The chat shell follows the supplied current WhatsApp screenshots: charcoal panels, a compact 64px navigation rail, a responsive chat list, rounded search/composer surfaces, and the illustrated wallpaper. Favourites can be toggled from the chat header and filtered from the sidebar; they are saved per account in this browser. Group headers show current member names. The welcome illustration is the user-supplied SVG; the wallpaper is the [WhatsApp chat tile](https://web.whatsapp.com/img/bg-chat-tile-dark_a4be512e7195b6b733d9110b408f075d.png), served locally.

- Chromium browsers offer an install prompt when eligible, or an install option in the browser menu.
- On iPhone/iPad, add the site to the Home Screen first, then open that installed app to enable notifications. Apple supports Home Screen web push on iOS/iPadOS 16.4 and later. [Apple web push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)
- Installation and push require HTTPS in deployment. Localhost is supported for development. [PWA installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

Web push is sent from the server, including when no chat window is open. Notifications open the corresponding conversation. The server skips messages already marked read. Every received push displays a notification to meet Safari's user-visible requirement; notifications for a focused conversation request silent delivery. Subscriptions are stored per account and device. Expired subscriptions are removed, and sign-out removes that device's subscription. Subscription registration is authenticated and protected against cross-site requests; only recognized browser push providers are accepted. [WebKit notification requirements](https://webkit.org/blog/12945/meet-web-push/)

The navigation rail uses the supplied WhatsApp icons and order. Calls, Status, Communities, and Media now have working screens. Tools, Advertise, and the unused Channels placeholder have been removed. Welcome quick actions have 48px circular backgrounds. Escape dismisses an open overlay first, then returns an active chat to the desktop welcome screen or mobile chat list. Text, reply, and attachment drafts are restored when reopening that conversation within the current page.

The offline view explains how to reconnect. Only public assets are cached: messages, authentication pages, profile data, and uploads are never placed in the service-worker cache. Text drafts survive failed sends and conversation switching within the current page; drafts are not persisted after a reload. Offline drafts are unsent and do not receive a server-saved tick.

App updates activate automatically without an update toast. Existing pages reload quietly when there is no unsent work, edited form, open modal, recording, or active call; otherwise the reload waits until it is safe. First installation does not force a reload. Versioned assets and the updated public shell load on the next page load as well.

On phones, the chat header keeps the back, voice call, video call, and options buttons visible. Search and favourites are available in the options menu so the contact name has room. The QR scanner includes **Show my QR**, which closes the scanner, releases its camera, and opens your own contact code.

## Uploads and message rendering

Attachments and voice recordings show transfer progress while uploading. Removing a pending attachment cancels its transfer. Reaching 100% means the browser has transferred the request; the server may still be finishing it. Failed uploads leave the draft available for retry.

The authenticated upload endpoint validates the anti-forgery header before reading the multipart body, then streams the file directly to storage with a 15 MB limit. It avoids buffering the entire upload before making a second copy. Cancelled, invalid, empty, and oversized transfers remove partial files. Network bandwidth, disk speed, and reverse-proxy buffering can still affect deployed upload time.

Shared-card and voice metadata are rendered as message cards, including when JSON whitespace or property order differs. Message updates rebuild the appropriate card instead of inserting stored metadata as text. Ordinary JSON sent as a text message remains visible as text. Voice messages without a usable attachment display an unavailable state.

## Production configuration

Generate a VAPID pair once on a trusted machine:

```powershell
dotnet run --project src/MessagingApp -- --generate-vapid-keys
```

Save the resulting private key in your hosting secret store. Configure these environment variables on the server:

```text
ASPNETCORE_ENVIRONMENT=Production
MYSQL_HOST=<your MySQL host>
MYSQL_PORT=3306
MYSQL_DATABASE=<your database name>
MYSQL_USER=<your user>
MYSQL_PASSWORD=<your password>
MYSQL_CHARSET=utf8mb4
WebPush__Subject=mailto:<your actual operational email address>
WebPush__PublicKey=<generated public key>
WebPush__PrivateKey=<generated private key>
Authentication__Google__ClientId=<Google OAuth client ID>
Authentication__Google__ClientSecret=<Google OAuth client secret>
AllowedHosts=<your domain>
```

Use a stable key pair across restarts and replicas: rotating it requires devices to resubscribe. Production push remains unavailable until all three WebPush settings are present. The application works with notifications disabled and tells users that notification setup is unavailable. VAPID signing and RFC 8291 `aes128gcm` payload encryption use [Lib.Net.Http.WebPush](https://github.com/tpeczek/Lib.Net.Http.WebPush).

Publish with `dotnet publish src/MessagingApp -c Release`, configure HTTPS and WebSocket support on the host, and persist the database, `src/MessagingApp/wwwroot/uploads`, and ASP.NET Data Protection keys. When using a reverse proxy, configure trusted forwarded headers/HTTPS handling for that host. Startup applies pending scripts from `src/MessagingApp/Database/Migrations` (tracked in `__SchemaMigrations`); `src/MessagingApp/Database/schema.sql` is the full current schema for reference. Deployment must permit this or apply those scripts under your deployment process before starting. Startup stops if the database cannot initialize.

Demo seeding and demo sign-in have been removed in every environment. Smoke tests create their own fixtures only in a disposable test database.

## Performance and operational limits

- Same-origin page links use CSS View Transitions in supporting browsers, including Settings, Profile, and form pages. Chat, feature, mobile back, and settings-section changes use short CSS panel transitions. No client router, delayed navigation, or new dependency is added. Reduced-motion preferences disable the screen movement and cross-page transition. Other browsers retain normal navigation and the in-page CSS effects.

- Conversation previews load only the latest message and calculate unread counts in SQL. Group updates share one conversation snapshot and a batched unread query.
- Message history loads 50 messages at a time with a `(ConversationId, Id)` index. Earlier history loads on demand; rendering uses fragments and skips layout of messages outside the viewport.
- SignalR retries initial connection failures and reconnects, refreshing messages and unread state after recovery. Failed or unconfirmed sends retain the draft for manual retry.
- Icons and scripts are served locally, with versioned CSS/client URLs and compressed public assets. No runtime CDN dependency is required.
- Push uses a bounded in-memory queue with eight concurrent deliveries and a ten-second timeout per device. Push delivery is best effort; provider failures, a full queue, or a server restart can drop a notification. Messages remain stored and are recovered when the app reconnects. Large deployments should replace this queue with a durable outbox and retry worker.
- Presence and SignalR connection tracking run in one process. Multiple application instances require shared presence storage and a SignalR backplane; this version is intended for a single instance.
- This app is an independent WhatsApp-style messenger. It does not connect to WhatsApp accounts or implement WhatsApp's end-to-end encryption. One-to-one voice/video calls use this app's own WebRTC connection.

## Verification

```powershell
dotnet build
dotnet run --project Tests/SmokeTests
node --test Tests/*.test.mjs
```

The smoke runner starts a separate app process on a free local port, creates uniquely named test MySQL databases, exercises the real HTTP/SignalR stack, and removes only those test databases afterward. Its checks cover saved avatar colours, migration of existing data, Unicode initials, photo preservation, live ownership, read state, pagination, groups and header member names, validation, upload anti-forgery, PWA assets, subscription persistence, and sign-out cleanup. An intercepted push request verifies modern VAPID signing headers and encrypted `aes128gcm` content. Synthetic push subscriptions are never sent to external providers. Client tests cover draft retention, Escape navigation and overlay priority, late-response cancellation, safe rendering, offline fallback, and visible notification behavior. When testing an already built app, set `MESSAGINGAPP_TEST_APP_DLL` to its assembly path.

An actual notification received on a real installed device must still be verified after HTTPS deployment using a genuine browser subscription. Automated tests validate the application flow, not delivery through Apple/Google/Mozilla/Windows push infrastructure.



Google profile verification uses the v3 userinfo field `email_verified`. The complete schema import records its applied migrations, so startup does not recreate imported tables.


## Communities, status, shared media, and profile

The rail now contains Chats, Calls, Status, Groups, Communities, Media, Settings, and Profile. Tools, Advertise, and the unused Channels placeholder are removed. Calls, Status, Communities, and Media are also reachable from the phone chat list.

- Communities have an admin announcement chat and regular group conversations. Admins can create groups, add people, and appoint another admin. New members join the community’s groups; a departing member immediately loses chat and community access. The last admin must appoint a successor before leaving. Communities support up to 500 people and 25 groups.
- Status supports text (up to 700 characters) and uploaded photos, with 24-hour visibility to people who share a chat or community with the author. Each viewer is counted once. Authors can delete their updates. Expired status rows and their view records are removed by a maintenance task; uploaded files are retained because they may also be shared in chats.
- Media queries existing saved attachments across direct, group, and community chats the current account belongs to. Photos, videos, audio, and documents have server filters, filename/group-name search, download/open links, and an Open chat action. Deleted messages are excluded. Results are paged 40 at a time; no private media is copied into the service-worker cache.
- Profile now edits display name, username, about, and photo. Usernames are normalized to lowercase and must be unique, with 3–50 letters, numbers, dots, or underscores. Google email remains read-only. Photo uploads accept JPG/PNG/GIF/WebP up to 15 MB. Saving preserves cookie persistence and refreshes account claims.
- Settings has an accessible light/dark switch and a message-sound switch with a preview. Sent messages are silent. Incoming messages are silent while any app window is visible and focused, including another chat or Settings. Background windows can play the local incoming chime after a browser user interaction. If web push is enabled, system notifications own the alert and the page does not play a second chime. Closed-app alerts require enabled browser notifications and use the platform’s sound behavior. The explicit Preview sound button remains available.

## Message actions

Every sent and received message has an arrow menu with Message info, Reply, Copy (when text is available), React, Forward, Pin, Star, Add text to note, and Delete. Your own plain text messages also have Edit. Deleted messages retain Info and Delete for me. React opens a compact strip containing 👍 ❤️ 😂 😮 😢 🙏 and a plus button; only the plus button opens the full emoji picker. Business broadcast has been removed.

Each person has at most one reaction on a message. Choosing a different emoji replaces the previous selection; choosing the same emoji removes it. Migration `008_one_reaction_per_person.sql` keeps the latest existing selection (using the ID to break timestamp ties) and adds a database uniqueness rule. Reaction updates are serialized so concurrent tabs cannot create duplicate reactions.

Editing is available for 15 minutes from the original send time. Further edits never restart that window. The menu hides expired edits, and the server checks the deadline atomically when saving, including when an editor was opened before expiry.

The message menu is compact and positions itself within the message area, using available space down to the composer before moving upward. Long unbroken text, shared cards, media, and voice players can shrink within narrow desktop bubbles. Bubble tails join square outer corners so the top edge stays continuous.

On phones, swipe a message to the right to reply, or press and hold to open its menu. Vertical scrolling and audio-player controls keep their normal behavior. Desktop users choose Reply from the arrow menu. Both actions work for your own messages and other people's messages, including attachments and voice notes.

Delete uses an app dialog with Cancel and Delete for me. Delete for everyone is also available for your own messages and for group admins removing a group member's message. The server checks these permissions. Delete for me persists only for your account across devices: the message disappears from history, search, media, unread counts, previews, saved lists, and quoted content for you. Everyone else's copy stays intact. Delete for everyone replaces shared content with a deleted-message marker. A failed action stays open with an error and allows a retry.

Stars and message notes are private to your account. Find the latest 100 starred messages or notes through the chat header's options menu. The note editor separates the source message from an initially empty writing area, with a privacy label, character count, and Save/Cancel actions. Notes can contain up to 5,000 characters; clearing a note removes it from the notes list. Pins are shared with chat members, allow up to three active messages, and expire after 24 hours, seven days, or 30 days. The pinned-message bar opens the message or the list of pins.

Forward copies a message into up to five existing chats, retaining attachments and showing a Forwarded label. It omits the original reply, stars, and personal notes. Message info pushes the conversation aside on desktop and becomes a dedicated full-screen view with a Back button on phones. It shows the original bubble (including playable voice notes), recorded read and delivery times, sender, and sent time. Senders see recipients' receipts; recipients see their own. Voice-played timestamps are not recorded. Escape dismisses info before closing the chat, and mobile focus stays within the info screen.

One gray tick means the server saved the message. Two gray ticks mean another participant's device acknowledged delivery; blue ticks indicate a read receipt. Online presence alone does not advance ticks, and disconnecting does not undo recorded delivery. The app acknowledges live messages and syncs missed deliveries in bounded batches without requiring the receiving chat to be open or marking messages read. Push notifications acknowledge receipt after they are displayed, including with the app closed, using an expiring purpose-bound token rather than the current account cookie. Push-provider acceptance by itself does not count as delivery. Migration `009_delivery_receipts.sql` stores these receipts; older read receipts provide the earliest known delivery confirmation for already-read messages.

Chats follow the latest message through late content sizing, images, fonts, and pin/composer resizing. Scrolling upward or jumping to a quoted message suspends that behavior; returning to the bottom resumes it. The edit dialog has separate original-message context, a focused writing area, character count, and Save changes/Cancel actions. Empty or unchanged edits cannot be submitted, and controls stay disabled while saving.

Migration `007_message_actions.sql` adds per-account message state, shared pins, the forwarded flag, and longer emoji reaction storage. Startup applies it automatically. Integration checks exercise account privacy, delete permissions, previews/search, forwarding validation, pin limits/expiry, and live quote personalization. Client checks cover swipe ownership, scrolling/cancellation, custom delete choices, retries, note context, reaction-picker behavior, inspector response races/resizing, and foreground/background alert policy. Layouts were checked at desktop and phone widths; physical touch-device testing remains useful.

## Voice messages

Open a chat and click the microphone beside the empty composer. Allow microphone access, record, and click the red stop/preview control to listen before sending. The trash button discards the recording; the green send button sends it. Recording also stops when you switch chats, open another feature, start a call, or put the page in the background. An unsent draft stays available when you return to its chat within the same page. Reloading or closing the page clears these in-memory drafts.

Voice notes use a compact WhatsApp-style player with a measured waveform, duration, seek control, sender avatar, and 1× / 1.5× / 2× playback. Only one note plays at a time. Audio is fetched when played, rather than preloaded for every voice bubble. Replying, reactions, deletion, read receipts, live delivery, and the shared audio library use the existing messaging system. Voice notes cannot be edited, and notification previews say “Sent a voice message”.

The recording strip adapts its waveform bar count to the actual available width, keeping consistent stroke weight on wide desktop layouts and redrawing when its width changes. Live samples enter from the right; preview samples fill the track. Quiet signals are made more readable visually without changing the recording or stored waveform values. Reduced-motion settings disable the recording-dot animation.

Recordings must be between half a second and ten minutes, within the existing 15 MB attachment limit. The browser chooses a supported WebM/Opus, MP4/AAC, or Ogg/Opus recording format; no server-side transcoding is performed. Recording requires HTTPS or localhost, browser MediaRecorder support, and microphone permission. Codec support varies by device/browser. A failed send keeps the recording for a manual retry; check the chat before retrying an unconfirmed send to avoid duplicates.

The server stores `MessageType.Voice` with audio attachment details and bounded duration/waveform metadata in the existing Content column, so no database schema change is required. Recordings are ordinary server-stored attachments, not end-to-end encrypted messages. Tests cover capture lifecycle with a synthetic audio device, preview, upload, real browser playback, live delivery, validation, seeking ranges, retry preservation, and microphone denial; physical microphones and cross-device codec compatibility still need checks on your target devices.

References: [browser recording support](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder), [WhatsApp's voice-message interaction reference](https://blog.whatsapp.com/making-voice-messages-better).

## Voice and video calling

Open a **direct chat** and choose the phone or video button. You can invite someone who appears offline. Their subscribed devices receive a time-limited incoming-call push notification; tapping it opens the app, where they can answer while the invitation is still ringing. Existing open chat windows are focused without reloading drafts or active media. Calls include ringing, answer/decline, mute, camera toggle, minimize/return, elapsed time, and saved call history. Microphone/camera denial is handled with a useful message, and ending a call stops the media tracks. Group calls are not implemented.

For calls while the app is closed, the recipient must enable notifications under Settings and have an internet connection. On iPhone/iPad, install the app on the Home Screen and enable notifications there. Browser and operating-system restrictions still govern notification delivery; this web app cannot guarantee a native phone-style continuous ringtone or connect an entirely disconnected device. Opening the app restores a still-ringing invitation even without push enabled. Call pushes use a separate bounded queue, high delivery urgency, and a TTL no longer than the remaining 45-second ringing window. Delayed pushes display a missed-call message.

The installed app, browser titles, login, and settings use **WhatsAppSharp**. A shared square vector master supplies the favicon and app icons, with 192/512 px launcher icons, a full-background maskable icon, and a 180 px Apple touch icon. Existing installed shortcuts may need to be re-added if the operating system keeps an older name or icon.

Voice and video calls fill the app window on desktop and phones, with a minimize control to return to chats while the call continues. Voice calls use a centred contact view with labelled circular controls. Video calls provide a large remote-video area, a smaller mirrored self-preview, and a waiting state when the other camera is unavailable. On phones, controls stay above the device safe area.

Media uses WebRTC with echo cancellation, noise suppression, automatic gain control, and a preferred 720p/30fps camera capture. Browser congestion control is supplemented by packet-loss/jitter/round-trip statistics: weak connections lower video bitrate, resolution, and frame rate, while audio retains higher priority. Recovery attempts renegotiate ICE and preserve the call through short signaling disconnections. Ringing times out at 45 seconds; a disconnected participant gets a 35-second server grace period. Calls are limited to four hours. Server restarts mark unfinished calls as interrupted. The call coordinator is single-instance, like this app’s existing presence service; multiple servers need a shared coordinator and signaling backplane.

HTTPS (or localhost) is required. STUN can connect many peers, but a publicly reachable TURN relay is required for dependable calls across restrictive networks. Configure a coturn-compatible relay using `use-auth-secret` and a shared secret, then set the following environment values on the app server:

```text
Calls__StunUrls=stun:stun.l.google.com:19302
Calls__TurnUrls=turn:relay.your-domain:3478?transport=udp,turn:relay.your-domain:3478?transport=tcp,turns:relay.your-domain:5349?transport=tcp
Calls__TurnSharedSecret=<the relay's shared secret>
```

The app generates per-account expiring relay credentials; the shared secret is never sent to the browser. The hostname is illustrative: supply your own relay and configure its public address, certificates, UDP relay-port firewall range, and TCP/TLS listeners. [coturn configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf), [WebRTC ICE restart](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/restartIce)

Verification includes HTTP/MySQL/SignalR checks, browser-client tests, and a recorded real browser loopback with generated audio/video using the production call client. The browser check proved delivery in both directions, reduced-video sender settings, and a fresh ICE restart offer. It did not prove quality on a real weak mobile connection or across a deployed TURN relay. An actual TURN deployment and two physical-device network test remain required for those claims.

