#!/usr/bin/env python3
"""Prepare the deployment's private .env and provision its dedicated MySQL account."""

import argparse
import os
from pathlib import Path
import re
import secrets
import subprocess


def read_env(path):
    """Read the same simple KEY=value format as Configuration/DotEnv.cs; never execute it."""
    values = {}
    if path.exists():
        for raw in path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = (part.strip() for part in line.split("=", 1))
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            values.setdefault(key, value)
    return values


def configure(path, mode, env_file=None):
    if env_file and path.exists():
        raise ValueError(f"{path} already exists. Edit it directly to preserve deployment settings.")
    values = read_env(env_file) if env_file else read_env(path)
    if mode == "local":
        values.setdefault("MYSQL_HOST", "localhost")
        values.setdefault("MYSQL_PORT", "3306")
        values.setdefault("MYSQL_DATABASE", "messagingapp")
        values.setdefault("MYSQL_USER", "messagingapp")
        values.setdefault("MYSQL_PASSWORD", secrets.token_hex(32))
        local_database_sql(values)  # Validate before saving or changing MySQL.
    else:
        if not values.get("ConnectionStrings__DefaultConnection"):
            required = ("MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD")
            missing = [key for key in required if not values.get(key)]
            if missing:
                raise ValueError("External MySQL requires --env-file with: " + ", ".join(missing))
            if not 1 <= int(values.get("MYSQL_PORT", "3306")) <= 65535:
                raise ValueError("MYSQL_PORT must be between 1 and 65535.")

    values.setdefault("MYSQL_CHARSET", "utf8mb4")
    values.setdefault("Authentication__Google__ClientId", "")
    values.setdefault("Authentication__Google__ClientSecret", "")
    values.setdefault("AllowedHosts", "*")
    values["ASPNETCORE_ENVIRONMENT"] = "Production"
    # Bind address and port are managed in systemd, never overridden by a copied .env.
    for key in list(values):
        if key.upper() in ("ASPNETCORE_URLS", "ASPNETCORE_HTTP_PORTS", "ASPNETCORE_HTTPS_PORTS") or key.lower().startswith("kestrel__endpoints__"):
            del values[key]
    values.setdefault("Hosting__UseHttpsRedirection", "false")
    values["DataProtection__KeyPath"] = "/var/lib/messagingapp/keys"
    values.setdefault("DataProtection__ApplicationName", "MessagingApp")
    values["Deployment__DatabaseMode"] = mode
    for key, value in values.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"Invalid environment key: {key}")
        if "\n" in value or "\r" in value or "\x00" in value:
            raise ValueError(f"Multiline environment value is not supported: {key}")
        if value != value.strip() or (len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'"):
            raise ValueError(f"Remove leading/trailing whitespace or literal enclosing quotes from {key}.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as output:
        output.write("# Private deployment settings. Restart messagingapp after editing.\n")
        output.writelines(f"{key}={value}\n" for key, value in values.items())
    temporary.replace(path)
    return values


def local_database_sql(values):
    if values.get("ConnectionStrings__DefaultConnection"):
        raise ValueError("Use --database external for an explicit connection string.")
    if values.get("MYSQL_HOST") != "localhost" or values.get("MYSQL_PORT") != "3306":
        raise ValueError("Local mode requires MYSQL_HOST=localhost and MYSQL_PORT=3306. Use --database external for another server.")
    database, user, password = (values[key] for key in ("MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"))
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", database):
        raise ValueError("Local MYSQL_DATABASE must contain only letters, numbers and underscores.")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,31}", user) or user.lower() in ("root", "mysql", "debian_sys_maint"):
        raise ValueError("Use a dedicated local MYSQL_USER (letters, numbers and underscores), never root.")
    if not re.fullmatch(r"[A-Za-z0-9]{24,128}", password):
        raise ValueError("Local MYSQL_PASSWORD must be 24-128 letters/numbers. Omit it to generate one automatically.")
    # Inputs are strictly validated. Credentials travel through stdin, never process arguments.
    # Do not reset an existing user's password: it may belong to another application.
    return (
        f"CREATE DATABASE IF NOT EXISTS `{database}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n"
        f"CREATE USER IF NOT EXISTS '{user}'@'localhost' IDENTIFIED BY '{password}';\n"
        f"GRANT ALL PRIVILEGES ON `{database}`.* TO '{user}'@'localhost';\n"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--database", choices=("local", "external"), required=True)
    parser.add_argument("--env-file", type=Path)
    args = parser.parse_args()
    if args.env_file and not args.env_file.is_file():
        parser.error("--env-file does not exist")
    try:
        values = configure(args.config, args.database, args.env_file)
        if args.database == "local":
            result = subprocess.run(["mysql", "--protocol=socket", "-u", "root"],
                                    input=local_database_sql(values), text=True, capture_output=True)
            if result.returncode:
                raise ValueError("MySQL setup failed. Local mode needs socket access to MySQL as root. Use external mode for a password-protected administrator.")
    except (ValueError, OSError) as error:
        parser.exit(1, f"Configuration error: {error}\n")


if __name__ == "__main__":
    main()
