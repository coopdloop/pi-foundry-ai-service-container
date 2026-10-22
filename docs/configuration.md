# Configuration

Configure pi-foundry with **environment variables** (in `.env` next to `compose.yaml`) and optionally a **`foundry.json`** file in your pi config directory. Environment variables win.

## Environment variables

### Foundry

| Variable | Default | Description |
|---|---|---|
| `FOUNDRY_RESOURCE` | *auto* | Foundry resource name. Auto-detected when the subscription has exactly one. |
| `FOUNDRY_RESOURCE_GROUP` | *auto* | Skips a lookup; optional. |
| `FOUNDRY_ENDPOINT` | *from resource* | e.g. `https://my-foundry.services.ai.azure.com`. Needed only with `FOUNDRY_DISCOVER=0`. |
| `FOUNDRY_DEFAULT_MODEL` | *best found* | Deployment name pi starts with. |
| `FOUNDRY_EXCLUDE` | | Comma-separated deployment names to hide. |
| `FOUNDRY_DISCOVER` | `1` | `0` disables ARM discovery; list models in `foundry.json` instead. |
| `FOUNDRY_DISCOVERY_TTL` | `600` | Seconds to cache discovery results. |
| `FOUNDRY_INCLUDE_OTHER_MODELS` | `0` | `1` registers non-OpenAI, non-Anthropic chat models via Chat Completions. |
| `FOUNDRY_SCOPE` | `https://ai.azure.com/.default` | Token scope. `https://cognitiveservices.azure.com/.default` also works for most resources. |
| `FOUNDRY_CONFIG` | `<agent dir>/foundry.json` | Path to the config file. |

### Identity

| Variable | Description |
|---|---|
| `FOUNDRY_AUTH` | `auto` · `host` · `device-code` · `service-principal` · `managed-identity`. See [Authentication](authentication.md). |
| `AZURE_SUBSCRIPTION_ID` | Subscription used for discovery. |
| `AZURE_TENANT_ID` | Tenant for sign-in and tokens. |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_FEDERATED_TOKEN_FILE` | Service principal / workload identity / user-assigned managed identity. |

### Container and paths

| Variable | Default | Description |
|---|---|---|
| `PI_WORKSPACE` | *set by the launcher* | Host project directory mounted at `/workspace`. |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | Host Docker socket to mount. `./config/no-docker` disables Docker access. Taken from `DOCKER_HOST` automatically for rootless Docker. |
| `GIT_CONFIG_HOST` | `~/.gitconfig` | Git config to copy in. The launcher falls back to an empty file if you don't have one. |
| `PI_CONFIG_DIR` | `~/.pi-foundry/agent` | Your pi config + sessions. See [Customizing pi](customizing.md). |
| `AZURE_CONFIG_HOST_DIR` | `~/.azure` | Host az login to copy. Point at an empty directory to disable. |
| `HOST_UID`, `HOST_GID` | *workspace owner* | Override the container user's IDs. |
| `PI_VERSION` | `latest` | pi version to install at build time. |
| `EXTRA_APT_PACKAGES` | | Extra Debian packages baked into the image. |
| `PI_FOUNDRY_IMAGE` | `pi-foundry:local` | Image tag. |
| `FOUNDRY_QUIET` | `0` | `1` hides pi-foundry's startup log lines. |
| `FOUNDRY_MODE` | `ask` | Starting [permission mode](permissions.md): `ask`, `edits`, `plan`, `auto`. |
| `FOUNDRY_PERMISSIONS` | `on` | `off` removes the permission-modes extension. |
| `FOUNDRY_THEME` | `foundry-light/foundry-dark` | Default theme (see [Customizing pi](customizing.md#theme)). `off` uses pi's built-in default. |
| `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL` | | Identity for commits the agent makes. |

### Network

| Variable | Description |
|---|---|
| `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` | Used by pi, Node and the Azure CLI. |
| `NODE_EXTRA_CA_CERTS` | PEM bundle **path inside the container** for pi/Node. |
| `REQUESTS_CA_BUNDLE` | PEM bundle **path inside the container** for the Azure CLI. |

## foundry.json

Put this in your pi config directory (`~/.pi-foundry/agent/foundry.json` by default). An annotated copy, `foundry.example.json`, is placed there on first run.

```json
{
  "resource": "my-foundry",
  "resourceGroup": "rg-ai",
  "subscription": "00000000-0000-0000-0000-000000000000",
  "defaultModel": "claude-opus-4-8",
  "exclude": ["gpt-4o-mini"],
  "discover": true,
  "discoveryTtlSeconds": 600,
  "includeOtherModels": false,
  "scope": "https://ai.azure.com/.default",
  "models": [
    { "deployment": "claude-sonnet", "model": "claude-sonnet-4-6", "format": "Anthropic" },
    { "deployment": "gpt-5.5", "contextWindow": 400000, "maxTokens": 64000 },
    { "deployment": "gpt-5.5-eu", "model": "gpt-5.5", "endpoint": "https://my-eu-foundry.services.ai.azure.com" }
  ]
}
```

### `models[]` entries

Entries **add** deployments (e.g. when discovery is off, or a deployment lives on another resource) or **override** discovered ones with the same `deployment` name.

| Field | Description |
|---|---|
| `deployment` | Deployment name (sent as `model` in requests; the pi model ID). **Required.** |
| `model` | Underlying model name, used to look up context window, pricing, reasoning. |
| `format` | `OpenAI` or `Anthropic` (inferred from the name if omitted). |
| `api` | Force a pi API: `openai-responses`, `openai-completions`, `anthropic-messages`. |
| `endpoint` | Another Foundry resource's endpoint (same Entra token works across resources in the tenant). |
| `name` | Display name in `/model`. |
| `contextWindow`, `maxTokens`, `reasoning`, `input`, `cost`, `thinkingLevelMap`, `compat`, `headers` | Any pi model field, passed through. See pi's [models docs](https://pi.dev). |

## Without discovery

If your identity can call models but can't read the resource through ARM:

```dotenv title=".env"
FOUNDRY_DISCOVER=0
FOUNDRY_ENDPOINT=https://my-foundry.services.ai.azure.com
```

```json title="foundry.json"
{ "models": [ { "deployment": "gpt-5.5" }, { "deployment": "claude-opus-4-8" } ] }
```
