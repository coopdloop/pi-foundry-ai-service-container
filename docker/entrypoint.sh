#!/usr/bin/env bash
# Runs as root only long enough to match the container user to the owner of
# your workspace, then drops privileges and hands off to `pi-foundry`.
set -euo pipefail

if [[ "$(id -u)" != "0" ]]; then
  # Started with --user: nothing to remap.
  exec /usr/local/bin/pi-foundry "$@"
fi

ws_uid="$(stat -c %u . 2>/dev/null || echo 1000)"
ws_gid="$(stat -c %g . 2>/dev/null || echo 1000)"
uid="${HOST_UID:-$ws_uid}"
gid="${HOST_GID:-$ws_gid}"

if [[ "$uid" == "0" ]]; then
  # Rootless Docker/Podman: container root *is* your host user. Stay root so
  # the workspace is writable, but keep pi's home.
  export HOME=/home/pi
  exec /usr/local/bin/pi-foundry "$@"
fi

if [[ "$gid" != "$(id -g pi)" ]]; then
  groupmod -o -g "$gid" pi
fi
if [[ "$uid" != "$(id -u pi)" ]]; then
  usermod -o -u "$uid" -g "$gid" pi >/dev/null 2>&1 || usermod -o -u "$uid" -g "$gid" pi
fi

# Directories we manage (named volumes start root-owned).
for d in /home/pi /home/pi/.pi /home/pi/.pi/agent /home/pi/.azure /home/pi/.cache; do
  mkdir -p "$d"
  [[ "$(stat -c %u "$d")" == "$uid" ]] || chown "$uid:$gid" "$d" 2>/dev/null || true
done
chown -R "$uid:$gid" /home/pi/.azure /home/pi/.cache 2>/dev/null || true

export HOME=/home/pi USER=pi
exec gosu pi /usr/local/bin/pi-foundry "$@"
