# Node 24 LTS on Debian (glibc) so better-sqlite3's linux-x64 prebuild loads.
FROM node:24-bookworm-slim AS base
# The container runs as the host user's UID (see docker-compose.yml), so every
# cache it touches must live somewhere any user can write.
ENV HOME=/tmp \
    COREPACK_HOME=/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && mkdir -p /corepack && chmod a+rwx /corepack
WORKDIR /app

# Dependencies only, so source edits don't bust the install layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack install && pnpm install --frozen-lockfile \
 && chmod -R a+rwX /corepack

# Development: panel + worker with hot reload (source is bind-mounted by compose).
FROM deps AS dev
COPY . .
RUN mkdir -p .next data backups && chmod -R a+rwX .next data backups node_modules
EXPOSE 4319
CMD ["pnpm", "dev"]

# Production: built panel + worker.
FROM deps AS prod
COPY . .
ENV NODE_ENV=production
RUN pnpm exec next build && mkdir -p data backups && chmod -R a+rwX .next data backups
EXPOSE 4319
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]
