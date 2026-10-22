#!/usr/bin/env bash
# Build the image with the newest pi release. The version is passed as a
# build arg, so Docker's cache is reused until pi actually ships an update.
set -euo pipefail
cd "$(dirname "$0")/.."

pkg="@earendil-works/pi-coding-agent"
version="${PI_VERSION:-}"
if [[ -z "$version" || "$version" == "latest" ]]; then
  version="$(curl -fsSL "https://registry.npmjs.org/${pkg/\//%2f}/latest" \
    | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1 || true)"
  [[ -n "$version" ]] || { echo "Could not resolve latest $pkg; building with 'latest'" >&2; version=latest; }
fi

# The compose file mounts ~/.gitconfig; never let Docker create it as a directory.
if [[ -z "${GIT_CONFIG_HOST:-}" && ! -f "$HOME/.gitconfig" ]]; then
  export GIT_CONFIG_HOST="$PWD/config/empty.gitconfig"
fi

echo "Building pi-foundry with $pkg@$version"
PI_VERSION="$version" docker compose build "$@" pi
docker compose run --rm --no-deps -e FOUNDRY_QUIET=1 pi version
