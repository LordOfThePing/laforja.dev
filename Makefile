# Deploy de La Forja al VPS. `make help` lista los targets.
# Corre desde tu máquina (por SSH) o dentro del VPS en /opt/laforja (directo).

# Make para Windows usa cmd.exe si no hay sh.exe en el PATH, y las recetas
# necesitan grep/awk/test. Forzamos el bash de Git for Windows (no el de
# System32, que es WSL). Otra ruta: make GIT_BIN=...
ifeq ($(OS),Windows_NT)
GIT_BIN ?= C:/Program Files/Git/usr/bin
SHELL := $(GIT_BIN)/bash.exe
export PATH := $(GIT_BIN);$(PATH)
# Con un SHELL tipo Unix, make de Windows igual ejecuta las líneas "simples"
# (sin ; | && etc.) por CreateProcess y no encuentra scp/ssh. .ONESHELL fuerza
# que toda receta pase por bash; -e mantiene el corte al primer error.
.ONESHELL:
.SHELLFLAGS := -ec
endif

SSH_HOST   ?= laforja
REMOTE_DIR ?= /opt/laforja
REPO_URL   ?= https://github.com/LordOfThePing/laforja.dev.git
BRANCH     ?= main
ENV_FILE   ?= .env.production
SERVICE    ?=

ON_VPS ?= $(if $(filter $(REMOTE_DIR),$(CURDIR)),1)

ifeq ($(ON_VPS),1)
REMOTE     := sh -c
REMOTE_TTY := sh -c
else
# El alias SSH abre una shell en /opt/laforja con RemoteCommand + RequestTTY;
# ssh rechaza RemoteCommand junto con un comando (y scp/sftp), así que se anulan acá.
SSH_OPTS   := -o RemoteCommand=none
REMOTE     := ssh $(SSH_OPTS) -o RequestTTY=no $(SSH_HOST)
REMOTE_TTY := ssh $(SSH_OPTS) -t $(SSH_HOST)
endif
RCOMPOSE = $(REMOTE) "cd $(REMOTE_DIR) && docker compose $(1)"

.DEFAULT_GOAL := help
.PHONY: help setup env-push env-diff local-only check-pushed deploy up down restart ps logs \
        migrate seed reconcile psql shell backup backups backup-pull dev-up dev-down dev-seed test

help: ## Lista los targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-13s %s\n", $$1, $$2}'

# --- VPS ---------------------------------------------------------------------

setup: ## Primera vez: clona el repo en el VPS
	$(REMOTE) "test -d $(REMOTE_DIR)/.git || git clone --branch $(BRANCH) $(REPO_URL) $(REMOTE_DIR)"

env-push: local-only ## Sube .env.production (o ENV_FILE=...) al VPS como .env (permisos 600)
	@test -f $(ENV_FILE) || { echo "Falta $(ENV_FILE) (copiá .env.example y completalo)"; exit 1; }
	scp $(SSH_OPTS) $(ENV_FILE) $(SSH_HOST):$(REMOTE_DIR)/.env.tmp
	$(REMOTE) "chmod 600 $(REMOTE_DIR)/.env.tmp && mv $(REMOTE_DIR)/.env.tmp $(REMOTE_DIR)/.env"

env-diff: local-only ## Compara los nombres de variables de .env.production con el .env del VPS (solo nombres)
	@grep -E '^[A-Z_]+=' $(ENV_FILE) | cut -d= -f1 | sort > "$${TMPDIR:-/tmp}/laforja-env-keys"
	@$(REMOTE) "grep -E '^[A-Z_]+=' $(REMOTE_DIR)/.env | cut -d= -f1 | sort" \
		| diff "$${TMPDIR:-/tmp}/laforja-env-keys" - && echo "Mismas variables."

local-only:
ifeq ($(ON_VPS),1)
	@echo "Este target se corre desde tu máquina, no desde el VPS"; exit 1
endif

