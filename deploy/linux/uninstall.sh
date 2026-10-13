#!/usr/bin/env bash
#
# Removes an Offset installation.
#
#   sudo ./uninstall.sh ascend
#
# Stops both services, removes the application, and leaves the data alone
# unless you ask for it to go. Deleting somebody's compliance evidence as a side
# effect of uninstalling is not a risk worth taking, so the data has to be named
# explicitly:
#
#   sudo ./uninstall.sh ascend --delete-data

set -euo pipefail

product="${1:-}"
[ -n "$product" ] || { echo "Usage: sudo $0 <product> [--delete-data]" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "Run this with sudo." >&2; exit 1; }

slug="offset-$product"
app_dir="/opt/$slug"
data_dir="/var/lib/$slug"

say() { printf '  %s\n' "$1"; }
printf '\n'

# The updater first, so nothing can start an install halfway through removal;
# then the worker, so nothing is left writing to the database while the
# application it belongs to goes away.
for unit in "$slug-updater.path" "$slug-updater.service" "$slug-worker.service" "$slug.service"; do
  if [ -f "/etc/systemd/system/$unit" ]; then
    systemctl disable --now "$unit" >/dev/null 2>&1 || true
    rm -f "/etc/systemd/system/$unit"
    say "stopped and removed $unit"
  fi
done
systemctl daemon-reload
rm -rf "/var/cache/$slug-updater"

rm -rf "$app_dir"
say "removed $app_dir"

if [ "${2:-}" = "--delete-data" ]; then
  rm -rf "$data_dir" "/etc/$slug"
  say "deleted $data_dir, including the database and evidence"
  if id "$slug" >/dev/null 2>&1; then
    userdel "$slug" 2>/dev/null || true
    say "removed the system account $slug"
  fi
else
  say "kept $data_dir - the database, evidence and encryption key are still there"
  say "  delete it yourself, or re-run with --delete-data"
fi

printf '\n'
