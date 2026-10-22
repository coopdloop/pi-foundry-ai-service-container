# syntax=docker/dockerfile:1.7
#
# pi (coding agent) + Azure CLI + keyless Azure AI Foundry provider.
# Build:  make build           (resolves the newest pi release)
#    or:  docker compose build --build-arg PI_VERSION=latest --no-cache

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim

# Exact pi version to install. `make build` passes the newest release so the
# layer cache busts only when pi actually ships something new.
ARG PI_VERSION=latest
# Extra Debian packages your projects need (e.g. "python3 python3-venv golang").
ARG EXTRA_APT_PACKAGES=""

ENV DEBIAN_FRONTEND=noninteractive

# Everyday development tooling: shell utils, compilers, Python, editors.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl wget git gnupg gosu jq less lsb-release make \
      openssh-client procps ripgrep fd-find tree file rsync unzip zip xz-utils tini \
      build-essential pkg-config \
      python3 python3-venv python3-pip python3-dev \
      sqlite3 nano vim-tiny \
      ${EXTRA_APT_PACKAGES} \
 && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
 && ln -sf /usr/bin/python3 /usr/local/bin/python \
 && git config --system --add safe.directory '*' \
 && rm -rf /var/lib/apt/lists/*

# Docker CLI + compose/buildx plugins. They talk to the host's Docker through
# the mounted socket; no daemon runs in this image.
RUN install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
 && chmod a+r /etc/apt/keyrings/docker.gpg \
 && printf 'Types: deb\nURIs: https://download.docker.com/linux/debian\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-by: /etc/apt/keyrings/docker.gpg\n' \
      "$(lsb_release -cs)" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/* \
 && docker --version

# uv: fast Python package/project manager (also installs other Python versions).
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Azure CLI from Microsoft's apt repo (amd64 + arm64).
RUN mkdir -p /etc/apt/keyrings \
 && curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /etc/apt/keyrings/microsoft.gpg \
 && chmod go+r /etc/apt/keyrings/microsoft.gpg \
 && printf 'Types: deb\nURIs: https://packages.microsoft.com/repos/azure-cli/\nSuites: %s\nComponents: main\nArchitectures: %s\nSigned-by: /etc/apt/keyrings/microsoft.gpg\n' \
      "$(lsb_release -cs)" "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/azure-cli.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends azure-cli \
 && rm -rf /var/lib/apt/lists/* \
 && az version -o tsv >/dev/null

# pi itself, always a fresh install from npm.
RUN npm install -g --ignore-scripts --no-fund --no-audit "@earendil-works/pi-coding-agent@${PI_VERSION}" pnpm \
 && npm cache clean --force \
 && pi --version && pnpm --version

# Non-root user. The entrypoint remaps its UID/GID to match your workspace
# so files the agent writes are owned by you on the host.
RUN userdel -r node 2>/dev/null || true \
 && groupadd -g 1000 pi && useradd -m -u 1000 -g 1000 -s /bin/bash pi \
 && mkdir -p /home/pi/.pi/agent /home/pi/.azure /home/pi/.cache \
 && chown -R pi:pi /home/pi

COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chmod=0755 docker/pi-foundry /usr/local/bin/pi-foundry
COPY lib /opt/pi-foundry/lib
COPY bin /opt/pi-foundry/bin
COPY extension /opt/pi-foundry/extension
COPY permissions /opt/pi-foundry/permissions
COPY themes /opt/pi-foundry/themes
COPY config/foundry.example.json /opt/pi-foundry/foundry.example.json

ENV PI_FOUNDRY_HOME=/opt/pi-foundry \
    AZURE_CONFIG_DIR=/home/pi/.azure \
    AZURE_CORE_COLLECT_TELEMETRY=false \
    AZURE_CORE_NO_COLOR=1 \
    NODE_USE_ENV_PROXY=1 \
    COLORTERM=truecolor \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    UV_LINK_MODE=copy \
    NPM_CONFIG_CACHE=/home/pi/.cache/npm \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PNPM_HOME=/home/pi/.local/share/pnpm \
    npm_config_store_dir=/home/pi/.cache/pnpm-store \
    PATH=/home/pi/.local/bin:/home/pi/.local/share/pnpm:$PATH

LABEL org.opencontainers.image.title="pi-foundry" \
      org.opencontainers.image.description="pi coding agent with keyless (Entra ID) access to Azure AI Foundry models" \
      org.opencontainers.image.source="https://github.com/coopdloop/pi-foundry-ai-service-container" \
      org.opencontainers.image.licenses="MIT"

WORKDIR /workspace
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD []
