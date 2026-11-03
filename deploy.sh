#!/usr/bin/env bash
# One-command Ubuntu deployment. See docs/linux-deployment.md.
set -Eeuo pipefail
umask 027

usage() {
    cat <<'HELP'
Usage: sudo bash deploy.sh [--port 8080] [--bind 0.0.0.0]
                          [--database local|external] [--env-file /path/app.env]

Installs dependencies, builds the app, and starts the messagingapp systemd service.
Ubuntu 22.04, 24.04, 26.04: automatic local MySQL installation (default).
Debian 12, 13: use --database external with an existing MySQL 8+ server.
The .NET 10 SDK includes the C# compiler; no separate C# installation is needed.

Without --port: prompts in a terminal; reuses the previous port or 8080 otherwise.
Settings: /etc/messagingapp/app.env    Data: /var/lib/messagingapp
Logs: sudo journalctl -u messagingapp -f
HELP
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
log() { printf '\n%s\n' "$*"; }

port=''
bind=''
database=''
env_file=''
while (($#)); do
    case "$1" in
        --help|-h) usage; exit 0 ;;
        --port|--bind|--database|--env-file)
            (($# >= 2)) || die "$1 requires a value."
            case "$1" in
                --port) port=$2 ;;
                --bind) bind=$2 ;;
                --database) database=$2 ;;
                --env-file) env_file=$2 ;;
            esac
            shift 2 ;;
        *) die "Unknown option: $1. Use --help." ;;
    esac
done

# Validate options before requesting privileges or changing the machine.
if [[ -n $port ]]; then
    [[ $port =~ ^[0-9]{1,5}$ ]] || die 'Port must be a number from 1024 to 65535.'
    ((10#$port >= 1024 && 10#$port <= 65535)) || die 'Port must be from 1024 to 65535.'
fi
[[ -z $bind || $bind == 0.0.0.0 || $bind == 127.0.0.1 ]] || die '--bind must be 0.0.0.0 or 127.0.0.1.'
[[ -z $database || $database == local || $database == external ]] || die '--database must be local or external.'
[[ $(uname -s) == Linux ]] || die 'Run this installer on a Linux server.'
[[ $EUID -eq 0 ]] || die 'Run with sudo: sudo bash deploy.sh --port 8080'
[[ -d /run/systemd/system ]] || die 'This installer requires systemd (a normal Linux server or VM).'

source /etc/os-release
case "$ID:$VERSION_ID" in
    ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;;
    *) die 'Supported: Ubuntu 22.04/24.04/26.04, or Debian 12/13 with external MySQL.' ;;
esac

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
project="$project_root/src/MessagingApp/MessagingApp.csproj"
[[ -f $project ]] || die 'Keep deploy.sh in the project root beside src/ and scripts/.'
if [[ -n $env_file ]]; then
    [[ -f $env_file ]] || die '--env-file must point to an existing file.'
    env_file=$(realpath -- "$env_file")
    [[ ! -e /etc/messagingapp/app.env ]] || die 'Deployment settings already exist. Edit /etc/messagingapp/app.env directly.'
fi

# Keep updates on the same port, address and database unless explicitly changed.
if [[ -f /etc/messagingapp/service.conf ]]; then
    # This file contains only validated installer-managed values, not secrets.
    previous_port=$(sed -n 's/^PORT=//p' /etc/messagingapp/service.conf)
    previous_bind=$(sed -n 's/^BIND=//p' /etc/messagingapp/service.conf)
    previous_database=$(sed -n 's/^DATABASE=//p' /etc/messagingapp/service.conf)
else
    previous_port=8080
    previous_bind=0.0.0.0
    previous_database=local
fi
if [[ -z $port ]]; then
    if [[ -t 0 ]]; then
        read -r -p "App port [$previous_port]: " port || true
    fi
    port=${port:-$previous_port}
fi
bind=${bind:-$previous_bind}
database=${database:-$previous_database}
[[ $port =~ ^[0-9]{1,5}$ ]] || die 'Port must be a number from 1024 to 65535.'
port=$((10#$port))
((port >= 1024 && port <= 65535)) || die 'Port must be from 1024 to 65535.'
[[ $bind == 0.0.0.0 || $bind == 127.0.0.1 ]] || die 'Invalid saved bind address.'
[[ $database == local || $database == external ]] || die 'Invalid saved database mode.'
[[ $ID != debian || $database == external ]] || die 'Debian requires --database external --env-file /path/app.env (MySQL 8+).'
[[ $database == "$previous_database" || ! -e /etc/messagingapp/app.env ]] || die 'Switching database mode requires a separate migration; existing settings are preserved.'
if [[ $database == external && ! -e /etc/messagingapp/app.env && -z $env_file ]]; then
    die 'External MySQL requires --env-file /path/app.env. Copy .env.example and fill in the database settings first.'
fi

# Serialize deployments, including any dependency installation.
exec 9>/run/lock/messagingapp-deploy.lock
flock -n 9 || die 'Another messagingapp deployment is running.'

staging=''
previous_release=''
activated=false
had_service=false
[[ ! -f /etc/systemd/system/messagingapp.service ]] || had_service=true
cleanup() {
    local result=$?
    trap - EXIT
    if ((result != 0)); then
        printf '\nDeployment failed. Settings and data are preserved.\n' >&2
        if [[ $activated == true && -n $previous_release ]]; then
            ln -sfn -- "$previous_release" /opt/messagingapp/current
            if [[ $had_service == true && -f $staging/previous.service ]]; then
                cp -- "$staging/previous.service" /etc/systemd/system/messagingapp.service
            fi
            systemctl daemon-reload || true
            systemctl restart messagingapp || true
            printf 'Restored the previous app release. Database migrations are not rolled back.\n' >&2
        elif [[ $activated == true ]]; then
            systemctl stop messagingapp || true
        fi
        printf 'Check logs: sudo journalctl -u messagingapp -n 80 --no-pager\n' >&2
    fi
    # Delete only our verified temporary directory, never releases or user data.
    if [[ $staging == /opt/messagingapp/.staging.* && -d $staging ]]; then
        rm -rf -- "$staging"
    fi
    exit "$result"
}
trap cleanup EXIT

export DEBIAN_FRONTEND=noninteractive
log 'Installing Linux dependencies...'
apt-get update
apt-get install -y ca-certificates curl python3 tar gzip libc6 libgcc-s1 libstdc++6 libgssapi-krb5-2 zlib1g iproute2
case "$ID:$VERSION_ID" in
    ubuntu:22.04) apt-get install -y libicu70 libssl3 ;;
    ubuntu:24.04) apt-get install -y libicu74 libssl3t64 ;;
    debian:12) apt-get install -y libicu72 libssl3 ;;
    debian:13) apt-get install -y libicu76 libssl3t64 ;;
    ubuntu:26.04)
        # Ubuntu may update the ICU soname between releases. Select its runtime package.
        icu=$(apt-cache pkgnames | awk '/^libicu[0-9]+$/ {print}' | sort -V | tail -n 1)
        [[ -n $icu ]] || die 'Could not find the Ubuntu ICU runtime package.'
        apt-get install -y "$icu" libssl3t64 ;;