# El VPS hace pull desde GitHub: deployar con commits locales sin pushear subiría otra cosa.
# En el VPS no aplica: el propio deploy lo pone al día con origin.
check-pushed:
ifneq ($(ON_VPS),1)
	@git fetch -q origin $(BRANCH)
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse origin/$(BRANCH))" \
		|| { echo "HEAD local no coincide con origin/$(BRANCH): pusheá (o pulleá) antes de deployar"; exit 1; }
endif

deploy: check-pushed ## Pull en el VPS + build + up (migrate corre solo antes de api)
	$(REMOTE) "cd $(REMOTE_DIR) && git fetch origin $(BRANCH) && git checkout $(BRANCH) && git pull --ff-only origin $(BRANCH)"
	$(call RCOMPOSE,up -d --build --wait --remove-orphans)
	$(call RCOMPOSE,ps)

up: ## docker compose up -d en el VPS (sin pull ni build)
	$(call RCOMPOSE,up -d --wait)

down: ## docker compose down en el VPS (el volumen de Postgres se conserva)
	$(call RCOMPOSE,down)

restart: ## Reinicia un servicio: make restart SERVICE=api
	$(call RCOMPOSE,restart $(SERVICE))

ps: ## Estado de los contenedores en el VPS
	$(call RCOMPOSE,ps)

logs: ## Sigue los logs: make logs [SERVICE=api]
	$(REMOTE_TTY) "cd $(REMOTE_DIR) && docker compose logs -f --tail=200 $(SERVICE)"

migrate: ## Corre las migraciones en el VPS
	$(call RCOMPOSE,run --rm migrate)

seed: ## Corre el seed en el VPS (idempotente)
	$(call RCOMPOSE,run --rm api bun run db:seed)

reconcile: ## Reconcilia las suscripciones con MP ahora: make reconcile [DRY=1] (DRY=1 solo muestra)
	$(call RCOMPOSE,exec -T api bun run reconcile $(if $(DRY),--dry-run))

psql: ## Consola psql en el Postgres del VPS
	$(REMOTE_TTY) "cd $(REMOTE_DIR) && docker compose exec postgres psql -U laforja laforja"

shell: ## Shell en un contenedor: make shell SERVICE=api
	@test -n "$(SERVICE)" || { echo "Indicá SERVICE=api|web|postgres"; exit 1; }
	$(REMOTE_TTY) "cd $(REMOTE_DIR) && docker compose exec $(SERVICE) sh"

backup: ## Hace un backup de la DB ahora (además del diario automático)
	$(call RCOMPOSE,exec -T backup backup.sh)

backups: ## Lista los backups guardados en el VPS
	$(call RCOMPOSE,exec -T backup ls -lh /backups)

# Copia fuera del VPS sin bucket: baja el último dump y compara el sha256 con el del VPS.
backup-pull: local-only ## Baja el último backup del VPS a ./backups/
	@mkdir -p backups
	@name=$$($(REMOTE) "cd $(REMOTE_DIR) && docker compose exec -T backup sh -c 'ls /backups/laforja-*.dump | tail -n1'"); \
	test -n "$$name" || { echo "No hay backups en el VPS"; exit 1; }; \
	dest="backups/$$(basename "$$name")"; \
	$(REMOTE) "cd $(REMOTE_DIR) && docker compose exec -T backup cat $$name" > "$$dest"; \
	remote_sum=$$($(REMOTE) "cd $(REMOTE_DIR) && docker compose exec -T backup sha256sum $$name" | cut -d' ' -f1); \
	test "$$remote_sum" = "$$(sha256sum "$$dest" | cut -d' ' -f1)" || { echo "sha256 no coincide: $$dest"; rm -f "$$dest"; exit 1; }; \
	echo "OK: $$dest"

# --- Local -------------------------------------------------------------------

dev-up: ## Levanta todo local con Docker (usa .env de la raíz)
	docker compose up -d --build --wait

dev-down: ## Baja el stack local
	docker compose down

dev-seed: ## Seed del stack local
	docker compose run --rm api bun run db:seed

test: ## Typecheck + tests de apps/api
	cd apps/api && bun run typecheck && bun test
