# syntax=docker/dockerfile:1.7
# Multi-stage build para Next.js 16 standalone — T-022.5, ADR-0007.
#
# Stage 1 (deps): resuelve dependencies con pnpm contra el lockfile.
# Stage 2 (builder): corre `pnpm build` con todas las env vars necesarias.
# Stage 3 (runner): imagen final mínima (Node 22 alpine + .next/standalone).
#
# Node 22 LTS alpine matchea CI (.github/workflows/ci.yml). pnpm 11.0.9
# fijado para matchear package.json packageManager field.

# ─── Stage 1: dependencias ──────────────────────────────────────────────────
FROM node:26.3.1-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# pnpm via corepack (viene con Node 22). Versión fijada al packageManager
# field de package.json para evitar drift.
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

COPY package.json pnpm-lock.yaml ./

# --ignore-scripts (T-022.5-FU) bypasea 2 issues en el build de EasyPanel:
#   1. pnpm 11+ ERR_PNPM_IGNORED_BUILDS: el field package.json pnpm.onlyBuiltDependencies
#      no es suficiente en este entorno (whitelist queda ignorada y promociona a fatal).
#   2. husky "prepare" postinstall falla con `.git can't be found` porque `.dockerignore`
#      excluye `.git` correctamente — husky no tiene heuristica para detectar build context.
# Skip-eando TODOS los postinstalls evita ambos.
#
# `pnpm rebuild` después construye explícitamente los packages que SÍ necesitan native
# binaries en runtime del container:
#   - sharp: image optimization (Next.js image runtime).
#   - esbuild: bundler nativo (Next dev/build pero también ciertas runtime paths).
# Otros packages whitelisted (@sentry/cli, supabase, unrs-resolver) NO necesitan rebuild:
# @sentry/cli solo se usa build-time (upload source maps), supabase es devDependency
# (no llega al runner stage), unrs-resolver es transitivo y se resuelve sin native.
RUN pnpm install --frozen-lockfile --ignore-scripts \
 && pnpm rebuild sharp esbuild

# ─── Stage 2: build ─────────────────────────────────────────────────────────
FROM node:26.3.1-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Env vars necesarias en build-time:
# - NEXT_PUBLIC_* se inlinean en el bundle del cliente.
# - SUPABASE_SERVICE_ROLE_KEY + ANTHROPIC_API_KEY: src/env.ts las valida al
#   load (zod schema), aunque el bundle del cliente no las contiene gracias
#   a `import 'server-only'` en env.ts.
# - SENTRY_* se usan para upload de source maps si SENTRY_AUTH_TOKEN está
#   presente. Sin token, el plugin omite silenciosamente.
# - SENTRY_RELEASE: el deploy webhook lo pasa con el SHA del commit.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG SUPABASE_SERVICE_ROLE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG SENTRY_ORG
ARG SENTRY_PROJECT
ARG SENTRY_AUTH_TOKEN
ARG NEXT_PUBLIC_SITE_URL
ARG ANTHROPIC_API_KEY
ARG SENTRY_RELEASE
ARG RESEND_API_KEY
ARG RESEND_FROM_ADDRESS
ARG RESEND_REPLY_TO_ADDRESS
ARG INTERNAL_CRON_SECRET
ARG TELEGRAM_BOT_TOKEN
ARG TELEGRAM_BOT_USERNAME
ARG TELEGRAM_WEBHOOK_SECRET
ARG VAPID_PRIVATE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG VAPID_SUBJECT
# T-081: rate limiting via Upstash Redis. Optional en src/env.ts — si no se
# pasan vars, getRateLimiter devuelve un noop stub. En prod ambas SE DEBEN
# pasar para que el rate limit aplique. Ver docs/operations/rate-limiting.md.
ARG UPSTASH_REDIS_REST_URL
ARG UPSTASH_REDIS_REST_TOKEN
# T-081: GIT_SHA opcional para exponer la versión deployada en /api/health.
# Si no se pasa, el endpoint reporta `version: 'dev'`. Workflow CI/EasyPanel
# auto-deploy puede inyectarlo con el SHA del commit.
ARG GIT_SHA
# T-070: precio del plan Pro en centavos ARS (string regex /^\d+$/). src/env.ts
# lo valida al cargar el módulo en build time — el plugin Next "Collecting
# page data" carga env.ts y safeParse falla si la var no está. Valor real
# inyectado por EasyPanel Build Arguments post-merge.
ARG ARS_PRICE_MONTHLY
# T-071: credenciales Mercado Pago Subscriptions (preapproval + webhook HMAC).
# src/env.ts marca ambas required (min 40 / min 32), mismo razonamiento que
# T-070-FU1: Next.js carga env.ts en build → falla si faltan. EasyPanel
# Build Arguments deben inyectar los valores reales TEST-... / APP_USR-...
# post-merge. Ver docs/operations/mercadopago-setup.md (futuro).
ARG MP_ACCESS_TOKEN
ARG MP_WEBHOOK_SECRET

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    SENTRY_ORG=$SENTRY_ORG \
    SENTRY_PROJECT=$SENTRY_PROJECT \
    SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY \
    SENTRY_RELEASE=$SENTRY_RELEASE \
    RESEND_API_KEY=$RESEND_API_KEY \
    RESEND_FROM_ADDRESS=$RESEND_FROM_ADDRESS \
    RESEND_REPLY_TO_ADDRESS=$RESEND_REPLY_TO_ADDRESS \
    INTERNAL_CRON_SECRET=$INTERNAL_CRON_SECRET \
    TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN \
    TELEGRAM_BOT_USERNAME=$TELEGRAM_BOT_USERNAME \
    TELEGRAM_WEBHOOK_SECRET=$TELEGRAM_WEBHOOK_SECRET \
    VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY \
    NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY \
    VAPID_SUBJECT=$VAPID_SUBJECT \
    UPSTASH_REDIS_REST_URL=$UPSTASH_REDIS_REST_URL \
    UPSTASH_REDIS_REST_TOKEN=$UPSTASH_REDIS_REST_TOKEN \
    GIT_SHA=$GIT_SHA \
    ARS_PRICE_MONTHLY=$ARS_PRICE_MONTHLY \
    MP_ACCESS_TOKEN=$MP_ACCESS_TOKEN \
    MP_WEBHOOK_SECRET=$MP_WEBHOOK_SECRET \
    NEXT_TELEMETRY_DISABLED=1

