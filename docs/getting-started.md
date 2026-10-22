# Quickstart

!!! info "Before you start"
    pi-foundry assumes your Azure AI Foundry resource, deployments and role assignments **already exist**. It never creates or changes anything in Azure. See [Requirements](requirements.md).

You'll also need **Docker** with Compose v2 (Docker Desktop, OrbStack, Colima, or Docker Engine on Linux). Optionally, install the Azure CLI on your machine and sign in with `az login`; the container reuses that sign-in. Without it, you sign in once with a device code.

## 1. Clone and configure

```bash
git clone https://github.com/coopdloop/pi-foundry-ai-service-container.git
cd pi-foundry-ai-service-container
cp .env.example .env
```

If your subscription has **exactly one** Foundry resource and you're signed in with `az login`, you can leave `.env` empty. Otherwise set at least:

```dotenv title=".env"
FOUNDRY_RESOURCE=my-foundry-resource
AZURE_SUBSCRIPTION_ID=00000000-0000-0000-0000-000000000000   # if not your default
```

## 2. Build

```bash
make build
```

This installs the **newest pi release** from npm, the Azure CLI, and the Foundry extension. Run it again any time to pick up a new pi release. Docker reuses its cache until pi actually changes.

## 3. Check

```bash
make doctor
```

```text
pi-foundry doctor

✓ pi 0.84.4
✓ az 2.79.0
✓ signed in you@contoso.com · tenant … · subscription "Engineering"
✓ Entra token scope https://ai.azure.com/.default · expires in 73 min (auto-refreshed in pi)
✓ Foundry resource my-foundry · AIServices · eastus2 · rg rg-ai
✓ endpoint https://my-foundry.services.ai.azure.com
✓ key auth disabled (Entra-only, as recommended)
✓ DNS my-foundry.services.ai.azure.com → 20.62.58.5

✓ gpt-5.5 (gpt-5.5 · openai-responses) 200 in 1412 ms · East US 2
✓ claude-opus-4-8 (claude-opus-4-8 · anthropic-messages) 200 in 1890 ms

All good. Run `docker compose run --rm pi` to start coding.
```

If something fails, the doctor prints a fix under the failing line. See [Troubleshooting](troubleshooting.md).

!!! tip "No `az` on your machine?"
    Run `make login` once. It shows a device code; sign in at <https://microsoft.com/devicelogin>. The sign-in is saved in a Docker volume and refreshed automatically.

## 4. Use it in any project

Add an alias (print yours with `make alias`):

```bash
alias pi-foundry='docker compose -f ~/src/pi-foundry-ai-service-container/compose.yaml run --rm pi'
```

Then from any project:

```bash
cd ~/src/my-app
pi-foundry                          # interactive
pi-foundry -p "explain this repo"   # one-shot
pi-foundry --model foundry/claude-opus-4-8
```

Your project is mounted at the **same path** as on your machine, so pi keeps separate sessions per project and the paths it prints match yours.

Inside pi, `/model` lists your Foundry deployments and `/foundry` shows the endpoint, token expiry and discovered models.
