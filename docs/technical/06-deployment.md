# Technical 06 · Deployment

Runbook permanente de cómo ConsultoraDemo llega a producción.

- **Sprint 0 (T-010)** lo cerró sobre Vercel.
- **T-022.5** migró el deploy a **VPS Hostinger + EasyPanel** para destrabar el cap `max_tokens=4096` impuesto por el timeout 10s de Vercel Hobby (ver [ADR-0007](../adr/0007-vps-hostinger-easypanel.md)). Vercel queda como hot backup durante 4 semanas post-cutover.

Cualquier cambio operacional sobre deploy se refleja acá.

## Stack de deploy (T-022.5+)

- **Hosting:** VPS Hostinger Ubuntu 24.04 KVM 2 (`31.97.165.160`), 8 GB RAM, 2 CPU, 96 GB disco.
- **Orquestador:** EasyPanel v2.30+ (Docker + Traefik + Let's Encrypt).
- **EasyPanel placement:** project `agendalo` (cotenant con otros services productivos — **no tocar nada ajeno al service `consultora-demo`**, ver `feedback_vps_cotenant_safety.md` en memory).
- **Container image:** built from `Dockerfile` en root del repo, multi-stage Node 22 alpine + `output: 'standalone'` (next.config.ts).
- **Reverse proxy:** Traefik (embedded en EasyPanel) → Let's Encrypt automático.
- **Region:** sa-east (Argentina).
- **Decisión registrada:** [ADR-0007](../adr/0007-vps-hostinger-easypanel.md).

## URL productiva

- **Production:** `https://consultora-demo.test-ia.cloud`.
- **Hot backup (4 semanas post-cutover):** `https://consultora-demo.vercel.app` — auto-deploy pausado, recuperable con `vercel deploy --prod` manual.

## Flow de deploy

1. **PR abierto contra `main`** → GitHub Actions corre CI (213+ tests). **No hay preview deploy automático en VPS** — los preview deploys de Vercel quedaron descartados para T-022.5; si se necesita un preview, EasyPanel permite levantar un service apuntando temporalmente a la branch desde la UI (manual).
2. **Merge a `main`** → Lautaro entra a **EasyPanel UI → Service consultora-demo → botón "Implementar"** → EasyPanel hace `docker build` + redeploy. Build toma 2-5 min.
3. **Rationale del deploy manual**: EasyPanel v2.30.0 Self-Hosted **no expone Auto Deploy** ni webhook URL custom en la UI. Para MVP aceptamos el click manual; tracking en T-022.5-FU3 (revisitar Auto Deploy en upgrade EasyPanel). Ver `docs/adr/0007-vps-hostinger-easypanel.md`.
4. **Gate de CI verde**: implícito por convención operacional (no clickear "Implementar" sin CI verde) + opcionalmente reforzable con branch protection rule (Settings → Branches → main → "Require status checks to pass before merging" → check `CI` workflow).
5. **Intervención manual mínima**: además del click "Implementar", el otro trigger no-automatizado son cambios de env vars o de config de Service (UI EasyPanel).

## Environment variables (T-022.5+)

Las 9 variables se cargan en **EasyPanel → Project agendalo → Service consultora-demo → Environment**. EasyPanel las pasa al `docker build` (como `--build-arg`) y al container en runtime.

| Variable | Build-time | Runtime | Dónde se genera |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | Supabase dashboard → Project Settings → API (anon public key) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | Supabase dashboard → Project Settings → API (service_role, secret) |
| `NEXT_PUBLIC_SENTRY_DSN` | ✅ | ✅ | Sentry → Project Settings → Client Keys (DSN público) |
| `SENTRY_ORG` | ✅ | — | Slug de la org Sentry (ej: `lautaro-96`) |
| `SENTRY_PROJECT` | ✅ | — | Slug del proyecto Sentry (ej: `consultora-demo`) |
| `SENTRY_AUTH_TOKEN` | ✅ | — | Sentry → User Settings → Auth Tokens (scopes `project:releases` + `project:write`). Sin token, source maps no se suben pero app funciona. |
| `NEXT_PUBLIC_SITE_URL` | ✅ | ✅ | `https://consultora-demo.test-ia.cloud` |
| `ANTHROPIC_API_KEY` | ✅ | ✅ | console.anthropic.com → Settings → Keys |

**`SENTRY_RELEASE`** se inyecta como build arg en el `docker build` que dispara EasyPanel al click "Implementar". Default ideal: SHA del commit. EasyPanel v2.30.0 puede no pasarlo automáticamente — en ese caso, configurar el build arg explícito en Service → Build args (o aceptar que el release Sentry se nombre con el timestamp del build en lugar del SHA, lo cual sigue siendo útil pero menos preciso).

### Cómo cambiar una variable

1. EasyPanel → Project agendalo → Service consultora-demo → Environment.
2. Editar la variable → Save.
3. **Importante:** EasyPanel necesita un nuevo build para que la var se aplique (las que afectan build-time) o restart del container (las que solo afectan runtime). Forzar redeploy con el botón "Deploy" en la UI.

## Source maps a Sentry

`withSentryConfig` en `next.config.ts` sube source maps automáticamente cuando detecta `SENTRY_AUTH_TOKEN` en el environment del build.

**Cómo verificar que funciona:**

1. Después de un deploy, ir a `https://lautaro-96.sentry.io/releases/`.
2. Debe aparecer un **release nuevo** con el nombre del git SHA del commit (formato: `<sha-abrev>` o similar).
3. Click en el release → tab **Artifacts** → debe listar `*.js` + `*.js.map`.
4. Sin source maps subidos: build logs de EasyPanel muestran warning "skipping upload" / "no auth token detected". Verificar que `SENTRY_AUTH_TOKEN` esté en EasyPanel env y que el build lo recibió como `--build-arg`.

## Cómo deployar

### Production deploy (flow normal)

```bash
# 1. Trabajo en feature branch.
git checkout -b chore/T-XYZ-descripcion

# 2. Commits + push.
git commit -m "T-XYZ · ..."
git push -u origin chore/T-XYZ-descripcion

# 3. PR contra main.
gh pr create --base main --title "T-XYZ · ..."

# 4. Esperar CI verde + review.
gh pr checks --watch

# 5. Merge squash. CI vuelve a correr en main. **Click manual** en EasyPanel UI → Service → "Implementar" para deployar (no es automático en v2.30.0).
gh pr merge --squash --delete-branch

# 6. (Opcional) ver build en vivo en EasyPanel UI → Service → Deployments.
```

### Redeploy manual sin código nuevo

Útil cuando cambiás env vars y querés que tomen efecto sin commit.

EasyPanel → Project agendalo → Service consultora-demo → Deployments → botón **"Deploy"**.

### Rollback

EasyPanel mantiene historial de deploys. Para volver a uno anterior:

1. EasyPanel → Service consultora-demo → Deployments.
2. Localizar el deploy que sí funcionaba (status verde).
3. Botón **Redeploy** sobre ese deploy.
4. EasyPanel hace pull de la image cacheada + start container (~30s).
5. **Importante:** rollback NO revierte cambios en la DB (Supabase migrations) ni en secrets. Para rollback completo de schema, ver `supabase/README.md`.

### Rollback N2 — vuelta a Vercel (problema sistémico en VPS, primeras 4 semanas post-cutover)

1. Vercel dashboard → Settings → Git → Reanudar Production Branch deployment.
2. `vercel deploy --prod` desde local — fuerza un deploy con el último commit de main.
3. Anunciar internamente que la URL prod vuelve temporalmente a `https://consultora-demo.vercel.app`.
4. Supabase Auth → URL Configuration → ya debería tener vercel.app/** en la allowlist durante esta ventana.
5. Tiempo total: ~5 min.

## Cómo regenerar secrets

### Supabase keys (anon + service_role)

1. `https://supabase.com/dashboard/project/blijipnixnikaguojjee/settings/api`.
2. Click "Reset" en la key que querés regenerar.
3. Copiar la nueva key.
4. EasyPanel → Service consultora-demo → Environment → editar `NEXT_PUBLIC_SUPABASE_ANON_KEY` o `SUPABASE_SERVICE_ROLE_KEY` → Save.
5. EasyPanel → Service → botón **Deploy** (rebuild + restart con la nueva var).
6. GitHub repo → Settings → Secrets → Actions → actualizar el mismo secret (lo usa CI).
7. Actualizar `.env.local` propio.

### `SENTRY_AUTH_TOKEN`

1. `https://sentry.io/settings/account/api/auth-tokens/`.
2. Revoke token viejo.
3. Create New Token con scopes `project:releases` + `project:write`.
4. Update en EasyPanel env vars del Service.
5. Update en GitHub Secrets (workflows futuros).
6. Update `.env.local`.

### EasyPanel GitHub connection (Source)

EasyPanel necesita acceso al repo para fetchear el código en cada click "Implementar". La conexión es **Source** del Service (vía Personal Access Token o GitHub App connection, según versión de EasyPanel). NO confundir con Auto Deploy — eso no está expuesto en v2.30.0.

1. GitHub → Settings → Developer settings → Personal access tokens → generar token nuevo con scope mínimo (`repo:status` + `contents:read` para repos privados; `public_repo` si fuera público).
2. Revocar token viejo en GitHub.
3. EasyPanel → Service consultora-demo → Source → re-cargar el PAT nuevo en la integración GitHub.
4. Validación: triggerear "Implementar" desde EasyPanel UI → el fetch del repo debe pasar OK.

### Cuando regenerar (triggers obligatorios)

- Sospecha de leak (commit accidental, log público, screenshot).
- Cambio de hands del proyecto (vos dejás de ser el único maintainer).
- Política de rotación (recomendado cada 12 meses).

## Service en EasyPanel — config literal

Ver [ADR-0007](../adr/0007-vps-hostinger-easypanel.md) sección "Service config" para los valores campo-por-campo.

## Healthcheck

- **Definido en EasyPanel** (no en Dockerfile — evita duplicación con Traefik upstream).
- HTTP GET `https://consultora-demo.test-ia.cloud/` cada 30s, fail después de 3 misses → restart container.
- Endpoint `/` es la landing pública (sin DB, sin auth, ~50ms response).

## Logs

- **EasyPanel UI → Service consultora-demo → Logs**: stdout/stderr del container.
- Formato: JSON estructurado de `pino` (level, time, msg, ...metadata).
- **Retención**: configurable en EasyPanel (default 7 días).
- Para logs históricos más allá de la retención EasyPanel: Sentry captura errores/fatales (T-007 ya está conectado).

## SSL

- **Provider**: Let's Encrypt vía Traefik (manejado por EasyPanel).
- **Renovación**: automática 30 días antes de expiry.
- **Si falla la emisión**:
  - Verificar DNS A record propagado (`dig +short consultora-demo.test-ia.cloud @8.8.8.8`).
  - Verificar puerto 80 abierto al mundo (`nc -zv 31.97.165.160 80`).
  - Verificar logs Traefik: `docker logs traefik 2>&1 | tail -50` (SSH al VPS).
  - **Rate limit Let's Encrypt** (5 fail/hr/hostname, 50 certs/week): esperar 1 hora antes de retry.

## Disk / cleanup

EasyPanel acumula images viejas con cada build. Mitigación:

- EasyPanel UI suele tener un setting "Auto-prune old builds" — activar.
- Manual: SSH al VPS y correr `docker system prune -af --volumes` (cuidado: confirmar que NO borra images activas de otros services del project agendalo/aruba). Schedule cron weekly opcional.

## Troubleshooting

### Build falla en EasyPanel

- **Causa común 1:** env var faltante. Build logs muestran error de `src/env.ts` ("Invalid environment variables"). Verificar las 9 vars cargadas en Environment del Service.
- **Causa común 2:** OOM durante `pnpm build`. VPS tiene 8 GB pero Next + Turbopack puede picar a 2 GB. Si OOM: agregar swap al host (`fallocate -l 2 G /swapfile`) o capear concurrency en el build.
- **Causa común 3:** lockfile drift. El Dockerfile usa `pnpm install --frozen-lockfile` — un commit con dependency change sin actualizar el lockfile lo rompe. Fix: `pnpm install` local + commit del lockfile.

### Build OK pero container no arranca

- EasyPanel → Service → Logs: leer el último error.
- Causa común: env var faltante en runtime (vs build). Las que están solo en runtime: `NEXT_PUBLIC_SITE_URL` (build inlinea pero runtime también la usa), `ANTHROPIC_API_KEY` (env.ts valida al load).
- Si la app loggea "Invalid environment variables" al startup: hay drift entre las vars build y runtime. Solucionar = re-deploy con las vars correctas.

### Source maps no aparecen en Sentry

- Verificar `SENTRY_AUTH_TOKEN` está en EasyPanel env del Service.
- Verificar scopes del token (`project:releases` + `project:write`).
- Build logs de EasyPanel deben mostrar mensaje "Successfully uploaded" de Sentry plugin.
- Verificar que `SENTRY_RELEASE` build arg llegó al builder stage (es el SHA del commit; sin él, el release no se crea en Sentry).

### Click "Implementar" no buildeó tras merge

- Recordá que en T-022.5 (EasyPanel v2.30.0) **el deploy es manual** — no se dispara solo después del merge. Si esperabas que ocurriera automáticamente: clickeá "Implementar" en EasyPanel UI → Service consultora-demo.
- Si clickeaste "Implementar" pero el build no arranca o falla:
  - EasyPanel → Service → Implementaciones (Deploy history) → ver el último intento + logs.
  - Verificar que la Source connection (PAT GitHub) no expiró — sección "EasyPanel GitHub connection (Source)" arriba.
  - Si el fetch del repo falla con 401/403: regenerar PAT y re-cargar en Source.
  - Si el build falla en `pnpm install` u otro step del Dockerfile: leer logs del build en EasyPanel UI.

### Rollback urgente

- EasyPanel → Service → Deployments → buscar último deploy verde → Redeploy.
- Si el rollback toca un cambio de migration: ver `supabase/README.md` sección "Migrations".
- Si el VPS entero está caído: rollback N2 a Vercel (sección "Rollback" arriba).

## Decommission Vercel (cronograma)

Plan de cierre del hot backup Vercel:

- **PARADA #3 (cutover)**: pausar auto-deploy Vercel. Dashboard → Settings → Git → **Pause Production Branch deployment**. NO Disconnect (queda listo para rollback N2).
- **+1 semana**: monitorear Sentry alerts + smoke check rápido. Si todo OK, mantener Vercel pausado.
- **+4 semanas (T-022.5 follow-up)**: si 0 incidentes, eliminar el proyecto Vercel. Borrar env vars en `.env.example` que digan "Vercel". Memo en CLAUDE.md.

## Referencias

- [ADR-0007](../adr/0007-vps-hostinger-easypanel.md) — decisión VPS Hostinger + EasyPanel + Docker.
- [ADR-0005](../adr/0005-vercel-deploy-integration.md) — decisión original Vercel-GitHub native (superseded en parte por ADR-0007).
- [`docs/adr/0002-stack-eleccion.md`](../adr/0002-stack-eleccion.md) — ADR padre stack.
- [supabase/README.md](../../supabase/README.md) — proyecto remoto y secrets.
- [src/shared/observability/README.md](../../src/shared/observability/README.md) — Sentry config + `SENTRY_AUTH_TOKEN`.
- [Dockerfile](../../Dockerfile) — build pipeline.
- [.github/workflows/ci.yml](../../.github/workflows/ci.yml) — workflow CI (sin deploy job; deploy se dispara con click manual en EasyPanel UI).
