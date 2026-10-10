#!/usr/bin/env bash
#
# Installs Offset on a Linux server, as two systemd services.
#
# Run it from inside an unpacked release bundle:
#
#   sudo ./install.sh
#
# It creates a system account that cannot log in, puts the application under
# /opt, the data under /var/lib, and two services that start at boot: the
# application, and the background worker that sends reminder emails and takes
# the nightly backup. Secrets are generated here and never leave the machine.
#
# It also installs the updater: a root service that sleeps until an
# administrator asks for an update in Settings, installs the signed release,
# and exits. Nothing privileged stays running.
#
# Running it again with a newer bundle is an upgrade. The application is
# replaced; the data, the settings and the secrets are not.
#
# Everything it writes is listed at the end, so an administrator can see exactly
# what landed on their server without reading this script.

set -euo pipefail

# ── where things go ──────────────────────────────────────────────────────────
# Split on purpose: the application is replaceable and the data is not. An
# upgrade overwrites /opt and never touches /var/lib.
APP_ROOT="/opt"
DATA_ROOT="/var/lib"
UNIT_DIR="/etc/systemd/system"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf '\n  %s\n\n' "$1" >&2; exit 1; }
say() { printf '  %s\n' "$1"; }

# ── ports ────────────────────────────────────────────────────────────────────
# Whether anything is already listening. ss on anything current, netstat on
# older machines, and bash's own /dev/tcp when a minimal image has neither.
port_taken() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$p )" 2>/dev/null | grep -q LISTEN && return 0
    return 1
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | grep -qE "[:.]$p[[:space:]]" && return 0
    return 1
  fi
  (exec 3<>"/dev/tcp/127.0.0.1/$p") >/dev/null 2>&1 && { exec 3<&- 3>&-; return 0; }
  return 1
}

first_free_port() {
  local p="$1"
  while [ "$p" -lt 65535 ] && port_taken "$p"; do
    p=$((p + 1))
  done
  printf '%s' "$p"
}

[ "$(id -u)" -eq 0 ] || die "Run this with sudo."

# ── what are we installing ───────────────────────────────────────────────────
[ -f "$here/app/pack/pack.json" ] || die "This does not look like a release bundle: app/pack/pack.json is missing."

# Read two fields out of pack.json without needing jq, which is not installed
# everywhere and is a silly thing to require for two strings.
product_name="$(sed -n 's/.*"product"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$here/app/pack/pack.json" | head -1)"
product_id="$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$here/app/pack/pack.json" | head -1)"
[ -n "$product_id" ] || die "Could not read the product id from app/pack/pack.json."

slug="offset-$product_id"
app_dir="$APP_ROOT/$slug"
data_dir="$DATA_ROOT/$slug"
unit="$UNIT_DIR/$slug.service"
worker_unit="$UNIT_DIR/$slug-worker.service"
env_file="$data_dir/.env"
node_bin="$app_dir/node/bin/node"

# ── a record of this install ────────────────────────────────────────────────
# Everything printed from here on is also written to a file, so that when an
# install fails there is something to send to support besides a screenshot of
# the last line. Kept from one install to the next, newest at the bottom.
install_log="/var/log/$slug-install.log"
exec > >(tee -a "$install_log") 2>&1
printf '\n===== %s  installing %s =====\n' "$(date '+%Y-%m-%d %H:%M:%S %z')" "$product_name"
trap 'rc=$?; if [ "$rc" -ne 0 ]; then printf "\n  The install did not finish (exit code %s).\n  What happened is written to %s\n  Please send that file to support.\n\n" "$rc" "$install_log"; fi' EXIT

# ── will it run here ─────────────────────────────────────────────────────────
# Asked before anything is written, so a machine that cannot run it is left
# exactly as it was found.
[ -f "$here/app/node/bin/node" ] || die "This bundle has no Node runtime in app/node. It is incomplete; rebuild it with deploy/linux/build.sh."

arch="$(uname -m)"
[ "$arch" = x86_64 ] || die "This bundle is for 64-bit Intel and AMD servers (x86_64). This machine is $arch."

