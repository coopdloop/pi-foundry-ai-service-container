# shellcheck shell=bash
# Sourced by entrypoint.sh and pi-foundry. Prints a filesystem-safe id for the
# host project path, e.g. C:\Users\me\src\app -> c--users-me-src-app.
# Every project is mounted at /workspace, so this keeps sessions per project.
project_slug() {
  local p="${HOST_WORKSPACE:-}"
  [[ -n "$p" ]] || return 1
  p="$(tr '[:upper:]' '[:lower:]' <<<"$p")"
  p="${p//[\/\\:]/-}"
  p="$(sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//' <<<"$p")"
  [[ -n "$p" ]] && printf '%s' "$p"
}
