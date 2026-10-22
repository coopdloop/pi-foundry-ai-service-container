# Requirements

pi-foundry is a **client**. It never creates, changes or deletes anything in Azure. Before you set it up, make sure the following already exists, provisioned the way your organization manages Azure (portal, Bicep, Terraform, platform team).

!!! success "Quick check"
    After building the image, `pi-foundry doctor` checks every item on this page and names the one that's missing.

## 1. A Foundry resource

| Requirement | Why |
|---|---|
| An **Azure AI Foundry resource**, kind `AIServices` (shown as *Foundry* / *AI Services* in the portal) | Hosts both the OpenAI (`/openai/v1`) and Anthropic (`/anthropic`) endpoints. A classic `OpenAI`-kind resource works for GPT models only. |
| A **custom subdomain** (the default for Foundry resources) | Entra ID auth only works on `https://<name>.services.ai.azure.com`, not on regional endpoints. |
| *Recommended:* **key auth disabled** (`disableLocalAuth: true`) | pi-foundry never uses keys, so turning them off removes a class of leaks. Some models (for example Claude Mythos) are Entra-only anyway. |

## 2. At least one chat deployment

Deploy one or more GPT or Claude models on the resource. [Recommended models](models.md) covers which to choose and how to size them.

- **Deployment type:** *Global Standard* (or *Data Zone Standard*) works for everything. Claude models are offered as Global Standard (some also as Data Zone US).
- **Capacity:** coding agents send large contexts on every turn. Give each deployment enough tokens-per-minute; see [sizing](models.md#sizing-capacity-tpm).
- **Claude prerequisites (Microsoft's rules):** a paid subscription with a pay-as-you-go billing method in a supported country, and access to Azure Marketplace to subscribe to the model offer. CSP, credit-only, free-trial and student subscriptions aren't supported.

## 3. Permissions for the identity that runs pi

Whoever (or whatever) signs in inside the container needs, **on the Foundry resource**:

| Role | Gives | Needed for |
|---|---|---|
| **Foundry User** (formerly *Azure AI User*), or **Cognitive Services User** | data-plane inference for all model families **and** read access to the resource | everything (recommended single role) |
| *alternative:* **Cognitive Services OpenAI User** + **Reader** | GPT inference + resource read | GPT-only setups |

- **Read access** lets pi-foundry list your deployments automatically. Without it, set `FOUNDRY_DISCOVER=0`, `FOUNDRY_ENDPOINT`, and list deployments in [`foundry.json`](configuration.md#foundryjson).
- Role assignments can take a few minutes to take effect.
- Owner/Contributor alone do **not** grant data-plane inference with Entra ID.

## 4. An identity to sign in with

One of these (details in [Authentication](authentication.md)):

- **Your user account**, through `az login` on your machine (reused automatically) or a one-time device-code sign-in inside the container.
- A **service principal** (client secret) or **workload identity** (federated token), for CI and headless machines.
- A **managed identity**, when running on an Azure VM, Container Apps or AKS.

## 5. Network reachability

The container needs HTTPS (443) access to:

| Host | Purpose |
|---|---|
| `<resource>.services.ai.azure.com` | model inference |
| `login.microsoftonline.com` | Entra ID tokens |
| `management.azure.com` | deployment discovery (optional) |
| `registry.npmjs.org`, `packages.microsoft.com`, Debian mirrors | **build time only** |

If the resource uses **private endpoints** or a firewall allow-list, run pi-foundry from a network that can reach it (VPN, devbox, jump host) and make sure Docker's DNS resolves the private zone. Corporate proxies and TLS inspection are covered in [Troubleshooting](troubleshooting.md#corporate-proxy-tls-inspection).