esac

install -d -m 755 /opt/messagingapp /opt/messagingapp/releases
staging=$(mktemp -d /opt/messagingapp/.staging.XXXXXXXX)
if [[ $had_service == true ]]; then
    cp -- /etc/systemd/system/messagingapp.service "$staging/previous.service"
fi
if [[ -L /opt/messagingapp/current ]]; then
    previous_release=$(readlink -f /opt/messagingapp/current)
fi

# Reuse only a system-wide SDK. A root user's private SDK cannot run as the service user.
dotnet_command=''
for candidate in /usr/bin/dotnet /usr/share/dotnet/dotnet /opt/messagingapp/dotnet/dotnet; do
    if [[ -x $candidate ]] && "$candidate" --list-sdks | grep -q '^10\.' && \
        "$candidate" --list-runtimes | awk '$1 == "Microsoft.AspNetCore.App" { split($2, v, "."); if (v[1] == 10 && v[2] == 0 && v[3] + 0 >= 13 && $2 !~ /-/) found=1 } END { exit !found }'; then
        dotnet_command=$candidate
        break
    fi
done
if [[ -z $dotnet_command ]]; then
    log 'Downloading the .NET 10 SDK (includes C# and ASP.NET Core)...'
    curl --fail --silent --show-error --location --retry 3 \
        https://dot.net/v1/dotnet-install.sh -o "$staging/dotnet-install.sh"
    bash "$staging/dotnet-install.sh" --channel 10.0 --quality GA \
        --install-dir /opt/messagingapp/dotnet --no-path
    dotnet_command=/opt/messagingapp/dotnet/dotnet
    chmod -R a+rX /opt/messagingapp/dotnet
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1
export DOTNET_NOLOGO=1

log 'Restoring dependencies and building the app...'
"$dotnet_command" publish "$project" --configuration Release --output "$staging/app" \
    -p:UseAppHost=false -p:ErrorOnDuplicatePublishOutputFiles=true