chmod 755 "$here/app/node/bin/node"
"$here/app/node/bin/node" -e '' >/dev/null 2>&1 \
  || die "The Node runtime in this bundle will not start on this machine. It needs glibc 2.28 or newer: RHEL 8, Debian 10, Ubuntu 20.04, SLES 15 SP3, Amazon Linux 2023, or anything newer. On Alpine, or anything else built on musl, use the Docker image instead."

command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] \
  || die "This installer needs systemd. For anything else, use the Docker image in deploy/docker."

printf '\n  Installing %s\n\n' "$product_name"

# ── the account it runs as ───────────────────────────────────────────────────
# A system account with no shell and no home. It owns the data and nothing else,
# so a flaw in the application cannot reach the rest of the machine.
nologin="$(command -v nologin || echo /usr/sbin/nologin)"
if id "$slug" >/dev/null 2>&1; then
  say "account $slug already exists"
else
  useradd --system --no-create-home --shell "$nologin" "$slug"
  say "created the system account $slug"
fi

# ── the application ──────────────────────────────────────────────────────────
# Stopped first on an upgrade. Replacing files under a running process leaves it
# serving a mixture of two versions until something happens to restart it.
if systemctl is-active --quiet "$slug" || systemctl is-active --quiet "$slug-worker"; then
  systemctl stop "$slug-worker" "$slug" 2>/dev/null || true
  say "stopped the running version to replace it"
fi

# Replaced wholesale. Nothing here is worth keeping between versions, which is
# the point of putting the data somewhere else.
rm -rf "$app_dir"
mkdir -p "$app_dir"
cp -r "$here/app/." "$app_dir/"
# The documents go beside it, with the licence their links point at, so an
# administrator finds them where the product is rather than in a tarball that
# may have been deleted.
if [ -d "$here/docs" ]; then
  cp -r "$here/docs" "$app_dir/docs"
  cp "$here/LICENSE.txt" "$app_dir/LICENSE.txt"
fi
# For an administrator who cannot sign in and has no email to reset it with.
# Written fresh on every install, so it always points at this copy.
cat > "$app_dir/reset-password.sh" <<RESET
#!/bin/sh
# Prints a temporary password for an administrator of $product_name.
# It works once, for 30 minutes, and only to choose a new password.
# Run with sudo:  sudo $app_dir/reset-password.sh [username]
[ "\$(id -u)" -eq 0 ] || { echo "  Run this with sudo: sudo $app_dir/reset-password.sh"; exit 1; }
[ -f "$env_file" ] || { echo "  $product_name has not been set up on this server yet."; exit 1; }
who="\$1"
if [ -z "\$who" ]; then
  printf '  Administrator username: '
  read -r who
fi
[ -n "\$who" ] || { echo "  No username was given. Nothing was changed."; exit 1; }
exec runuser -u $slug -- sh -c 'cd "\$0" && exec "\$1" "\$2" "\$3"' "$data_dir" "$node_bin" "$app_dir/dist/admin/reset-password.js" "\$who"
RESET
chmod 755 "$app_dir/reset-password.sh"

chown -R root:root "$app_dir"
chmod -R go-w "$app_dir"
chmod 755 "$node_bin"
say "installed the application to $app_dir"

# ── the data ─────────────────────────────────────────────────────────────────
# Nothing here may be a link. The updater runs this script as root on behalf of
# the application, and the data folder belongs to the application's account, so
# a link planted in it would turn "write the settings file" into "write
# wherever the link points".
for path in "$data_dir" "$env_file" "$data_dir/update-status" "$data_dir/updates"; do
  [ -L "$path" ] && die "$path is a symbolic link. Refusing to write through it."
done

mkdir -p "$data_dir"/{data,evidence,backups,logs,updates/request,update-status}
chown -R "$slug":"$slug" "$data_dir"
chmod 750 "$data_dir"

# The updater's half of the handoff: root writes, the application only reads.
chown -R root:"$slug" "$data_dir/update-status"
chmod 750 "$data_dir/update-status"
mkdir -p "/var/cache/$slug-updater" "/etc/$slug"
chmod 700 "/var/cache/$slug-updater"
say "created $data_dir for the database, evidence, backups and logs"

