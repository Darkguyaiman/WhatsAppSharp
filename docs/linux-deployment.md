# Linux deployment

## First installation

Supported servers: Ubuntu 22.04, 24.04, and 26.04 with systemd and Internet access. Debian 12/13 can use an existing MySQL 8+ server; automatic local database installation is Ubuntu-only. Use an architecture supported by the .NET 10 SDK, such as x64 or ARM64.

Copy the source project to the server, preserving filename capitalization. Keep `deploy.sh`, `scripts/`, and `src/` together. Omit generated `bin/` / `obj/`, `.codex-*`, and development runtime data. From the project root:

```bash
sudo bash deploy.sh --port 8080
```

Run `sudo bash deploy.sh` to choose interactively. Without a terminal, it uses the previous port, or 8080 for a first installation. Ports 1024–65535 allow the application to run as an ordinary service account. Binding defaults to `0.0.0.0` for network access. For a proxy on the same machine:

```bash
sudo bash deploy.sh --port 8080 --bind 127.0.0.1
```

The installer checks the server, installs Linux dependencies, reuses a suitable system .NET 10 SDK or downloads the current SDK from Microsoft, restores packages, and builds a Release version. The SDK includes C# and ASP.NET Core. It installs MySQL on Ubuntu and creates a dedicated database/account with a random password, then starts a systemd background service and enables reboot/crash recovery. A `/health` check must pass before setup reports success.

The service uses Production mode. Startup applies database migrations without creating demo accounts. A fresh local deployment creates a **new empty server database**; it does not transfer development data or attachments.

## Google sign-in and settings

Edit your private server configuration:

```bash
sudo nano /etc/messagingapp/app.env
```

Set `Authentication__Google__ClientId` and `Authentication__Google__ClientSecret` with your Google OAuth web application's credentials. Register `https://YOUR_DOMAIN/signin-google` as its authorized redirect URI. These credentials must come from your own Google project. Set `AllowedHosts=YOUR_DOMAIN` after configuring your domain; multiple names use semicolons.

```bash
sudo systemctl restart messagingapp
```

Settings use the simple `KEY=value` format in `.env.example`. They are read by the application, never executed as shell commands. Process environment / command-line settings take precedence. Production push needs all three `WebPush__*` settings with a stable key pair and your operational contact; see [feature configuration](features.md). Push can remain disabled while the rest of the app runs.

## HTTPS and the selected port

The selected app port serves HTTP. Open `http://YOUR_SERVER_IP:8080` for direct access and allow that TCP port through your server firewall / hosting security group. The installer does not change firewall rules, DNS, certificates, or existing proxy settings.

