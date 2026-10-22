# Permission modes

Out of the box, pi never asks before acting. That's a deliberate choice by pi's authors, who treat the container or VM as the safety boundary. pi-foundry adds **Claude Code–style permission modes** on top, and starts in **Ask** mode.

| Mode | Footer | Reads & read-only commands | File writes / edits | Other commands & tools |
|---|---|---|---|---|
| **ask** *(default)* | `⏵ ask` | run | **ask** | **ask** |
| **edits** | `⏵⏵ accept edits` | run | run | **ask** |
| **plan** | `⏸ plan` | run | blocked | blocked |
| **auto** | `⚠ auto` | run | run | run *(pi's native behavior)* |

## Switching modes

| | |
|---|---|
| ++shift+tab++ | Cycle **ask → accept edits → plan → ask** |
| ++alt+m++ | Same, if Shift+Tab isn't free (see below) |
| `/mode` | Pick from a list; `/mode edits` sets one directly |
| `--permission-mode <mode>` | Start pi in a mode |
| `FOUNDRY_MODE=<mode>` | Default mode (in `.env`) |

**Auto** joins the Shift+Tab cycle only after you've chosen it once (`/mode auto`, the flag or the env var), so you can't land in it by accident. The mode is saved with each session and restored on `--continue`/`--resume`.

!!! note "Shift+Tab and thinking levels"
    pi normally uses Shift+Tab to cycle the **thinking level**. On first run, pi-foundry writes a `keybindings.json` in your config dir that moves thinking-level cycling to ++alt+t++, freeing Shift+Tab for modes (like Claude Code). An existing `keybindings.json` is never touched; in that case modes use ++alt+m++ until you add `"app.thinking.cycle": "alt+t"` yourself.

## Approval prompts

When something needs approval, pi shows what it's about to do. For a command it shows the command; for an edit, the file and the changed lines; for a new file, the path and the first lines:

```text
Write src/hello.ts (12 lines):

  + export function hello() {
  +   return "hi";
  + …

→ Yes
  Yes, and accept all edits (switch to accept-edits mode)
  No
  No, and tell pi what to do instead
```

| Choice | Effect |
|---|---|
| **Yes** | Run this one call. |
| **Yes, and…** | For edits: switch to *accept edits*. For commands: allow commands starting with the same prefix (e.g. `npm test`, `git commit`, `make build`) for the rest of the session. |
| **No** | Block the call and stop. pi waits for your next message. |
| **No, and tell pi what to do instead** | Block the call and send your note to the model so it can change course. |

## What counts as "read-only"

These never prompt:

- pi's `read`, `grep`, `find` and `ls` tools, plus any extension or MCP tool that declares `readOnlyHint`.
- Shell commands made **only** of known read-only programs: `ls`, `cat`, `head`, `rg`, `grep`, `find` (without `-exec`/`-delete`), `sed` (without `-i`), `jq`, `wc`, `diff`, `git status|log|diff|show|blame|…`, `npm ls`, `--version`/`--help` probes, and similar. Pipes and `&&` chains are fine if **every** part is read-only.

Anything else prompts: writing redirections (`>`, `>>`), `$(…)` or backticks, `sudo`, `xargs`, `tee`, package installs, `git commit/push/checkout`, running scripts, `curl`, `az`, and so on. When in doubt it asks.

## Print mode and CI

With `-p` (or JSON/RPC modes without a UI) there's nobody to ask, so anything that would prompt is **blocked**, and the model is told to rerun with a different mode. For unattended runs, pick the mode explicitly:

```bash
pi-foundry --permission-mode edits -p "fix the failing test"     # edits OK, commands blocked
FOUNDRY_MODE=auto pi-foundry -p "run the tests and fix failures" # everything allowed
```

## Plan mode

In **plan** mode pi can only read: edits and non-read-only commands are blocked, and the model is told it's in a planning phase and should finish with a numbered plan. Review it, press ++shift+tab++ to switch to *ask* or *accept edits*, and tell pi to go ahead.

## Turning it off

```dotenv title=".env"
FOUNDRY_MODE=auto            # keep the modes, start without prompts
FOUNDRY_PERMISSIONS=off      # remove the extension entirely (pure pi behavior)
```

!!! warning "Prompts aren't a security boundary"
    Approval prompts prevent accidents; they don't contain a determined or prompt-injected model. A command that *looks* harmless can still do harm, and you might approve something you didn't read closely. The real boundaries are the container (pi sees only your project and config dirs) and a least-privilege Azure identity. See [Security](security.md).
