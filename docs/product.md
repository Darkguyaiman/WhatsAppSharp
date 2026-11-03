# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner uses this as a personal messaging app in the browser: signing in, talking with people they actually know, and switching between conversations throughout the day.

## Product Purpose

A real-time web messenger modeled on WhatsApp Web. Success is sitting in a conversation, sending and receiving messages without thinking about the interface, and trusting that presence, typing, and read state are current.

## Positioning

Browser-native WhatsApp-style chat on ASP.NET Core and SignalR: 1:1 and group conversations with live delivery, presence, typing indicators, read receipts, reactions, attachments, and in-chat search — without installing a native client.

## Operating Context

Used as a desktop-first web app (full-height chat shell) with a mobile stacked view for conversation list vs thread. Google is the only sign-in entry point, and creates profiles on first sign-in. People may stay signed in and open multiple tabs. Startup no longer creates demo accounts or sample conversations.

## Capabilities and Constraints

Confirmed functionality:

- Cookie auth; Google sign-in, logout, profile (display name, editable unique username, about, and uploaded avatar). Usernames normalize to lowercase and accept 3–50 letters, numbers, dots, or underscores; profile saves preserve the cookie's persistence choice. Profile photos accept JPG, PNG, GIF, or WebP up to 15 MB.
- Google OAuth sign-in implementation provisions accounts by Google subject and requires a verified email. Existing password accounts are not automatically linked by email. Google credentials are configured locally; successful provider authentication still needs a real sign-in check.
- Default individual avatars show the first two letters of the display name; default group avatars use the supplied filled two-person SVG. Each account/group keeps a randomly assigned, saved background colour. Existing custom photos are preserved; profile offers “Use initials” for accounts with a custom photo.
- Conversation list with search; start a direct chat from contacts
- Create group conversations; group headers show current member names
- Favourite conversations and filter favourites (saved per account in the current browser)
- Real-time messages via SignalR (`/hubs/chat`)
- Online/offline presence, typing indicators, read receipts
- Reply, edit, delete, copy, emoji reactions
- File/image attachments and image lightbox
- In-chat message search
- Communities collect an admin-only announcement conversation and community groups. Admins can add members, create groups, and promote other admins; members can leave, and the final admin must appoint a replacement before leaving.
- Text/photo statuses last 24 hours, are visible to people sharing chats or communities, and support viewed state and owner deletion. Text is limited to 700 characters.
- One-to-one voice and video calls use real browser WebRTC media and SignalR signalling, with ringing, answer/decline, mute, camera control, minimize/restore, and call history. Poor connections trigger media quality adjustment and bounded ICE restart recovery.
- A shared-media library spans the signed-in user's conversations, with search, type filters, pagination, file access, and return-to-chat actions.
- Escape closes overlays first, then returns an open chat to the desktop welcome view or mobile conversation list. Text, attachment, and reply drafts are retained for reopening within the current page, not after a reload.
- Light and dark theme (persisted in localStorage)
- Accessible dark-mode and message-sound switches expose their checked state. Locally served incoming/sent WAV tones and a sound preview respect the saved sound preference and browser audio-unlock requirements; incoming message sounds avoid duplicate playback across tabs.
- Installable PWA with an offline reconnect view; authenticated, per-device web-push subscriptions and notification controls
- Settings includes installation guidance, notification permission/configuration state, theme, profile access, and sign-out, including on mobile
- Sign-in contains no demo-user shortcuts. Startup cleanup targets only the original demo fixtures using the original username/email and known password; real profiles are preserved.

Technical constraints:

- ASP.NET Core Razor Pages with locally served CSS, icons, SignalR client, and vanilla JS in `src/MessagingApp/wwwroot/js/chat.js`, `src/MessagingApp/wwwroot/js/pwa.js`, `src/MessagingApp/wwwroot/js/features.js`, `src/MessagingApp/wwwroot/js/calls.js`, and `src/MessagingApp/wwwroot/js/profile.js`; no runtime CDN dependency
- MySQL via EF Core; file uploads at `/api/upload`
- Chat folder is authorized; root redirects to `/Chat`
- Installation and push require a secure context; production push needs configured VAPID keys and a genuine browser subscription. Automated checks do not establish delivery on a real installed device.
- This independent messenger does not connect to WhatsApp accounts or implement end-to-end encryption. Calls are one-to-one; group calls are unavailable.
- Calls require HTTPS (or localhost), microphone/camera permission, compatible browsers, and reachable peer connectivity. Networks requiring a relay need a configured TURN service; the server issues ephemeral credentials and never exposes its TURN shared secret. No external relay deployment or assurance on real mobile/weak networks is implied by local synthetic WebRTC tests.
- The rail exposes Chats, Calls, Status, Groups, and Communities, with Media, Settings, and Profile in its footer. Tools and Advertise are removed. Channels have been replaced by Communities. Mobile feature navigation provides Calls, Status, Communities, and Media while the desktop rail is hidden.

Undecided / allowed to change:

- Dead or unfinished chrome may be trimmed if it makes the product feel real (for example unused more-options, empty group UI)
- Visual implementation of the WhatsApp Web identity may be replaced; the product name and WhatsApp-like messenger job stay

## Brand Commitments

The product is called **WhatsApp Web**. Keep that name and the WhatsApp Web messenger model (conversation list + thread, bubbles, presence, ticks). Do not rebrand to a different product identity.

## Evidence on Hand

- Default avatars are generated locally as SVGs. Legacy bundled placeholders under `src/MessagingApp/wwwroot/images/avatars/` are treated as defaults and render the new initials/group appearance.
- The login page uses a generated laptop/phone messaging illustration (`src/MessagingApp/wwwroot/images/login-connect.png`) and local Google and product marks. These visuals imply neither WhatsApp account integration nor end-to-end encryption.
- No real testimonials, press, or marketing assets. Do not fabricate encryption claims beyond what the app actually does (SignalR over the app’s connection; not WhatsApp-grade E2E).
- Social/profile visual checks use synthetic fixtures in an isolated database; screenshot content is neither private user data nor production startup seeding.

## Product Principles

- Feel like sitting in a real chat, not a demo of a stack.
- Presence and delivery state must be readable at a glance.
- Keep every working chat action; remove only chrome that does nothing.
- Desktop-first, with a usable one-column mobile conversation flow.
- Honest copy: no fake encryption or product claims the code does not support.