RUN pnpm build

# ─── Stage 3: runner ────────────────────────────────────────────────────────
FROM node:26.3.1-alpine AS runner
WORKDIR /app

# Chromium para generación de PDFs (T-023). puppeteer-core usa este binario
# vía CHROMIUM_PATH — NO descarga su propio Chromium en npm install
# (PUPPETEER_SKIP_DOWNDLOAD=true).
#
# Paquetes:
#   - chromium: el binario (~150 MB instalado).
#   - nss: bibliotecas crypto que Chromium usa para TLS.
#   - freetype + harfbuzz: rendering de fuentes.
#   - ttf-freefont + ttf-dejavu + font-noto: fuentes mínimas para Latin
#     (acentos español en informes argentinos) + fallback Noto para CJK.
#   - ca-certificates: presente en alpine base, lo declaramos explícito.
#
# Impacto en tamaño imagen: +~250 MB sobre la base post-T-022.5 (~350 MB) →
# imagen final ~600 MB. VPS Hostinger tiene 8 GB RAM + 100 GB disco — no es
# bloqueante. EasyPanel pull-rebuild tarda ~30s más.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      ttf-dejavu \
      font-noto \
      tzdata

# T-085: TZ del container = AR. Defense-in-depth — el helper format-date ya
# hardcodea timeZone: AR_TIMEZONE en cada Intl.DateTimeFormat, por lo que el
# display de fechas es inmune al runtime TZ. Pero seteamos TZ acá igual para
# que logs, cron triggers y código legacy (que no haya migrado al helper)
# vean fechas AR. NO se aplica al stage builder — el build debe correr en UTC
# para no leakear TZ a páginas estáticas pre-renderizadas.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROMIUM_PATH=/usr/bin/chromium-browser \
    TZ=America/Argentina/Buenos_Aires

# User no-root: defensa estándar contra container escape + cumple PoLP.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# `output: 'standalone'` (next.config.ts) emite server.js + node_modules
# mínimos en .next/standalone. .next/static y public se copian aparte.
# Ver https://nextjs.org/docs/app/api-reference/config/next-config-js/output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# Healthcheck definido a nivel EasyPanel (HTTP GET /, no acá). Razón: el
# healthcheck de Docker compite con el de EasyPanel y suma latencia sin
# beneficio — la fuente de verdad es Traefik upstream.

CMD ["node", "server.js"]
