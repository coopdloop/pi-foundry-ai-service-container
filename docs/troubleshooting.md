# Troubleshooting

**Start with `pi-foundry doctor`** (or `make doctor`). It checks each step in order and prints a fix under the first failure.

## Errors from Foundry

| Symptom | Cause | Fix |
|---|---|---|
| **401** Unauthorized | Wrong token scope or tenant | Keep `FOUNDRY_SCOPE` at its default. Set `AZURE_TENANT_ID` to the resource's tenant and sign in again. |
| **403** "PermissionDenied" / "lacks the required data action" | Identity has no data-plane role | Ask for **Foundry User** or **Cognitive Services User** on the resource. Owner/Contributor aren't enough. Wait a few minutes after it's granted. |
| **403** "Public access is disabled" / "Traffic is not from an approved private endpoint" | Network rules | Connect from an allowed network (VPN, devbox) or ask for your IP to be allowed. |
| **404** `DeploymentNotFound` | Typo, or a brand-new deployment | Check `pi-foundry models`. New deployments can take a few minutes. |
| **404** on `/anthropic/...` | Resource is the classic `OpenAI` kind | Claude needs an `AIServices` (Foundry) resource. |
| **429** Too Many Requests | Deployment out of TPM | pi retries automatically. If it persists, the deployment needs more capacity ([sizing](models.md#sizing-capacity-tpm)). |
| **400** "data retention required" (Claude) | Subscription has zero data retention for a covered Claude model | A Microsoft/Anthropic account-level setting; see Microsoft's Claude-in-Foundry docs. |
| **400** "unsupported parameter" | Deployment doesn't support the chosen API or feature | Override `api` or `compat` for that deployment in [`foundry.json`](configuration.md#models-entries). |

## Sign-in problems

| Symptom | Fix |
|---|---|
| "Not signed in and no terminal for device-code login" | Run `pi-foundry login` in an interactive terminal, or sign in on the host with `az login`. |
| "Host az login didn't produce a token" | Your host sign-in expired or needs MFA: run `az login` on the host. Meanwhile pi-foundry falls back to the container sign-in. |
| `AADSTS50076` / `AADSTS50079` / `interaction_required` | MFA or conditional access re-prompt: `az login` on the host, or `pi-foundry login`. |
| `AADSTS700082` (refresh token expired) | Sign in again; your tenant's session lifetime ran out. |
| Wrong subscription/resource picked | Set `AZURE_SUBSCRIPTION_ID` and `FOUNDRY_RESOURCE`. |
| "Multiple Foundry resources found" | Set `FOUNDRY_RESOURCE` to one of the listed names. |
| Windows: always asks for device code | Expected. The Windows token cache is encrypted; see [Authentication](authentication.md#host-sign-in-default-on-macos-and-linux). |

## Network

### DNS / private endpoints

`doctor` prints what the endpoint resolves to and flags private IPs. If the resource uses a private endpoint and resolution fails *inside* Docker but works on the host:

- **Docker Desktop:** make sure your VPN's DNS is used. Restarting Docker after connecting the VPN often helps.
- **Linux:** set `"dns": ["<your corporate DNS>"]` in `/etc/docker/daemon.json`, or add `dns:` to `compose.override.yaml`.

### Corporate proxy / TLS inspection

```yaml title="compose.override.yaml"
services:
  pi:
    volumes:
      - ./corp-root-ca.pem:/etc/ssl/certs/corp-root-ca.pem:ro
    environment:
      HTTPS_PROXY: http://proxy.corp:8080
      NO_PROXY: localhost,127.0.0.1
      NODE_EXTRA_CA_CERTS: /etc/ssl/certs/corp-root-ca.pem   # pi / Node
      REQUESTS_CA_BUNDLE: /etc/ssl/certs/corp-root-ca.pem    # Azure CLI
```

For **builds** behind a proxy, Docker passes `HTTP_PROXY`/`HTTPS_PROXY` build args automatically when they're set in your Docker client config.

### Long responses cut off

pi's default request timeout is generous. If a proxy kills idle connections, set a lower `retry.provider.timeoutMs` in `settings.json` and raise `retry.maxRetries` ([Customizing pi](customizing.md)).

## Container issues

| Symptom | Fix |
|---|---|
| Files created by the agent are owned by root | Your workspace is root-owned, or you use rootful Docker with an unusual setup. Set `HOST_UID`/`HOST_GID` in `.env`. |
| `~/.azure` or `~/.pi-foundry/agent` created as root on Linux | Docker creates missing bind sources as root. Create them first, or `sudo chown -R $USER` them. |
| `git` says "dubious ownership" | Already handled (`safe.directory=*`). If you override the image, keep that setting. |
| Colors look wrong | Pass your terminal's `TERM`/`COLORTERM` (Compose forwards them by default). |

## Still stuck?

Open an issue with the output of `pi-foundry doctor` and `pi-foundry version`. Remove tenant and subscription IDs if you consider them sensitive.
