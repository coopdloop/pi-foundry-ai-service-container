# Dev tools & host access

The container is a complete Linux dev box. It also connects to the parts of your machine that work across operating systems: **your project, your Docker, and your git identity**.

## Tools in the image

| | |
|---|---|
| **Python** | `python` / `python3` (3.11), `pip`, `venv`, and **`uv`** (which can also install other Python versions: `uv python install 3.13`) |
| **Node** | `node` 24, `npm`, `pnpm`, `yarn` |
| **Build** | `make`, `gcc`/`g++` (`build-essential`), `pkg-config` |
| **Containers** | `docker` CLI with `compose` and `buildx` plugins, connected to **your** Docker |
| **Everyday** | `git`, `rg`, `fd`, `jq`, `sqlite3`, `curl`, `wget`, `tree`, `rsync`, `zip`/`unzip`, `nano`, `vi` |
| **Azure** | `az` (signed in, see [Authentication](authentication.md)) |

Need more (Go, Rust, Java, a database client)? Add Debian packages with `EXTRA_APT_PACKAGES` in `.env` and rebuild, or extend the image. See [Customizing pi](customizing.md#add-tools-to-the-image).

Package caches for pip, uv, npm and pnpm live in the `pi-foundry_cache` volume, so repeat installs are fast across projects and restarts.

## Your project: `/workspace`

The directory you run `pi-foundry` from is mounted at **`/workspace`**, the same on every OS. Changes go straight to your files, and files the agent creates are owned by you.

- **Sessions stay per project.** pi normally files sessions by working directory. Since every project is `/workspace` here, pi-foundry gives each **host** path its own session folder, so `pi-foundry --continue` resumes the right conversation.
- The host path is available to the agent as **`$HOST_WORKSPACE`**.

## Docker

Your Docker socket is mounted, so the agent can build images, run tests in containers, and use `docker compose`, all on **your** Docker, next to your other containers.

!!! note "Bind mounts use host paths"
    The Docker daemon runs on your machine, not in this container. In `docker run -v`, use the **host** path:

    ```bash
    docker run --rm -v "$HOST_WORKSPACE:/src" -w /src node:24 npm test
    ```

    pi-foundry tells the model this, so it does the right thing on its own.

!!! warning "Docker access is powerful"
    Access to the Docker socket is effectively **admin access to your Docker host**: a container can mount any path Docker can see. In the default [Ask mode](permissions.md), `docker` commands other than `docker ps`/`images`/`version` require your approval. To turn Docker access off, see [Security](security.md#docker-socket).

**Where the socket comes from:**

| Host | Socket |
|---|---|
| Docker Desktop (macOS, Windows), OrbStack, Colima, Linux | `/var/run/docker.sock` (default) |
| Rootless Docker / custom daemon | taken from `DOCKER_HOST=unix://…` automatically, or set `DOCKER_SOCKET` in `.env` |

## Git identity

Your `~/.gitconfig` (on Windows `%USERPROFILE%\.gitconfig`) is mounted **read-only** and copied at startup, so commits the agent makes carry your name and email, and your aliases work. Settings that point at programs only your machine has are dropped from the copy:

- `credential.helper` (macOS Keychain, Git Credential Manager, wincred)
- editors, pagers, `core.sshCommand`, GPG programs that don't exist in the container
- `commit.gpgsign` (the signing keys stay on your machine)

`GIT_AUTHOR_NAME` / `GIT_AUTHOR_EMAIL` in `.env` override the copied identity. If you have no `.gitconfig`, an empty one is used.

!!! info "Pushing"
    Your SSH keys and credential store stay on your machine, so `git push` from inside the container won't authenticate by default. Commit inside, push from your normal terminal. That's usually what you want from an agent anyway.

## Things that don't cross over

The container is Linux. Programs built for macOS or Windows can't run in it, and Linux builds won't run on your host:

| | What happens | What to do |
|---|---|---|
| **Python virtualenvs** | A `.venv` from your Mac/PC won't run here, and vice versa | Use **`uv`**: inside pi-foundry its project environments are kept **outside** your project (in the cache volume), so your own `.venv` is never touched. The agent is told to prefer it. |
| **`node_modules`** | Packages with native add-ons are built for one OS | Fine if you only run the project through pi-foundry. If you also run it natively, reinstall on the host (`npm ci`) after the agent installs, or vice versa. |
| **Homebrew, Windows tools** | Not available | Install the Linux equivalent (`EXTRA_APT_PACKAGES`). |
| **Services on your machine** | `localhost` in the container is the container itself | Use `host.docker.internal` (Docker Desktop, OrbStack). |

## Windows notes

- Use **Docker Desktop with the WSL 2 backend** and Linux containers.
- Run `pi-foundry.cmd` from PowerShell or cmd, or `./pi-foundry` from Git Bash. Projects under `C:\…` and `\\wsl$\…` both work. For the best file performance, keep projects inside your WSL distro and run `./pi-foundry` from WSL.
- Scripts are checked out with LF line endings (`.gitattributes`), even with `core.autocrlf=true`, so the container works from a Windows clone.
- The Windows Azure CLI token cache is encrypted, so sign in once with `pi-foundry login`.