[[ -f $staging/app/Database/Migrations/001_initial_create.sql ]] || die 'Published database migrations are missing.'

if ! id messagingapp >/dev/null 2>&1; then
    useradd --system --user-group --home-dir /var/lib/messagingapp --shell /usr/sbin/nologin messagingapp
fi
[[ $(id -u messagingapp) != 0 ]] || die 'The messagingapp account must not be root.'
install -d -m 750 -o root -g messagingapp /etc/messagingapp
install -d -m 750 -o messagingapp -g messagingapp /var/lib/messagingapp \
    /var/lib/messagingapp/uploads /var/lib/messagingapp/keys /var/lib/messagingapp/app-data

if [[ $database == local ]]; then
    log 'Installing and starting MySQL...'
    apt-get install -y mysql-server
    systemctl enable --now mysql
fi
log 'Preparing persistent settings and database...'
config_args=(--config /etc/messagingapp/app.env --database "$database")
[[ -z $env_file ]] || config_args+=(--env-file "$env_file")
python3 "$project_root/scripts/configure-linux.py" "${config_args[@]}"
chown root:messagingapp /etc/messagingapp/app.env
chmod 640 /etc/messagingapp/app.env

# Runtime data belongs outside release folders. Never publish local uploads or secrets.
for unsafe in .env App_Data wwwroot/uploads; do
    target="$staging/app/$unsafe"
    [[ $target == "$staging/app/"* ]] || die 'Invalid staging path.'
    rm -rf -- "$target"
done
ln -s /etc/messagingapp/app.env "$staging/app/.env"
ln -s /var/lib/messagingapp/uploads "$staging/app/wwwroot/uploads"
ln -s /var/lib/messagingapp/app-data "$staging/app/App_Data"
chmod -R a+rX "$staging/app"

# Refuse a port occupied by another service. An update may reuse our existing listener.
listener=$(ss -H -ltnp "sport = :$port")
if [[ -n $listener ]]; then
    main_pid=$(systemctl show messagingapp --property MainPID --value 2>/dev/null || true)
    [[ $main_pid =~ ^[1-9][0-9]*$ ]] || die "Port $port is already in use. Choose --port with another number."
    while IFS= read -r socket; do
        [[ $socket == *"pid=$main_pid,"* ]] || die "Port $port is already in use by another process."
    done <<< "$listener"
fi

release="/opt/messagingapp/releases/$(date -u +%Y%m%dT%H%M%SZ)-$$"
mv -- "$staging/app" "$release"
ln -sfn -- "$release" /opt/messagingapp/current
activated=true
cat > /etc/systemd/system/messagingapp.service <<SERVICE
[Unit]
Description=Messaging App
Wants=network-online.target
After=network-online.target $([[ $database != local ]] || printf 'mysql.service')
StartLimitIntervalSec=120
StartLimitBurst=5

[Service]
Type=simple
User=messagingapp
Group=messagingapp
WorkingDirectory=/opt/messagingapp/current
ExecStart=$dotnet_command /opt/messagingapp/current/MessagingApp.dll --urls http://$bind:$port
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=DOTNET_CLI_TELEMETRY_OPTOUT=1
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/messagingapp
UMask=0027
SyslogIdentifier=messagingapp

[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable messagingapp
systemctl restart messagingapp

log "Waiting for the app on port $port..."
ready=false
for ((attempt=0; attempt<60; attempt++)); do
    if curl --fail --silent --max-time 2 "http://127.0.0.1:$port/health" | grep -q '"status":"ok"'; then
        if systemctl is-active --quiet messagingapp; then
            ready=true
            break
        fi
    fi
    sleep 1
done
[[ $ready == true ]] || die 'The app did not become ready within 60 checks.'
printf 'PORT=%s\nBIND=%s\nDATABASE=%s\n' "$port" "$bind" "$database" > /etc/messagingapp/service.conf
chmod 640 /etc/messagingapp/service.conf

log "Messaging App is running in the background on port $port."
if [[ $bind == 127.0.0.1 ]]; then
    printf 'Local URL: http://127.0.0.1:%s (connect through your proxy for remote access)\n' "$port"
else
    printf 'Open: http://<server-address>:%s\n' "$port"
fi
printf 'Settings: /etc/messagingapp/app.env\nLogs: sudo journalctl -u messagingapp -f\n'
printf 'Google login: add your OAuth credentials to the settings file, then restart the service.\n'
printf 'For public Google login, calls, installation and push, configure an HTTPS domain. See docs/linux-deployment.md.\n'
