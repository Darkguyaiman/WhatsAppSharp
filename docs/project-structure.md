# Project structure

The root folder contains the solution, setup instructions, settings template, and Linux installer. Application code lives in `src/MessagingApp`. Tests and documentation are outside the app so they cannot accidentally become part of the web application.

## Finding the right file

| If you want to change… | Start here |
| --- | --- |
| Startup, configuration, health endpoint | `src/MessagingApp/Program.cs` |
| Database connection / `.env` loading | `src/MessagingApp/Configuration/` |
| Tables or indexes | Add a numbered script in `src/MessagingApp/Database/Migrations/`; update `schema.sql` too |
| Stored data | `src/MessagingApp/Models/` and `Data/AppDbContext.cs` |
| Data sent to browsers | `src/MessagingApp/Models/TransferObjects/` |
| Login / Google accounts | `src/MessagingApp/Services/Authentication/` and `Pages/Account/` |
| Messages / conversations | `src/MessagingApp/Services/Messaging/` |
| Live updates / call signalling | `src/MessagingApp/Hubs/ChatHub.cs` |
| Voice / video coordination | `src/MessagingApp/Services/Calls/CallService.cs` and `wwwroot/js/calls.js` |
| Notifications | `src/MessagingApp/Services/Notifications/WebPushService.cs`, `wwwroot/js/pwa.js`, and `wwwroot/sw.js` |
| Upload rules | `src/MessagingApp/Services/Storage/FileStorageService.cs` |
| Chat screen / behavior | `src/MessagingApp/Pages/Chat/Index.cshtml` and `wwwroot/js/chat.js` |
| Message menus, swipe replies, delete choices, pins, stars, and notes | `src/MessagingApp/wwwroot/js/message-actions.js`, `Pages/Shared/_MessageActions.cshtml`, and `Services/Messaging/MessageActionsService.cs` |
| Desktop/mobile message-info view | `src/MessagingApp/wwwroot/js/message-info.js` and `Pages/Shared/_MessageInfo.cshtml` |
| Delivery ticks and device acknowledgements | `src/MessagingApp/wwwroot/js/message-receipts.js`, `Models/MessageDelivery.cs`, and `Pages/Api/Delivery.cshtml.cs` |
| Keep the chat at the latest message | `src/MessagingApp/wwwroot/js/chat-scroll.js` |
| Voice recording and playback | `src/MessagingApp/wwwroot/js/voice-messages.js` |
| Shared navigation / dialogs | `src/MessagingApp/Pages/Shared/` |
| Styling | `src/MessagingApp/wwwroot/css/app.css` and `site.css` |
| Linux installation | `deploy.sh` and `scripts/configure-linux.py` |
| Full application checks | `Tests/SmokeTests/Program.cs` and `TestFixtures.cs` |
| Browser checks | `Tests/*.test.mjs` (messaging, message actions, calls, and voice messages) |
| Installer checks | `Tests/test_linux_deployment.py` |

Paths abbreviated after the first path in a row are relative to `src/MessagingApp`.

## Naming conventions

- C# filenames match their main type: `MessageService.cs`, `MessageDto.cs`, `DatabaseInitializer.cs`.
- An `I` prefix means an interface: `IMessageService` describes what `MessageService` provides.
- A `Dto` suffix means data transferred between server and browser. Each type has its own file in `Models/TransferObjects`.
- Razor screens keep their paired names: `Index.cshtml` renders the screen; `Index.cshtml.cs` handles server behavior. `_` names are shared Razor pieces.
- SQL filenames begin with an ordering number. Keep applied filenames stable; `__SchemaMigrations` records them.
- Service subfolders group responsibilities. Their existing `MessagingApp.Services` namespace is shared to keep page/hub imports simple.

`DatabaseInitializer` applies migrations and removes identified legacy demo fixtures. It does not create demo accounts. Test data belongs in `Tests/SmokeTests/TestFixtures.cs`.

## Generated files and private data

| Location | Contents |
| --- | --- |
| Project `bin/` and `obj/` folders | Generated build output; do not edit or copy as source |
| Root `.env` | Private local configuration; never commit |
| `src/MessagingApp/App_Data/` | Private local push-key storage |
| `src/MessagingApp/wwwroot/uploads/` | Local user attachments; preserve if migrating data |
| `.codex-work/`, `.codex-build/`, `.impeccable/` | Ignored local tooling / working files |
| `docs/references/original-reference.png` | Original visual reference |
| `/etc/messagingapp/` on Linux | Private server settings and selected port |
| `/var/lib/messagingapp/` on Linux | Persistent uploads and encryption keys |
| `/opt/messagingapp/releases/` on Linux | Published releases |

The reorganization preserves existing local settings, uploads, and private app data. Linux deployment creates a separate installation unless you configure an existing database and transfer its files.