# ── secrets, once ────────────────────────────────────────────────────────────
# Generated on this machine and never regenerated. Rewriting SESSION_SECRET
# would sign everybody out; rewriting FIELD_ENC_KEY would make stored secrets
# unreadable, which is worse and silent.
if [ -f "$env_file" ]; then
  say "kept the existing settings at $env_file"
else
  # A port nothing else answers on. Installing onto a busy one produced a
  # tidy install that died immediately, with the reason in journalctl and
  # nowhere else.
  if [ -n "${PORT:-}" ]; then
    port="$PORT"
    if port_taken "$port"; then
      die "Port $port is already in use on this machine.
  Something is listening there - another Offset product, or your own server.
  Pick a free one:  sudo PORT=$(first_free_port "$port") ./install.sh $product_id"
    fi
  else
    port="$(first_free_port 8080)"
    if [ "$port" != "8080" ]; then
      say "port 8080 is in use, so this install answers on $port"
    fi
  fi
  session_secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  field_key="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

  cat > "$env_file" <<ENV
# Settings for $product_name. Generated on $(date -u +%Y-%m-%d).
#
# SESSION_SECRET and FIELD_ENC_KEY are unique to this machine. Losing
# FIELD_ENC_KEY makes stored secrets unreadable, so back this file up with the
# database, and keep them together.
#
# After changing anything here:
#   systemctl restart $slug $slug-worker

PRODUCT=$product_id
NODE_ENV=production
PORT=$port

# 127.0.0.1 is this machine only, which is the safe default. To let colleagues
# reach it, set HOST=0.0.0.0 and give it a certificate below - without one it
# refuses to start, rather than sending passwords across your network in clear.
HOST=127.0.0.1
PUBLIC_URL=http://localhost:$port

DATABASE_URL=file:$data_dir/data/offset.db
EVIDENCE_DIR=$data_dir/evidence
BACKUP_DIR=$data_dir/backups
LOG_DIR=$data_dir/logs
LOG_TO_FILE=true

SESSION_SECRET=$session_secret
FIELD_ENC_KEY=$field_key

# TLS_CERT_FILE=/etc/ssl/certs/offset.pem
# TLS_KEY_FILE=/etc/ssl/private/offset-key.pem

# Nightly jobs - the backup, and the reminder emails - run at this hour, on a
# 24-hour clock, in this server's time zone.
DAILY_JOB_HOUR=2
ENV

  chown "$slug":"$slug" "$env_file"
  chmod 600 "$env_file"
  say "generated settings and secrets at $env_file"
fi

# One-click updates. Added to settings an older installer wrote, as well as to
# new ones, so an upgraded server gains the Update button too.
for line in "INSTALL_KIND=linux" \
            "UPDATE_REQUEST_DIR=$data_dir/updates/request" \
            "UPDATE_STATUS_DIR=$data_dir/update-status"; do
  grep -q "^${line%%=*}=" "$env_file" || printf '%s\n' "$line" >> "$env_file"
done
printf '{"kind":"linux","installedAt":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  > "$data_dir/update-status/updater.json"
chmod 644 "$data_dir/update-status/updater.json"

# What it will actually listen on, which after an upgrade is whatever the
# existing settings say rather than what this run was given.
setting() { sed -n "s/^$1=//p" "$env_file" | tail -1 | tr -d '\r'; }
port="$(setting PORT)"; port="${port:-8080}"
host="$(setting HOST)"
scheme=http
[ -n "$(setting TLS_CERT_FILE)" ] && scheme=https
# A certificate uploaded on the Settings screen sits beside the database.
[ -f "$data_dir/data/tls/certificate.json" ] && scheme=https

# ── the services ─────────────────────────────────────────────────────────────
# Two, because the product is two processes. The worker sends the reminder
# emails, takes the nightly backup and records the daily readiness figure.
# Without it everything on screen still works and nobody is ever chased.
hardening="# The application needs its own data and nothing else on the machine.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$data_dir
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true"

cat > "$unit" <<UNIT
[Unit]
Description=$product_name
After=network-online.target
Wants=network-online.target $slug-worker.service

[Service]
Type=simple
User=$slug
Group=$slug
WorkingDirectory=$data_dir
EnvironmentFile=$env_file
ExecStart=$node_bin $app_dir/dist/server.js
Restart=on-failure
RestartSec=5

