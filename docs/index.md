# pi-foundry

**The [pi](https://pi.dev) coding agent in a container, wired to your Azure AI Foundry models with keyless Microsoft Entra ID auth.**

No API keys, no `.env` secrets, no token that expires halfway through a long refactor. You sign in to Azure the way you already do, and pi uses your GPT and Claude deployments in Foundry.

```bash
git clone https://github.com/coopdloop/pi-foundry-ai-service-container.git
cd pi-foundry-ai-service-container
make build       # newest pi + Azure CLI
make doctor      # checks sign-in, RBAC, network, every deployment
make run         # start coding
```

## What you get

<div class="grid cards" markdown>

-   :material-key-remove: **Keyless by design**

    Entra ID tokens from the Azure CLI. Works with resources that have key auth disabled (`disableLocalAuth: true`), and with Entra-only models.

-   :material-refresh-auto: **No mid-session failures**

    Tokens are cached and refreshed ten minutes before expiry, shared across concurrent requests, and retried on network blips.

-   :material-radar: **Auto-discovery**

    Lists your Foundry deployments through ARM and routes each to the right API: Responses for GPT and codex, Messages for Claude. Context windows, reasoning levels and pricing come from pi's model catalog.

-   :material-account-switch: **Every identity type**

    Host `az login`, device code in the container, service principal, workload identity (federated token), or managed identity.

-   :material-stethoscope: **`doctor`**

    Checks every link from sign-in to each deployment and tells you exactly what to fix: role, firewall, scope, quota, DNS.

-   :material-docker: **Fresh pi, your config**

    Each build installs the newest pi from npm. Mount a config dir to bring your own `AGENTS.md`, extensions, skills, prompts and themes.

</div>

## Supported models

| Family | Foundry format | pi API | Endpoint |
|---|---|---|---|
| GPT-5.x, codex, o-series, GPT-4.1 | `OpenAI` | `openai-responses` | `https://<resource>.services.ai.azure.com/openai/v1` |
| Claude (Opus, Sonnet, Haiku, Mythos) | `Anthropic` | `anthropic-messages` | `https://<resource>.services.ai.azure.com/anthropic` |
| DeepSeek, Grok, Mistral, Llama… *(opt-in)* | other | `openai-completions` | `https://<resource>.services.ai.azure.com/openai/v1` |

See [Recommended models](models.md) for what to deploy and how to size it.

## Next

- Check the **[Requirements](requirements.md)**: what must already be set up in Azure.
- Then follow the **[Quickstart](getting-started.md)**.
- Curious how it works? See **[How it works](how-it-works.md)**.
