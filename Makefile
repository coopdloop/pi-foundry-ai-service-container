# Convenience targets. Everything is plain `docker compose` underneath.
.PHONY: help build rebuild run doctor models login shell install docs docs-serve

help:  ## Show targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

build:  ## Build the image with the newest pi release
	./scripts/build.sh

rebuild:  ## Rebuild from scratch (fresh base image, apt, az, pi)
	./scripts/build.sh --pull --no-cache

run:  ## Start pi in this repo (run ./pi-foundry from other projects)
	./pi-foundry

doctor:  ## Check sign-in, discovery, RBAC and network
	./pi-foundry doctor

models:  ## List Foundry deployments pi will use
	./pi-foundry models

login:  ## Device-code sign-in stored in a Docker volume
	./pi-foundry login

shell:  ## Bash inside the container (signed in)
	./pi-foundry shell

install:  ## Put pi-foundry on your PATH (~/.local/bin)
	./pi-foundry install

docs:  ## Build the docs site into ./site
	pip install -q -r docs/requirements.txt && mkdocs build --strict

docs-serve:  ## Preview the docs at http://127.0.0.1:8000
	pip install -q -r docs/requirements.txt && mkdocs serve