Public Google sign-in, microphone/camera, PWA installation, and push need HTTPS. Configure your domain and certificate through your existing Nginx, Caddy, or other HTTPS proxy, forwarding to the selected port. Bind the app to `127.0.0.1` when the proxy runs locally. For Nginx, a location inside an existing HTTPS server can use:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 100s;
    client_max_body_size 16m;
}
```

Add these settings for a trusted proxy connecting from IPv4 loopback, then restart:

```text
Hosting__TrustedProxy=127.0.0.1
Hosting__UseHttpsRedirection=true
AllowedHosts=YOUR_DOMAIN
```

Use the actual proxy IP if different. Only that address's forwarded headers are trusted. Direct HTTP access is enabled by default until HTTPS handling is configured. Reliable calls across restrictive networks also need your own TURN relay; see [features](features.md).

## Existing / external MySQL

Copy `.env.example`, fill in its `MYSQL_*` and Google OAuth settings, and supply it on first installation:

```bash
cp .env.example server.env
chmod 600 server.env
# Edit server.env before running setup.
sudo bash deploy.sh --port 8080 --database external --env-file ./server.env
```

You can supply an existing `.env` with `--env-file ./.env` if its database is reachable from Linux. External mode never installs, stops, or reconfigures your database server. It connects using your supplied account and applies pending migrations, so back up existing databases first. The account needs permission to create/use the chosen database and update its schema. `ConnectionStrings__DefaultConnection` is also supported instead of `MYSQL_*` values.

`--env-file` imports settings only on the first installation. Later edits go directly in `/etc/messagingapp/app.env` to preserve server secrets during updates. The installer forces Production mode and persistent key storage. The selected `--port` overrides copied listening-port settings. Debian 12/13 requires external mode with a MySQL 8+ server.

To transfer existing attachments, copy the contents of the old `wwwroot/uploads/` into `/var/lib/messagingapp/uploads/` and set ownership to `messagingapp:messagingapp`. Preserve existing production Data Protection keys, application name, and VAPID settings when migrating an established deployment. Windows development key stores are not automatically reused on Linux.

## Updates and port changes

Copy the new source and run setup again. It preserves the previous port, bind address, database mode, settings, and persistent data:

```bash
sudo bash deploy.sh
```

To change the port:

```bash
sudo bash deploy.sh --port 9090
```

Update your firewall/proxy and OAuth redirect origin when needed. Setup refuses a port occupied by another process. It builds before replacing the running release. If the new release fails its startup check, it restores the previous application and service when available. **Database migrations are not undone**; keep backups and use compatible migrations. Prior releases remain available for recovery.

## Commands and persistent files

```bash
sudo systemctl status messagingapp --no-pager
sudo systemctl restart messagingapp
sudo systemctl stop messagingapp
sudo systemctl start messagingapp
sudo journalctl -u messagingapp -f
curl http://127.0.0.1:8080/health
```

The public `/health` endpoint stays available over HTTP for local service readiness checks, including after HTTPS redirects are enabled. It returns only a readiness status.

| Location | Purpose |
| --- | --- |
| `/etc/messagingapp/app.env` | Private database, Google, and push configuration |
| `/etc/messagingapp/service.conf` | Installer-managed port, address, and database mode |
| `/etc/systemd/system/messagingapp.service` | Background service definition |
| `/opt/messagingapp/current` | Link to the running release |
| `/opt/messagingapp/releases/` | Published releases |
| `/opt/messagingapp/dotnet/` | SDK downloaded if a suitable system SDK is absent |
| `/var/lib/messagingapp/uploads/` | Attachments |
| `/var/lib/messagingapp/keys/` | Persistent cookie / encryption keys |
| `/var/lib/messagingapp/app-data/` | Private application data |

Back up MySQL, `/etc/messagingapp/app.env`, and `/var/lib/messagingapp/`. The app runs as `messagingapp` with writes restricted to its persistent data directory. Private settings are readable only by root and the service group. Generate production VAPID keys on a trusted machine with `dotnet run --project src/MessagingApp -- --generate-vapid-keys` and save the results in your server settings.

## Troubleshooting

- Setup failures return an error and preserve settings/data. Read `sudo journalctl -u messagingapp -n 80 --no-pager`. Fix the cause and rerun setup.
- Local database setup needs Ubuntu MySQL's root socket access. For an existing server with different administrator settings, use external mode on a fresh installation.
- Existing MySQL users' passwords are never reset. If the dedicated local account already exists with a different password, choose an unused `MYSQL_USER` in `/etc/messagingapp/app.env` before retrying, or supply its correct password. Local passwords use 24–128 letters/numbers; generated passwords use 64 characters. External mode supports ordinary single-line passwords with punctuation and spaces.
- If the port is unreachable, check the service, bind address, firewall, and hosting security group. Loopback binding accepts connections only from the same machine.
- For Google errors, check credentials, the exact HTTPS redirect URI, and forwarded HTTPS settings.
- Copy Linux migration files with their original capitalization: the folder is `Database/Migrations`.

References: [Microsoft's scripted .NET installation](https://learn.microsoft.com/en-us/dotnet/core/install/linux-scripted-manual), [ASP.NET Core hosting with systemd and Nginx](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/linux-nginx?view=aspnetcore-10.0), and [the runtime patch advisory](https://github.com/advisories/GHSA-334f-vvp4-7g6p). The installer requires ASP.NET Core 10.0.13 or newer rather than reusing an affected 10.0.12 runtime.
