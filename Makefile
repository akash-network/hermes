BASH_PATH          := $(shell which bash)
SHELL              := $(BASH_PATH)

export GO111MODULE=on

PHONY: release-dryrun
release-dryrun:
	@echo "building base image"
	goreleaser release -f .goreleaser.yaml --clean --parallelism=1 --skip=publish,validate --snapshot


PHONY: release
release:
	@echo "building base image"
	goreleaser release -f .goreleaser.yaml --clean --parallelism=1

.PHONY: npm-install
npm-install: ## Install npm dependencies
	npm install

.PHONY: npm-build
npm-build: npm-install ## Build TypeScript
	npm run build

# ===================
# Development Commands
# ===================

.PHONY: run
run: ## Run the client locally (requires .env)
	npm run cli:daemon
