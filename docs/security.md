# Security

## What pi-foundry does and doesn't touch

- **Never changes Azure.** Its only Azure calls are token requests and **read-only** ARM calls (`account list`, `account show`, `deployment list`) for discovery.
- **Never uses API keys.** Works with `disableLocalAuth: true`, which we recommend.
- **Never writes your host Azure CLI state.** `~/.azure` is mounted read-only and copied into the container.
- **Scrubs the startup token** from the environment before pi runs any tool.

## Permission modes help, but aren't a boundary

pi-foundry starts in [Ask mode](permissions.md): pi asks before editing files or running anything that isn't clearly read-only, including `az` commands. That catches most accidents. It isn't a security boundary: an approved command can do more than it appears to, and a prompt-injected model may try to make a dangerous action look routine. Keep the real boundaries in place: the container and the identity below.

## The agent runs as your Azure identity

!!! danger "Read this before signing in with a powerful account"
    pi is a coding agent with a **bash tool**. The Azure CLI in the container is signed in, so the agent *can* run `az` commands with whatever rights that identity has. If you're **Owner** or **Contributor** somewhere, a confused model, or a prompt injection hidden in a file, web page or dependency, could in principle change or delete Azure resources.

Recommended:

1. **Use a least-privilege identity for pi.** The ideal identity has only **Foundry User** (or **Cognitive Services User**) on the Foundry resource and nothing else. Options:
    - a dedicated **service principal** with only that role (`FOUNDRY_AUTH=service-principal`);
    - a **separate user/guest account** signed in with `pi-foundry login` and `FOUNDRY_AUTH=device-code`, so your everyday admin login is never in the container.
2. Prefer **Privileged Identity Management (PIM)** for admin roles, so your account isn't standing-Owner while you code.
3. Stay in **ask** or **plan** mode for sensitive repositories, and read `az` commands before approving them.

## Container boundary

- The agent sees **only** the project directory you launch from, your pi config directory, and the container's own files.
- It runs as an unprivileged user whose UID matches yours, so it can do to your project what you can do.
- It has **unrestricted outbound network** access, which it needs to reach Foundry and Entra ID. Add egress controls at the Docker or network level if you need them.

## Supply chain

- Every build installs the **latest pi** from npm (`@earendil-works/pi-coding-agent`) and the Azure CLI from Microsoft's apt repository. Pin `PI_VERSION` for reproducible builds.
- pi is installed with `--ignore-scripts`.
- The Foundry extension has **no npm dependencies**. It uses Node built-ins and the Azure CLI.
