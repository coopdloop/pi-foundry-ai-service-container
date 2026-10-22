# Quickstart

!!! info "Before you start"
    pi-foundry assumes your Azure AI Foundry resource, deployments and role assignments **already exist**. It never creates or changes anything in Azure. See [Requirements](requirements.md).

You'll need **Docker** with Compose v2: Docker Desktop (macOS, Windows), OrbStack, Colima, or Docker Engine on Linux. On Windows, use Docker Desktop with the WSL 2 backend and Linux containers (the default). Optionally, install the Azure CLI on your machine and sign in with `az login`; the container reuses that sign-in on macOS and Linux. Otherwise you sign in once with a device code.

## 1. Clone and configure

=== "macOS / Linux / WSL"

    ```bash
    git clone https://github.com/coopdloop/pi-foundry-ai-service-container.git
    cd pi-foundry-ai-service-container
    cp .env.example .env
    ```

=== "Windows (PowerShell)"

    ```powershell
    git clone https://github.com/coopdloop/pi-foundry-ai-service-container.git
    cd pi-foundry-ai-service-container
    Copy-Item .env.example .env
    ```

If your subscription has **exactly one** Foundry resource and you're signed in, you can leave `.env` empty. Otherwise set at least:

```dotenv title=".env"
FOUNDRY_RESOURCE=my-foundry-resource
AZURE_SUBSCRIPTION_ID=00000000-0000-0000-0000-000000000000   # if not your default
```

## 2. Build and install the launcher

=== "macOS / Linux / WSL"

    ```bash
    ./pi-foundry build      # newest pi + dev tools + Azure CLI
    ./pi-foundry install    # links pi-foundry into ~/.local/bin
    ```

=== "Windows (PowerShell)"

    ```powershell
    .\pi-foundry.cmd build      # newest pi + dev tools + Azure CLI
    .\pi-foundry.cmd install    # adds this folder to your user PATH
    ```

    Open a new terminal afterwards so the PATH change applies. The `.cmd` launcher bypasses PowerShell's execution policy, so no policy change is needed.

Run `pi-foundry build` again any time to pick up a new pi release. Docker reuses its cache until pi actually changes.

## 3. Check

```bash
pi-foundry doctor
```

```text
pi-foundry doctor

✓ pi 1.4.0
✓ az 2.91.0
✓ signed in you@contoso.com · tenant … · subscription "Engineering"
✓ Entra token scope https://ai.azure.com/.default · expires in 73 min (auto-refreshed in pi)
✓ Foundry resource my-foundry · AIServices · eastus2 · rg rg-ai
✓ endpoint https://my-foundry.services.ai.azure.com
✓ key auth disabled (Entra-only, as recommended)
✓ DNS my-foundry.services.ai.azure.com → 20.62.58.5

✓ gpt-5.5 (gpt-5.5 · openai-responses) 200 in 1412 ms · East US 2
✓ claude-opus-4-8 (claude-opus-4-8 · anthropic-messages) 200 in 1890 ms

All good. Run `pi-foundry` to start coding.
```

If something fails, the doctor prints a fix under the failing line. See [Troubleshooting](troubleshooting.md).

!!! tip "Not signed in to az on this machine? (or on Windows)"
    Run `pi-foundry login` once. It shows a device code; sign in at <https://microsoft.com/devicelogin>. The sign-in is saved in a Docker volume and refreshed automatically.

## 4. Use it in any project

```bash
cd ~/src/my-app            # or: cd C:\src\my-app
pi-foundry                          # interactive
pi-foundry -p "explain this repo"   # one-shot
pi-foundry --model foundry/claude-opus-4-8
```

The directory you run it from is mounted at `/workspace`. pi keeps **separate sessions per project**, and the agent has Python, Node, Docker, git (with your identity) and the usual build tools. See [Dev tools & host access](dev-environment.md).

Inside pi, `/model` lists your Foundry deployments, ++shift+tab++ switches [permission modes](permissions.md), and `/foundry` shows the endpoint, token expiry and discovered models.
