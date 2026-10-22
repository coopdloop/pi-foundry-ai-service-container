#!/usr/bin/env bash
# Runs as root only long enough to:
#   1. match the container user to the owner of your workspace,
#   2. give that user access to the host Docker socket,
# then drops privileges and hands off to `pi-foundry`.
set -euo pipefail

if [[ "$(id -u)" != "0" ]]; then
  # Started with --user: nothing to remap.
  exec /usr/local/bin/pi-foundry "$@"
fi

WS=/workspace
[[ -d "$WS" ]] || WS="$(pwd)"
ws_uid="$(stat -c %u "$WS" 2>/dev/null || echo 1000)"
ws_gid="$(stat -c %g "$WS" 2>/dev/null || echo 1000)"
uid="${HOST_UID:-$ws_uid}"
gid="${HOST_GID:-$ws_gid}"

run_as_root() {
  export HOME=/home/pi
  exec /usr/local/bin/pi-foundry "$@"
}

if [[ "$uid" == "0" && -z "${HOST_UID:-}" ]]; then
  # Root-owned workspace. Two common cases:
  #  - Windows (Docker Desktop): files show as root but are writable by
  #    everyone, so keep the default unprivileged user.
  #  - Rootless Docker/Podman: container root *is* your host user, and the
  #    workspace is only writable as root.
  if gosu pi test -w "$WS"; then
    uid="$(id -u pi)"; gid="$(id -g pi)"
  else
    run_as_root "$@"
  fi
elif [[ "$uid" == "0" ]]; then
  run_as_root "$@"
fi

if [[ "$gid" != "$(id -g pi)" ]]; then
  groupmod -o -g "$gid" pi
fi
if [[ "$uid" != "$(id -u pi)" ]]; then
  usermod -o -u "$uid" -g "$gid" pi >/dev/null 2>&1 || usermod -o -u "$uid" -g "$gid" pi
fi

# Host Docker socket: join whatever group owns it (root on Docker Desktop,
# "docker" on Linux) so `docker` works without sudo.
if [[ -S /var/run/docker.sock ]]; then
  sock_gid="$(stat -c %g /var/run/docker.sock)"
  sock_group="$(getent group "$sock_gid" | cut -d: -f1 || true)"
  if [[ -z "$sock_group" ]]; then
    groupadd -o -g "$sock_gid" docker-host
    sock_group=docker-host
  fi
  usermod -aG "$sock_group" pi
fi

# Directories we manage (named volumes start root-owned).
for d in /home/pi /home/pi/.pi /home/pi/.pi/agent /home/pi/.azure /home/pi/.cache /home/pi/.local; do
  mkdir -p "$d"
  [[ "$(stat -c %u "$d")" == "$uid" ]] || chown "$uid:$gid" "$d" 2>/dev/null || true
done
chown -R "$uid:$gid" /home/pi/.azure /home/pi/.cache /home/pi/.local 2>/dev/null || true

export HOME=/home/pi USER=pi
exec gosu pi /usr/local/bin/pi-foundry "$@"
