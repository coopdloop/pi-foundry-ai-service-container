# Daily use

## Run pi in any project

pi-foundry mounts **the directory you run it from**. Set up an alias once:

```bash
make alias   # prints the line below with your path
alias pi-foundry='docker compose -f ~/src/pi-foundry-ai-service-container/compose.yaml run --rm pi'
```

Add it to `~/.zshrc` or `~/.bashrc`, then:

```bash
cd ~/src/my-app
pi-foundry                                   # interactive TUI
pi-foundry -p "summarize the open TODOs"     # print mode, exits when done
pi-foundry --continue                        # resume the last session in this project
pi-foundry --model foundry/gpt-5.3-codex     # pick a deployment
pi-foundry --model foundry/claude-opus-4-8:high   # with a thinking level
```

All normal [pi flags](https://pi.dev) work. Anything that isn't a pi-foundry command is passed straight to pi.

## pi-foundry commands

| Command | What it does |
|---|---|
| `pi-foundry` *[pi args]* | Sign in, discover deployments, start pi |
| `pi-foundry doctor` | Check sign-in, token, discovery, DNS, and send a tiny request to each deployment |
| `pi-foundry doctor --no-ping` | Same, without the test requests |
| `pi-foundry models` | Table of deployments pi will use and the API for each (`--json`, `--refresh`) |
| `pi-foundry login` | Device-code sign-in, saved in the `pi-foundry_azure` volume |
| `pi-foundry logout` | Clear that saved sign-in |
| `pi-foundry shell` | Bash inside the container, signed in (for debugging) |
| `pi-foundry version` | pi, az and node versions in the image |

The same commands exist as `make doctor`, `make models`, `make login`, `make shell` inside the repo.

## Inside pi

| | |
|---|---|
| ++shift+tab++ / `/mode` | Switch [permission mode](permissions.md): ask → accept edits → plan |
| ++alt+t++ | Cycle thinking level (moved from Shift+Tab) |
| `/model` | Pick a Foundry deployment. ++ctrl+s++ saves it as your default. |
| `/foundry` | Endpoint, resource, token expiry, registered and skipped deployments |
| `/foundry refresh` | Re-discover deployments now (e.g. you just deployed a new model) |
| `/foundry token` | Force a token refresh (rarely needed) |

## Sessions and paths

Your project is mounted at the **same absolute path** inside the container as on your machine. That means:

- pi keeps **separate session history per project**, as it does natively.
- File paths in pi's output are clickable and correct on your host.
- Files the agent creates are owned by **you** (the container user's UID/GID is matched to the project directory's owner).

Sessions, settings and your customizations live in `PI_CONFIG_DIR` (default `~/.pi-foundry/agent`) and survive image rebuilds.

## Updating pi

```bash
cd ~/src/pi-foundry-ai-service-container
git pull          # new pi-foundry features
make build        # newest pi release (cached until pi changes)
make rebuild      # everything fresh: base image, apt, az, pi
```

Pin a version with `PI_VERSION=1.4.0 make build` (or in `.env`).

## Headless / CI

```bash
docker compose run --rm -T \
  -e FOUNDRY_MODE=auto \
  -e FOUNDRY_AUTH=service-principal \
  -e AZURE_CLIENT_ID -e AZURE_TENANT_ID -e AZURE_CLIENT_SECRET \
  pi -p "review the diff in this branch and list risky changes"
```

`-T` disables the TTY. Without a UI nothing can be approved, so set a [permission mode](permissions.md#print-mode-and-ci) that allows what the task needs (`edits` or `auto`). Use `FOUNDRY_QUIET=1` to suppress pi-foundry's own log lines.
