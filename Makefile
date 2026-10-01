# Atalhos para rodar o projeto. `make` sozinho mostra a ajuda.
# Local: exige Node 24 (nvm use 24) e pnpm (corepack enable).
# Docker: só exige Docker.

SHELL := /bin/bash
export UID := $(shell id -u)
export GID := $(shell id -g)

COMPOSE := docker compose

.DEFAULT_GOAL := help
.PHONY: help setup check-node install dev test lint typecheck demo seed backup \
        clean-test-db up up-prod down logs shell docker-test docker-demo docker-build

help: ## Mostra os comandos disponíveis
	@grep -hE '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

# --- configuração -----------------------------------------------------------

setup: ## Cria .env e config/business.json a partir dos exemplos (não sobrescreve)
	@test -f .env || { cp .env.example .env && echo "criado .env"; }
	@test -f config/business.json || { cp config/business.example.json config/business.json && echo "criado config/business.json — preencha-o"; }

# --- local (Node 24 + pnpm na máquina) --------------------------------------

check-node:
	@node -v | grep -q '^v24\.' || { echo "Node 24 necessário (atual: $$(node -v)). Rode: nvm use 24"; exit 1; }
	@command -v pnpm >/dev/null || { echo "pnpm não encontrado. Rode: corepack enable"; exit 1; }

install: check-node ## Instala as dependências
	pnpm install

dev: check-node setup ## Roda painel + worker (http://127.0.0.1:4319)
	pnpm dev

test: check-node ## Roda os testes
	pnpm test

lint: check-node ## ESLint
	pnpm lint

typecheck: check-node ## Verificação de tipos
	pnpm typecheck

demo: check-node ## Demo ponta a ponta (browser simulado + IA mock)
	pnpm demo

seed: check-node ## Popula o painel com dados de demonstração
	pnpm seed

backup: check-node ## Backup manual do SQLite
	pnpm backup

clean-test-db: ## Apaga as bases de teste deixadas em data/
	rm -f data/test-*.db data/test-*.db-shm data/test-*.db-wal

# --- Docker -----------------------------------------------------------------

docker-build: ## Constrói a imagem de desenvolvimento
	$(COMPOSE) --profile dev build app

up: setup ## Roda em Docker com hot reload (http://127.0.0.1:4319)
	$(COMPOSE) --profile dev up --build app

up-prod: setup ## Roda a build de produção em Docker, em segundo plano
	$(COMPOSE) --profile prod up --build -d prod

down: ## Para os contentores
	$(COMPOSE) --profile dev --profile prod down

logs: ## Segue os logs da produção
	$(COMPOSE) --profile prod logs -f prod

shell: ## Abre um shell no contentor de desenvolvimento
	$(COMPOSE) --profile dev run --rm app bash

docker-test: ## Roda os testes dentro do Docker
	$(COMPOSE) --profile dev run --rm app pnpm test

docker-demo: ## Roda a demo dentro do Docker
	$(COMPOSE) --profile dev run --rm app pnpm demo
