# Technical 06 · Deployment

Runbook permanente de cómo ConsultoraDemo llega a producción. Lo cerró T-010 (Sprint 0 #10/10). Cualquier cambio operacional sobre deploy se refleja acá.

## Stack de deploy

- **Hosting:** Vercel free tier, integración nativa con GitHub.
- **Framework detection:** Next.js 16 (auto-detectado por Vercel).
- **Build command:** `pnpm build` (inferido del `package.json`).
- **Runtime:** Vercel Serverless (Node.js + Edge runtime para `proxy.ts`).
- **Region:** auto (Vercel elige; default `iad1` Washington DC para edge functions).
- **Decisión registrada:** [ADR-0005](../adr/0005-vercel-deploy-integration.md).

## URL productiva

- **Production:** <https://consultora-demo.vercel.app>
- **Preview deploys:** URL única por PR generada por Vercel con prefijo `consultora-demo-git-<branch>-<scope>.vercel.app`.
- **Custom domain:** pendiente. Cuando se compre `consultorademo.com.ar`, agregar en Vercel → Settings → Domains + actualizar `NEXT_PUBLIC_SITE_URL`.

## Flow de deploy

1. **PR abierto contra `main`** → Vercel auto-crea un **preview deploy** con la branch. Status check en el PR.
2. **Merge a `main`** → Vercel auto-deploya a **production**. Sin intervención manual.
3. **Sin intervención manual.** No hay step de `vercel --prod` desde local. El único flow oficial es git push.

## Environment variables

Las 9 variables que la app espera, su scope en Vercel, y dónde se generan.

| Variable | Scope Vercel | Dónde se genera |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production + Preview | Supabase dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production + Preview | Supabase dashboard → Project Settings → API (anon public key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Production + Preview | Supabase dashboard → Project Settings → API (service_role, secret) |
| `NEXT_PUBLIC_SENTRY_DSN` | Production + Preview | Sentry → Project Settings → Client Keys (DSN público) |
| `SENTRY_ORG` | Production + Preview | Slug de la org Sentry (ej: `lautaro-96`) |
| `SENTRY_PROJECT` | Production + Preview | Slug del proyecto Sentry (ej: `consultora-demo`) |
| `SENTRY_AUTH_TOKEN` | Production + Preview | Sentry → User Settings → Auth Tokens (`project:releases` + `project:write`) |
| `NEXT_PUBLIC_SITE_URL` | Production | `https://consultora-demo.vercel.app` (o custom domain cuando exista) |
| `NEXT_PUBLIC_SITE_URL` | Preview | Hardcodeado a la URL de production. Esto hace que `robots.txt` / `sitemap.xml` de preview deploys apunten al sitio prod (no a la URL efímera del preview), evitando ruido SEO. El `<meta name="robots" content="noindex,nofollow">` del root layout (gated por `VERCEL_ENV !== 'production'`) bloquea adicionalmente la indexación de previews. |

**Development scope:** no se usa. El flow local es `.env.local` desde el repo. `vercel dev` no es nuestro pipeline.

### Cómo cambiar una variable

1. Vercel dashboard → Settings → Environment Variables.
2. Localizar la var, click en `...` → Edit.
3. Cambiar valor → Save.
4. **Importante:** las env vars no se aplican retroactivamente a deploys existentes. Hay que **redeployar** para que tome efecto:
   - Vercel dashboard → Deployments → último deploy → `...` → Redeploy.
   - O hacer un commit trivial y push a `main`.

## Source maps a Sentry

`withSentryConfig` en `next.config.ts` (T-007) sube source maps automáticamente cuando detecta `SENTRY_AUTH_TOKEN` en el environment del build.

**Cómo verificar que funciona:**

1. Después de un deploy, ir a `https://lautaro-96.sentry.io/releases/`.
2. Debe aparecer un **release nuevo** con el nombre del git SHA del commit (formato: `<sha-abrev>` o similar).
3. Click en el release → tab **Artifacts** → debe listar `*.js` + `*.js.map`.
4. Sin source maps subidos: el plugin emite warning en Vercel build logs (buscar "skipping upload" / "no auth token detected").

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

# 4. Esperar CI verde + Vercel preview verde + review.
gh pr checks --watch

# 5. Merge squash. Vercel auto-deploya production en ~2 min.
gh pr merge --squash --delete-branch
```

### Redeploy manual sin código nuevo

Útil cuando cambiás env vars y querés que tomen efecto sin commit.

Vercel dashboard → Deployments → último deploy a Production → `...` → **Redeploy**.

### Rollback

Vercel mantiene los últimos 100+ deploys (free tier). Para volver a uno anterior:

1. Vercel dashboard → Deployments.
2. Localizar el deploy que sí funcionaba (filtrar por Production, Status: Ready).
3. `...` → **Promote to Production**.
4. Vercel hace switch atómico — la URL prod apunta al deploy viejo en segundos.
5. **Importante:** rollback NO revierte cambios en la DB (Supabase migrations) ni en secrets. Para rollback completo de schema, ver `supabase/README.md`.

## Cómo regenerar secrets

### Supabase keys (anon + service_role)

1. `https://supabase.com/dashboard/project/blijipnixnikaguojjee/settings/api`.
2. Click "Reset" en la key que querés regenerar.
3. Copiar la nueva key.
4. Vercel dashboard → Settings → Environment Variables → editar `NEXT_PUBLIC_SUPABASE_ANON_KEY` o `SUPABASE_SERVICE_ROLE_KEY`.
5. **Redeploy** (las env vars no se aplican a deploys existentes).
6. Actualizar `.env.local` propio.

### `SENTRY_AUTH_TOKEN`

1. `https://sentry.io/settings/account/api/auth-tokens/`.
2. Revoke token viejo.
3. Create New Token con scopes `project:releases` + `project:write`.
4. Update Vercel Secret (Production + Preview).
5. Update GitHub Secret (`Settings → Secrets → Actions`).
6. Update `.env.local`.

### Cuando regenerar (triggers obligatorios)

- Sospecha de leak (commit accidental, log público, screenshot).
- Cambio de hands del proyecto (vos dejás de ser el único maintainer).
- Política de rotación (recomendado cada 12 meses).

## Custom domain (futuro)

Cuando se compre `consultorademo.com.ar`:

1. Vercel dashboard → Settings → Domains → Add → `consultorademo.com.ar`.
2. Configurar DNS según las instrucciones que Vercel da (A record + CNAME).
3. Verificar SSL (Vercel emite Let's Encrypt automáticamente).
4. **Actualizar `NEXT_PUBLIC_SITE_URL`** a `https://consultorademo.com.ar` en Vercel env vars (Production scope).
5. Redeploy. `robots.txt` y `sitemap.xml` toman la URL nueva automáticamente (ver `src/app/robots.ts` y `src/app/sitemap.ts`).
6. Mantener `*.vercel.app` como fallback o redirigir a custom domain (Vercel pregunta).

## Limites del free tier Vercel

| Recurso | Límite free | Trigger upgrade |
|---|---|---|
| Bandwidth | 100 GB / mes | > 75% sostenido |
| Build minutes | 6000 / mes | > 80% sostenido |
| Deploys | 100 / día | irrelevante en flow normal |
| Edge function executions | 1M / mes | > 50% (proxy.ts ejecuta en cada request matcheado) |
| Image optimization | 1000 imágenes únicas | hoy no usamos `next/image`, irrelevante |
| Team members | 1 | cuando entre 2do contributor |

Si algún recurso pasa del 80%, evaluar upgrade a Pro (USD 20/mes — incluye 1 TB bandwidth y team).

## Deployment Protection (preview deploys)

Hoy: preview deploys son **públicos** (sin gating). Anyone con la URL puede acceder.

Para Sprint 0 OK (no hay data sensible — solo landing + login UI sin auth real). Cuando T-012 monte signup, considerar activar Vercel **Deployment Protection** en preview scope:

- Vercel dashboard → Settings → Deployment Protection.
- Opciones: password protection, Vercel Authentication, custom logic.
- Mi recomendación cuando llegue: **Vercel Authentication** (basta con tu cuenta para entrar).

## Troubleshooting

### Build falla en Vercel pero pasa local

- **Causa común:** env vars faltantes en Vercel.
- **Verificación:** Vercel dashboard → Deployments → click en deploy fallado → tab "Build Logs" → buscar `Invalid environment variables` (es el error que tira `src/env.ts` cuando Zod rechaza).

### Source maps no aparecen en Sentry

- Verificar `SENTRY_AUTH_TOKEN` está en Vercel env vars (Production + Preview).
- Verificar scopes del token (`project:releases` + `project:write`).
- Build logs de Vercel deben mostrar mensaje "Successfully uploaded".

### Preview deploy del PR falla con `Vercel preview fail`

- **Causa común post-T-009:** vars no estaban en scope Preview (solo Production).
- **Fix:** Vercel → Settings → Environment Variables → editar cada var → marcar **Preview** además de Production.

### Rollback urgente

- Vercel dashboard → Deployments → buscar último deploy verde → `...` → Promote to Production.
- Si el rollback toca un cambio de migration: ver `supabase/README.md` sección "Migrations" para revertir schema si hace falta.

## Referencias

- [ADR-0005](../adr/0005-vercel-deploy-integration.md) — decisión Vercel-GitHub native vs alternativas.
- [`docs/adr/0002-stack-eleccion.md`](../adr/0002-stack-eleccion.md) — ADR padre que fijó Vercel como host.
- [supabase/README.md](../../supabase/README.md) — proyecto remoto y secrets.
- [src/shared/observability/README.md](../../src/shared/observability/README.md) — Sentry config + `SENTRY_AUTH_TOKEN`.
