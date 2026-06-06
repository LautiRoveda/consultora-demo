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
- **Deploy trigger**: **click manual "Implementar"** desde EasyPanel UI tras cada merge a `main`. EasyPanel v2.30.0 Self-Hosted **no expone Auto Deploy** ni webhook URL custom en la UI (ambos approaches fueron probados en este PR — pasamos por: 1) job custom en GH Actions con webhook EasyPanel; 2) Auto Deploy nativo; 3) deploy manual click). Sin job custom en `.github/workflows/ci.yml`. Gate de CI verde se mantiene por convención operacional (Lautaro solo clickea "Implementar" tras CI verde) + opcionalmente branch protection rule. Tracking de revisita en upgrade EasyPanel: **T-022.5-FU3**.
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
| Auto deploy on push | **OFF / no soportado** en EasyPanel v2.30.0 Self-Hosted. Deploy se dispara con click manual "Implementar" tras cada merge a `main`. Tracking T-022.5-FU3 (revisitar en upgrade). |

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

### Deploy manual (click "Implementar")

EasyPanel v2.30.0 Self-Hosted no expone Auto Deploy ni webhook URL custom en la UI. El deploy productivo se dispara manualmente:

1. **GitHub → Settings → Developer settings → Personal access tokens**: generar PAT con scopes mínimos para que EasyPanel pueda fetchear el repo en cada build:
   - `repo:status` + `contents:read` para repos privados (caso actual).
   - `public_repo` si fuera público (no aplica).
2. **EasyPanel → Service consultora-demo → Source → GitHub**: pegar el PAT (esta es la **Source connection**, no Auto Deploy). Branch: `main`.
3. **Flow operacional tras cada merge a `main`**:
   - Lautaro mergea PR (post-CI verde).
   - Entra a **EasyPanel UI → Service consultora-demo → botón "Implementar"**.
   - EasyPanel fetchea HEAD de `main` + `docker build` + redeploy (2-5 min).
   - Lautaro verifica que el deploy aparezca en Implementaciones (Deploy history) con commit SHA correcto.
4. **No se agregan secrets en GitHub Actions** para deploy — el workflow `ci.yml` no tiene job de deploy.
5. **Gate de CI verde** se mantiene por convención operacional (no clickear "Implementar" sin CI verde). Opcionalmente reforzar con branch protection rule: Settings → Branches → main → "Require status checks to pass before merging" → check `CI` workflow.

### T-022.5-FU3 · Revisitar Auto Deploy en upgrade EasyPanel

**Status**: ✅ RESUELTO. **Resuelto (anotado 2026-06-06):** el Auto Deploy quedó habilitado vía webhook GitHub → EasyPanel; el push a `main` dispara redeploy automático del código. Ver `docs/technical/06-deployment.md` §"Flow de deploy" + la lección "EasyPanel Auto Deploy via GitHub webhook" en `docs/lessons-learned.md`. El contexto histórico de abajo (por qué se aceptó deploy manual en su momento, y los 2 approaches automáticos que fallaron en v2.30.0) queda como registro — la decisión original NO se reescribe.

**Contexto**: EasyPanel v2.30.0 Self-Hosted no expone Auto Deploy ni webhook URL en UI. Probamos en este PR 2 approaches automáticos antes de aceptar deploy manual:

1. **GitHub Actions job custom con webhook EasyPanel**: la URL del webhook no es discoverable en v2.30.0 — no podemos cargar el secret.
2. **EasyPanel Auto Deploy nativo**: la UI no expone la opción para activarlo en self-hosted v2.30.0 (existe en versión cloud).

**Trigger del FU**: cuando upgradeés a una versión de EasyPanel que sí exponga Auto Deploy o webhook URL, revisitá esta decisión. El costo de ergonomía del click manual es bajo en MVP (~30s extra por deploy) pero compounding con frecuencia de merges. Pasar a auto reduce errores humanos (olvidar el click).

**Acción al cerrar T-022.5-FU3**:
- Activar Auto Deploy en EasyPanel UI (o configurar webhook custom + restaurar job `deploy` en ci.yml — preferir Auto Deploy nativo).
- Actualizar `docs/technical/06-deployment.md` flow.
- Actualizar este ADR (sección "Sub-decisiones derivadas" + tabla Service config).
- Sacar este bloque T-022.5-FU3.

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
