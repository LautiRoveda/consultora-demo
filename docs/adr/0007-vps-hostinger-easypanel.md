# ADR-0007 · Migración deployment Vercel → VPS Hostinger + EasyPanel + Docker

**Fecha:** 2026-05-12
**Estado:** Aceptada (reemplaza parcialmente ADR-0005 — Vercel queda como hot backup 4 semanas, después se decommission)
**Decisor:** Lautaro
**Consultados:** Claude Code (architectural review)

## Contexto

T-020 introdujo generación de contenido de informes con Claude API (Sonnet 4.6). T-022 completó los 5 tipos con templates parametrizados (RGRL, capacitación, relevamiento, accidente, otros). Los outputs producidos en preview/prod **se truncan sistemáticamente** porque `max_tokens=4096` y el modelo necesita 6-8k para los informes largos:

- Capacitación: corta en Anexo D.
- Accidente: corta en sección 7 (hallazgos).
- Relevamiento: corta en tabla 4.3 (ergonomía).
- Otros: corta en 5.4.2.

El cap existe porque Vercel Hobby tier impone **timeout de 10s** en serverless functions. Una llamada a Sonnet 4.6 generando 8k tokens supera ese límite. Vercel Pro lo lleva a 60s pero cuesta **USD 20/mes** (sobre el Pro plan completo, no granular).

