# Convenience targets. Everything is plain `docker compose` underneath.
.PHONY: help build rebuild run doctor models login shell alias docs docs-serve

help:  ## Show targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

build:  ## Build the image with the newest pi release
	./scripts/build.sh

rebuild:  ## Rebuild from scratch (fresh base image, apt, az, pi)
	./scripts/build.sh --pull --no-cache

run:  ## Start pi in this repo (use the alias for other projects)
	docker compose run --rm pi

doctor:  ## Check sign-in, discovery, RBAC and network
	docker compose run --rm pi doctor

models:  ## List Foundry deployments pi will use
	docker compose run --rm pi models

login:  ## Device-code sign-in stored in a Docker volume
	docker compose run --rm pi login

shell:  ## Bash inside the container (signed in)
	docker compose run --rm pi shell

alias:  ## Print a shell alias to run pi-foundry from any directory
	@echo "alias pi-foundry='docker compose -f $(CURDIR)/compose.yaml run --rm pi'"

docs:  ## Build the docs site into ./site
	pip install -q -r docs/requirements.txt && mkdocs build --strict

docs-serve:  ## Preview the docs at http://127.0.0.1:8000
	pip install -q -r docs/requirements.txt && mkdocs serve
