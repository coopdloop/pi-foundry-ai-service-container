# Customizing pi

The image always contains a **fresh pi** and the Foundry extension. Everything personal lives in a directory **you mount**: `PI_CONFIG_DIR`, default `~/.pi-foundry/agent`. It maps to pi's agent directory (`~/.pi/agent`) inside the container.

```text
~/.pi-foundry/agent/
├── settings.json        # pi settings (theme, default model, retry, packages…)
├── AGENTS.md            # global instructions for every project
├── foundry.json         # pi-foundry config (optional)
├── keybindings.json     # created on first run: thinking cycle → Alt+T, frees Shift+Tab
├── extensions/          # your pi extensions (*.ts or */index.ts)
├── skills/              # skills
├── prompts/             # prompt templates
├── themes/              # themes
└── sessions/            # conversation history (created by pi)
```

Changes take effect on the next start, or immediately with `/reload` for extensions, skills and prompts.

## Theme

pi-foundry ships two themes tuned for long coding sessions:

| | |
|---|---|
| **`foundry-dark`** | Deep slate surfaces, Azure-blue accents, violet keywords, soft green/coral diffs, warm amber for bash mode and inline code |
| **`foundry-light`** | The same palette, darkened for contrast on light backgrounds |

Design notes:

- **Calm surfaces:** your messages, tool boxes and selections use low-contrast tints, so code and diffs stand out.
- **Readable diffs:** green and coral are softened to avoid neon glare but stay clearly distinct; diffs also keep their `+`/`-` markers, so color is never the only cue.
- **Thinking level at a glance:** the editor border moves through slate → blue → azure → violet → pink → rose as you raise the thinking level, so you always know how hard the model is working.
- **Syntax colors** follow the same families as most modern editor themes (violet keywords, blue functions, green strings, teal types, peach numbers), so code looks familiar.

By default pi-foundry uses `foundry-light/foundry-dark`, which **follows your terminal's background**. It's applied only while you haven't chosen a theme yourself. Pick any theme in `/settings` and pi remembers it. To change the default or turn it off:

```dotenv title=".env"
FOUNDRY_THEME=foundry-dark     # always dark
FOUNDRY_THEME=off              # pi's built-in default
```

For your own theme, drop a JSON file in `~/.pi-foundry/agent/themes/` (copy `/opt/pi-foundry/themes/foundry-dark.json` from the image as a starting point) and select it in `/settings`. Edits to the active theme file reload live.

!!! tip "Truecolor"
    The themes use 24-bit color. iTerm2, Kitty, WezTerm, Ghostty, Windows Terminal and VS Code all support it. In VS Code, set `terminal.integrated.minimumContrastRatio` to `1` so it doesn't shift the colors.

## Common tweaks

=== "Default model & thinking"

    ```json title="settings.json"
    {
      "defaultProvider": "foundry",
      "defaultModel": "claude-opus-4-8",
      "defaultThinkingLevel": "high"
    }
    ```

=== "Retry tuning"

    ```json title="settings.json"
    {
      "retry": {
        "enabled": true,
        "maxRetries": 5,
        "baseDelayMs": 2000,
        "provider": { "timeoutMs": 600000, "maxRetryDelayMs": 60000 }
      }
    }
    ```

=== "Global instructions"

    ```markdown title="AGENTS.md"
    - Use pnpm, never npm.
    - Run `make test` before saying a change is done.
    ```

=== "Pi packages"

    ```json title="settings.json"
    { "packages": ["pi-skills"] }
    ```

    Packages install under the mounted directory, so they survive rebuilds.

## Reuse your existing pi config

To share your host pi setup (settings, skills, sessions) with the container:

```dotenv title=".env"
PI_CONFIG_DIR=~/.pi/agent
```

!!! warning
    Host extensions with **native npm dependencies** built for macOS won't load in the Linux container. Your host `auth.json` is also visible to the container. A separate directory (the default) avoids both.

## Add tools to the image

For tools your projects need (Python, Go, a database client…):

```dotenv title=".env"
EXTRA_APT_PACKAGES=python3 python3-venv golang-go postgresql-client
```

then `pi-foundry build`. For anything more involved, extend the image:

```dockerfile title="Dockerfile.local"
FROM pi-foundry:local
USER root
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
```

```yaml title="compose.override.yaml"
services:
  pi:
    build:
      dockerfile: Dockerfile.local
```

## Extra mounts

Use `compose.override.yaml` (git-ignored) for anything machine-specific:

```yaml title="compose.override.yaml"
services:
  pi:
    volumes:
      - ~/.ssh/known_hosts:/home/pi/.ssh/known_hosts:ro
      - ./corp-ca.pem:/etc/ssl/certs/corp-ca.pem:ro
    environment:
      NODE_EXTRA_CA_CERTS: /etc/ssl/certs/corp-ca.pem
      REQUESTS_CA_BUNDLE: /etc/ssl/certs/corp-ca.pem
```

!!! note
    Only mount files that exist. Docker creates a **directory** in place of a missing bind-mount source.