Lautaro ya tiene un **VPS Hostinger Ubuntu 24.04 KVM 2** funcionando con **EasyPanel v2.30+** (orquestador Docker + Traefik + Let's Encrypt) hospedando otros proyectos (`agendalo`, `aruba`). Hay capacidad ociosa: ~4.5 GB RAM libres, ~70 GB disco libres, 2 cores al 2.6% de uso. El VPS está prepago con costo marginal cero para sumar un service nuevo.

Dominio `test-ia.cloud` ya registrado. Subdomain `consultora-demo.test-ia.cloud` con DNS A record apuntando al VPS.

## Opciones evaluadas

### Opción A: Vercel Pro (USD 20/mes)

- **Pros:**
  - 0 cambios de código (solo levantar `max_tokens` en una línea).
  - 0 cambios operacionales (mismo flow PR → preview → merge → prod).
  - SSL, CDN, edge runtime, preview deploys, monitoring, todo managed.
  - Rollback instantáneo built-in.
- **Contras:**
  - USD 20/mes recurrente (USD 240/año).
  - El plan se factura "todo o nada" — no escala con uso real (ConsultoraDemo en Sprint 2 hace ~30 calls a Claude API por mes).
  - Bandwidth + execution caps siguen existiendo, solo más altos.
- **Costo / esfuerzo:** 0 horas de trabajo, USD 20/mes operacional.

### Opción B: Railway / Fly.io (PaaS alternativo)

- **Pros:**
  - PaaS-style, deploy via Dockerfile o buildpack.
  - Free tier limitado (Railway: USD 5 crédito mensual; Fly.io: 3 VMs free tier).
  - Sin timeout serverless — corren containers persistentes.
- **Contras:**
  - Free tier tight para algo de prod sostenido — terminás pagando USD 5-15/mes.
  - Lock-in de plataforma (configs específicas).
  - Cold starts en free tier.
  - Sin co-tenancy con otros servicios propios.
- **Costo / esfuerzo:** ~4 horas de setup, USD 5-15/mes.

### Opción C: VPS Hostinger + EasyPanel + Docker (elegida)

- **Pros:**
  - Costo marginal **cero** (VPS ya alquilado para otros proyectos).
  - Sin timeout de plataforma — `max_tokens` libre hasta el cap teórico del modelo (Sonnet 4.6: 64k output).
  - Control total: SSH, logs en disco, container orchestration via EasyPanel, futuras side-cars (cron, workers, Resend queue).
  - EasyPanel resuelve lo molesto del self-host: SSL Let's Encrypt automático, reverse proxy Traefik, deploys via UI con click "Implementar".
  - Mismo runtime que CI (Node 22 alpine).
- **Contras:**
  - **Operacional**: asumimos responsabilidad de SSL renewal (mitigado por EasyPanel auto), OS patching, backups (DB ya está en Supabase managed, container es stateless), monitoring de uptime.
  - **Sin preview deploys automáticos por PR** (Vercel los hacía out-of-the-box). Workaround: spawn manual de service apuntando a branch desde EasyPanel UI cuando se necesita.
  - **Cotenancy con otros projects** (`agendalo`, `aruba`) — riesgo de tocar algo ajeno por accidente. Mitigado por reglas estrictas en memory (`feedback_vps_cotenant_safety.md`).
  - **Single point of failure**: si el VPS cae, el sitio cae. Sin multi-region.
- **Costo / esfuerzo:** ~6-8 horas de setup (este ticket), USD 0/mes incremental.

## Decisión

**Opción C: VPS Hostinger + EasyPanel + Docker.**

Razones principales:

1. **Costo**: USD 0 vs USD 240/año Vercel Pro o USD 60-180/año Railway. Ahorro real para un proyecto early-stage.
2. **Aprendizaje**: control total ayuda a entender el stack y prepara para escenarios futuros (workers, crons, side-cars).
3. **Sin timeout**: `max_tokens=8192` hoy, libre para subir si en el futuro se necesita. Cero presión arquitectural por límites de plataforma.
4. **Reaprovechamiento de infra**: el VPS está alquilado y subutilizado. Marginal cost = 0.

Aceptamos como tradeoffs: pérdida de preview deploys automáticos, responsabilidad de uptime, complejidad operacional menor (manejable con runbook en [06-deployment.md](../technical/06-deployment.md)).

### Sub-decisiones derivadas

- **Build method**: **Dockerfile multi-stage** (no Nixpacks/buildpack). Reproducible, version-pinned, inspeccionable, matchea CI.
- **Node version**: **22 LTS alpine** matcheando `.github/workflows/ci.yml`. `@supabase/realtime-js` requiere WS nativo de Node 22.
- **Next.js output**: **`'standalone'`** en `next.config.ts`. Reduce imagen de ~1.2 GB a ~150 MB.
- **Build location**: **dentro de EasyPanel** (no en GitHub Actions + push GHCR). Más simple para Sprint 2; fallback documentado si OOM.
- **Deploy trigger**: **Auto Deploy activo** (activado el 2026-06-17) — el push/merge a `main` dispara `docker build` + redeploy **del código** sin intervención (webhook GitHub → EasyPanel). Sin job de deploy en `.github/workflows/ci.yml`: el código lo publica el webhook de EasyPanel. **Histórico**: en la migración original (T-022.5) EasyPanel v2.30.0 Self-Hosted no exponía Auto Deploy ni webhook URL custom (se probaron 2 approaches automáticos —job custom en GH Actions con webhook + Auto Deploy nativo— sin éxito) → se aceptó **click manual "Implementar"**; el auto recién quedó disponible y se activó el 2026-06-17 (ver bloque T-022.5-FU3 abajo). Gate de CI verde por `main` protegida (required checks). El click "Implementar" queda como **fallback manual** si el auto falla.
- **`max_tokens`**: **hardcode 8192** en `actions.ts` (no env var). 1 fuente de verdad, requiere PR para cambiar.
- **EasyPanel project placement**: dentro del project existente **`agendalo`** (no project nuevo) — política de Lautaro para evitar fragmentación. Cotenants intocables.
- **Hot backup Vercel**: 4 semanas post-cutover, auto-deploy pausado (no Disconnect). Cubre ciclo recovery + margen para regresiones tardías.

## Service config — valores literales para crear en EasyPanel UI

Esta sección es **operacional** — Lautaro la sigue campo por campo en EasyPanel UI.

### Crear el Service

1. EasyPanel → Project **`agendalo`** → botón "+" → **App**.
2. Nombre del Service: **`consultora-demo`**.

### General

| Campo | Valor literal |
|---|---|
| Service name | `consultora-demo` |
| Project | `agendalo` (existente, no crear nuevo) |

### Source

| Campo | Valor literal |
|---|---|
| Source type | GitHub |
| Repository | `LautiRoveda/consultora-demo` |
| Branch | `chore/T-022.5-vps-migration` (inicial, para smoke pre-merge) → cambiar a `main` después de PARADA #2 verde |
| Auto deploy on push | **ON · activado 2026-06-17** (webhook GitHub → EasyPanel; push a `main` → rebuild del código). En la migración original (v2.30.0) no se exponía → se aceptó click manual; cerrado en T-022.5-FU3. Fallback manual: "Implementar". |

### Build

| Campo | Valor literal |
|---|---|
| Build method | **Dockerfile** |
| Dockerfile path | `./Dockerfile` |
| Build context | `/` (root) |
| Build args | (Vacío. EasyPanel pasa automáticamente las env vars del Service como `--build-arg` para los `ARG` declarados en el Dockerfile). |

### Network / Domain

| Campo | Valor literal |
|---|---|
| Container port | `3000` |
| Public domain | `consultora-demo.test-ia.cloud` |
| Force HTTPS | **ON** |
| SSL | Let's Encrypt (default, sin acción explícita) |

### Runtime

| Campo | Valor literal |
|---|---|
| Restart policy | `unless-stopped` |
| Replicas | `1` |
| CPU limit | Sin límite explícito (deja default) |
| Memory limit | Sin límite explícito (deja default — 8 GB VPS total) |

### Healthcheck

| Campo | Valor literal |
|---|---|
| Type | HTTP |
| Path | `/` |
| Port | `3000` (interno) |
| Interval | `30s` |
| Timeout | `5s` |
| Retries | `3` |
| Initial delay | `15s` (cold start margin para Next standalone) |

### Environment variables (a cargar manualmente en EasyPanel)

Las 9 variables del `.env.example`, valores tomados de:

- Supabase dashboard → Project Settings → API.
- Sentry dashboard → Project Settings → Client Keys (DSN) + User Settings → Auth Tokens.
- Anthropic console → Settings → Keys.

```
NEXT_PUBLIC_SUPABASE_URL=<https://blijipnixnikaguojjee.supabase.co>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
NEXT_PUBLIC_SENTRY_DSN=<DSN cliente público>
SENTRY_ORG=lautaro-96
SENTRY_PROJECT=consultora-demo
SENTRY_AUTH_TOKEN=<token con project:releases + project:write>
NEXT_PUBLIC_SITE_URL=https://consultora-demo.test-ia.cloud
ANTHROPIC_API_KEY=<key>
```

### Deploy automático (push a `main`)

**Auto Deploy activo desde el 2026-06-17.** El merge a `main` dispara el rebuild + redeploy del código sin intervención (webhook GitHub → EasyPanel). El "Implementar" manual queda como **fallback** si el auto no arranca.

1. **Source connection (PAT)** — EasyPanel necesita acceso al repo para fetchear el código en cada build. **GitHub → Settings → Developer settings → Personal access tokens**: PAT con scopes mínimos:
   - `repo:status` + `contents:read` para repos privados (caso actual).
   - `public_repo` si fuera público (no aplica).

   **EasyPanel → Service consultora-demo → Source → GitHub**: pegar el PAT (esta es la **Source connection**, no el Auto Deploy). Branch: `main`.
2. **Flow operacional tras cada merge a `main`**:
   - Lautaro mergea PR (post-CI verde).
   - El **Auto Deploy** dispara automáticamente: EasyPanel fetchea HEAD de `main` + `docker build` + redeploy (2-5 min).
   - Lautaro verifica que el deploy aparezca en Implementaciones (Deploy history) con commit SHA correcto.
   - **Fallback manual**: si el auto no arrancó, click **"Implementar"** en EasyPanel UI → Service consultora-demo.
3. **No se agregan secrets en GitHub Actions** para deploy — el código lo publica el webhook de EasyPanel, no un job de `ci.yml`.
4. **Gate de CI verde**: `main` protegida con required checks (ver §ruleset / branch protection) → el auto-deploy publica solo código ya validado.

### T-022.5-FU3 · Revisitar Auto Deploy en upgrade EasyPanel — ✅ CERRADO (2026-06-17)

**Cerrado el 2026-06-17:** el owner activó el **Auto Deploy** en EasyPanel — el push a `main` dispara redeploy automático del código (webhook GitHub → EasyPanel). El click manual "Implementar" queda como fallback. <!-- TODO(owner): completar el mecanismo exacto por el que quedó disponible (upgrade de EasyPanel a una versión que expone Auto Deploy | la opción apareció en la versión actual). -->

> **Nota:** una anotación previa (2026-06-06) dio el FU por resuelto vía webhook, pero ese intento **no quedó operativo** — el deploy siguió siendo manual hasta la activación real del 2026-06-17.

**Contexto histórico (T-022.5, migración original)**: EasyPanel v2.30.0 Self-Hosted no exponía Auto Deploy ni webhook URL en UI. Se probaron 2 approaches automáticos antes de aceptar deploy manual:

1. **GitHub Actions job custom con webhook EasyPanel**: la URL del webhook no era discoverable en v2.30.0 — no se podía cargar el secret.
2. **EasyPanel Auto Deploy nativo**: la UI no exponía la opción para activarlo en self-hosted v2.30.0 (existía en versión cloud).

El costo de ergonomía del click manual era bajo en MVP (~30s extra por deploy) pero compounding con la frecuencia de merges; pasar a auto reduce errores humanos (olvidar el click). La opción quedó disponible y se activó el 2026-06-17.

### Validación post-creación

1. SSL emitido (candado verde en navegador, cert Let's Encrypt).
2. Healthcheck verde (EasyPanel UI muestra status "Running" green).
3. `curl -I https://consultora-demo.test-ia.cloud` → 200 OK.
4. Smoke completo del checklist §8 del [plan T-022.5](https://github.com/LautiRoveda/consultora-demo/pull/<n>).

## Consecuencias

### Positivas

- `max_tokens=8192` desbloquea outputs completos en los 5 tipos de informe — calidad de producto sube notablemente.
- Cero costo recurrente vs Vercel Pro (ahorro USD 240/año).
- Plataforma preparada para escalar a side-cars (workers, crons, OCR pipeline T-040+).
- Control total sobre logs, métricas, debugging.
- Mismo runtime build/runtime que CI → menos divergencia entre entornos.

### Negativas

- Asumimos uptime: si VPS cae, sitio cae. Sin redundancia multi-region.
- Sin preview deploys automáticos en PRs (workaround: branch deploys manuales en EasyPanel UI si hace falta).
- Cotenancy con otros projects (`agendalo`, `aruba`) — riesgo operacional bajo pero no nulo.
- Operación: backups, monitoring de uptime, OS patching son responsabilidad nuestra (mitigado por EasyPanel auto-renewal SSL).

### Inciertas

- **Build time en VPS** (KVM 2): estimado 2-3 min, dependiente de cache pnpm + Docker layer cache. Si supera 5 min sostenido, evaluar migrar build a GitHub Actions + GHCR (follow-up T-022.5-FU1).
- **Estabilidad del proyecto cotenant `agendalo`**: si los otros services consumen RAM/CPU agresivamente, nuestro container puede sufrir. Monitorear primeras semanas.
- **Decisión de decommission Vercel**: tras 4 semanas sin incidentes, eliminamos el proyecto. Si aparece regresión sistémica, evaluamos rollback definitivo o sticking-with-VPS con mitigations adicionales.

## Referencias

- [ADR-0005](0005-vercel-deploy-integration.md) — decisión Vercel original (parcialmente reemplazada).
- [ADR-0003](0003-modelo-claude-default.md) — Claude Sonnet 4.6 default (relevante para `max_tokens`).
- [`docs/technical/06-deployment.md`](../technical/06-deployment.md) — runbook operacional VPS+EasyPanel.
- [Dockerfile](../../Dockerfile) — build pipeline.
- [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) — CI + deploy job.
- [Plan T-022.5](file:///C:/Users/lauta/.claude/plans/briefing-t-022-5-fluttering-cake.md) — plan completo aprobado en PARADA #1.
- Issues que cierra al merge: `#26` (T-020-FU1 max_tokens cap) + `#36` (T-022-FU1 outputs truncados).
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output) — referencia oficial.