$hardening

[Install]
WantedBy=multi-user.target
UNIT

cat > "$worker_unit" <<UNIT
[Unit]
Description=$product_name background worker (reminders, backups)
# The application creates the database schema. The worker waits for it either
# way; ordering them only keeps the first log readable.
After=$slug.service
# Stopping or restarting the application takes the worker with it, so the two
# can never be left running different versions.
PartOf=$slug.service

[Service]
Type=simple
User=$slug
Group=$slug
WorkingDirectory=$data_dir
EnvironmentFile=$env_file
ExecStart=$node_bin $app_dir/dist/worker.js
Restart=on-failure
RestartSec=10

$hardening

[Install]
WantedBy=multi-user.target
UNIT

# The updater. The .path unit watches for a request from Settings and starts
# the .service, which installs the release and exits.
#
# Root, because installing means replacing /opt and restarting the services
# above. It reads its release settings from /etc/$slug, never from the
# application's .env, and works in the application's data folder only as the
# application's account.
cat > "$UNIT_DIR/$slug-updater.path" <<UNIT
[Unit]
Description=$product_name updater: wait for a request from Settings

[Path]
PathExists=$data_dir/updates/request/request.json
Unit=$slug-updater.service

[Install]
WantedBy=multi-user.target
UNIT

cat > "$UNIT_DIR/$slug-updater.service" <<UNIT
[Unit]
Description=$product_name updater: install a release an administrator asked for

[Service]
Type=oneshot
ExecStart=$node_bin $app_dir/dist/updater/linux.js $product_id
TimeoutStartSec=30min
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
UNIT

# On SELinux systems, give the new files the labels their locations expect.
# Without this a bundle unpacked in a home directory can carry that label into
# /opt, and systemd refuses to run it with nothing more helpful than 203/EXEC.
if command -v restorecon >/dev/null 2>&1; then
  restorecon -R "$app_dir" "$data_dir" "$unit" "$worker_unit" \
    "$UNIT_DIR/$slug-updater.path" "$UNIT_DIR/$slug-updater.service" 2>/dev/null || true
fi

systemctl daemon-reload
systemctl enable "$slug" "$slug-worker" "$slug-updater.path" >/dev/null 2>&1
systemctl restart "$slug"
systemctl restart "$slug-worker"
# start, not restart: when the updater itself runs this script, the path unit
# is what started it, and restarting that mid-update would be pointless churn.
systemctl start "$slug-updater.path"
say "installed and started the services $slug and $slug-worker, and the updater"

# ── did it actually come up ──────────────────────────────────────────────────
# Asked of the application itself. "active" from systemd only means the process
# exists, which it briefly does even when it is about to fail on its settings.
case "$host" in ""|0.0.0.0|::) probe_host=127.0.0.1 ;; *) probe_host="$host" ;; esac
probe="$scheme://$probe_host:$port/api/v1/health/ready"

started=no
for _ in $(seq 1 30); do
  sleep 1
  if NODE_TLS_REJECT_UNAUTHORIZED=0 "$node_bin" -e "
       fetch('$probe').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))
     " >/dev/null 2>&1; then
    started=yes; break
  fi
done

printf '\n'
if [ "$started" = yes ]; then
  say "$product_name is running at $scheme://localhost:$port"
  systemctl is-active --quiet "$slug-worker" \
    || say "The worker is not running, so no reminders or backups. See: journalctl -u $slug-worker -n 50"
  say "Open it in a browser and create the first administrator account."
else
  say "It did not answer within 30 seconds. See what it says with:"
  say "  journalctl -u $slug -n 50 --no-pager"
fi

cat <<SUMMARY

  What was installed
    application   $app_dir
    data          $data_dir
    settings      $env_file
    services      $unit
                  $worker_unit
                  $UNIT_DIR/$slug-updater.path
    runs as       $slug

  Useful commands
    systemctl status $slug $slug-worker
    systemctl restart $slug $slug-worker
    journalctl -u $slug -u $slug-worker -f

  Back up $data_dir. It holds the database, the evidence files and the
  encryption key, and none of it can be recovered from anywhere else.

SUMMARY

[ "$started" = yes ] || exit 1
