# syntax=docker/dockerfile:1.7
# SERVICE picks what to build and the final stage (Railway can't pass --target): api | workers | web
ARG SERVICE=api
# Multi-stage build for the Remindora backend services and web app. Each image is built from a
# `turbo prune` of just that app and the packages it uses, so it never carries the mobile/desktop
# toolchains (keeps images small enough to export reliably).
#   docker build --build-arg SERVICE=api     -t remindora-api .
#   docker build --build-arg SERVICE=workers -t remindora-workers .
#   docker build --build-arg SERVICE=web     -t remindora-web --build-arg NEXT_PUBLIC_API_URL=https://api.example.com .

FROM node:24-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS pruner
ARG SERVICE
COPY . .
RUN npx -y turbo@2.11.10 prune @remindora/${SERVICE} --docker

FROM base AS deps
COPY --from=pruner /app/out/json/ ./
# redis-memory-server (local dev only) would otherwise compile Redis from source here.
ENV REDISMS_DISABLE_POSTINSTALL=1
RUN npm ci --ignore-scripts=false --no-audit --no-fund

FROM deps AS build
ARG SERVICE
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=
ARG NEXT_PUBLIC_AUTH_SAME_ORIGIN=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY NEXT_PUBLIC_AUTH_SAME_ORIGIN=$NEXT_PUBLIC_AUTH_SAME_ORIGIN NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
COPY --from=pruner /app/out/full/ ./
COPY tsconfig.base.json ./
RUN npx turbo run build --filter=@remindora/${SERVICE}

# ── API ──
FROM base AS api
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Migrations run as a release step (see render.yaml / README). Platforms without one set MIGRATE_ON_START=true.
CMD ["sh", "-c", "if [ \"$MIGRATE_ON_START\" = true ]; then (cd /app/packages/database && node /app/node_modules/prisma/build/index.js migrate deploy) || exit 1; fi; exec node --enable-source-maps dist/main.js"]

# ── Workers ──
FROM base AS workers
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/workers
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]

# ── Web (Next.js standalone) ──
FROM node:24-bookworm-slim AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ── Default final stage, chosen by SERVICE ──
FROM ${SERVICE} AS final
