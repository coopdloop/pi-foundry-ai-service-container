# pi-foundry

**The [pi](https://pi.dev) coding agent in Docker, using your Azure AI Foundry models with keyless Microsoft Entra ID auth.**

[![CI](https://github.com/coopdloop/pi-foundry-ai-service-container/actions/workflows/ci.yml/badge.svg)](https://github.com/coopdloop/pi-foundry-ai-service-container/actions/workflows/ci.yml)
[![Docs](https://img.shields.io/badge/docs-gh--pages-indigo)](https://coopdloop.github.io/pi-foundry-ai-service-container/)

- **No API keys.** Entra ID tokens from the Azure CLI. Works on resources with key auth disabled.
- **No mid-session 401s.** Tokens refresh ten minutes before expiry, shared across concurrent requests.
- **Auto-discovery.** Finds your GPT and Claude deployments and routes each to the right API (Responses or Messages).
- **Any identity.** Reuses your host `az login`, or device code, service principal, workload identity, or managed identity.
- **Always-fresh pi.** Each build installs the newest release. Your config, extensions, skills and sessions live in a mounted directory.
- **Permission modes.** Ask / accept edits / plan / auto, cycled with Shift+Tab like Claude Code. Starts in Ask.
- **Polished out of the box.** Foundry Dark/Light themes that follow your terminal background.
- **`doctor`.** Checks sign-in, RBAC, DNS and every deployment, and tells you what to fix.

## Quickstart

> **Requirements:** a Foundry (`AIServices`) resource with GPT and/or Claude deployments, and the **Foundry User** (or **Cognitive Services User**) role on it. pi-foundry never changes anything in Azure. See [Requirements](https://coopdloop.github.io/pi-foundry-ai-service-container/requirements/).

```bash
git clone https://github.com/coopdloop/pi-foundry-ai-service-container.git
cd pi-foundry-ai-service-container
cp .env.example .env          # set FOUNDRY_RESOURCE if you have more than one
make build                    # newest pi + Azure CLI + Foundry extension
make doctor                   # verify sign-in, access, network, deployments
```

Use it from any project:

```bash
alias pi-foundry='docker compose -f ~/src/pi-foundry-ai-service-container/compose.yaml run --rm pi'   # `make alias` prints yours
cd ~/src/my-app && pi-foundry
```

No `az` on your machine? Run `make login` once for a device-code sign-in.

## How it routes models

| Foundry deployment | pi API | Endpoint |
|---|---|---|
| GPT-5.x / codex / o-series (`OpenAI`) | `openai-responses` | `https://<resource>.services.ai.azure.com/openai/v1` |
| Claude (`Anthropic`) | `anthropic-messages` | `https://<resource>.services.ai.azure.com/anthropic` |

All requests use `Authorization: Bearer <Entra token>` with scope `https://ai.azure.com/.default`.

## Documentation

**https://coopdloop.github.io/pi-foundry-ai-service-container/**

[Requirements](https://coopdloop.github.io/pi-foundry-ai-service-container/requirements/) ·
[Recommended models](https://coopdloop.github.io/pi-foundry-ai-service-container/models/) ·
[Authentication](https://coopdloop.github.io/pi-foundry-ai-service-container/authentication/) ·
[Configuration](https://coopdloop.github.io/pi-foundry-ai-service-container/configuration/) ·
[Customizing pi](https://coopdloop.github.io/pi-foundry-ai-service-container/customizing/) ·
[Troubleshooting](https://coopdloop.github.io/pi-foundry-ai-service-container/troubleshooting/) ·
[Security](https://coopdloop.github.io/pi-foundry-ai-service-container/security/)

> [!WARNING]
> The agent has a bash tool, and the container's Azure CLI is signed in as you. Sign in with an identity that has **only** inference access. See [Security](https://coopdloop.github.io/pi-foundry-ai-service-container/security/).

## Layout

```
Dockerfile              node + Azure CLI + newest pi
compose.yaml            mounts, env, volumes
docker/entrypoint.sh    UID remap, privilege drop
docker/pi-foundry       auth bootstrap + subcommands (doctor, login, models, shell)
extension/index.ts      pi extension: "foundry" provider with per-request Entra auth
lib/foundry.mjs         config, token cache, ARM discovery, model mapping
bin/foundry-doctor.mjs  doctor / models
tests/smoke.sh          offline test that the extension loads in the newest pi
docs/                   MkDocs site (published to GitHub Pages)
```

## License

MIT. Not affiliated with Microsoft, Anthropic, OpenAI or Earendil.
