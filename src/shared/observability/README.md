# Observability

Sentry (errors + tracing) + pino (logger structured) en un módulo unificado.

Referencias:

- [docs/technical/01-principles.md](../../../docs/technical/01-principles.md) · P6 — observabilidad como ciudadano de primera clase.
- [docs/technical/00-skills-y-stack.md](../../../docs/technical/00-skills-y-stack.md) · sección "Observabilidad".
- T-007 (`docs/technical/10-roadmap.md` líneas 37-38) — ticket que dejó esto operativo.

## Estructura

```
src/shared/observability/
├── sentry-config-base.ts   ← constantes compartidas (sample rates, enabled)
├── logger.ts               ← wrapper pino + captura automática a Sentry (SERVER-ONLY)
└── README.md               ← este archivo
```

Las 3 configs de Sentry viven en la **raíz del repo** (no acá) porque Next.js las descubre por convención:

```
sentry.client.config.ts     ← bundle del browser
sentry.server.config.ts     ← Node runtime (Server Components, Actions, Routes)
sentry.edge.config.ts       ← Edge runtime (proxy.ts y futuros edge routes)
instrumentation.ts          ← orquestador: register() + onRequestError export
```

Las 3 configs importan `sentry-config-base.ts` para `enabled`, `tracesSampleRate` y `environment`.

## Cuándo usar cada herramienta

| Caso | Herramienta | Archivo |
|---|---|---|
| Error/log desde Server Component / Server Action / Route Handler | `logger.error(...)` | `@/shared/observability/logger` |
| Error desde Client Component | El SDK browser lo captura solo (`window.onerror`, React error boundaries con `Sentry.ErrorBoundary`, o `Sentry.captureException` manual) | `@sentry/nextjs` |
| Error desde `src/proxy.ts` (Edge runtime) | `Sentry.captureException(err)` directo | `@sentry/nextjs` |
| Custom message / breadcrumb manual | `Sentry.captureMessage` / `Sentry.addBreadcrumb` | `@sentry/nextjs` |

`logger` SÍ captura a Sentry automáticamente en `error()` y `fatal()`. Los demás métodos (`trace`, `debug`, `info`, `warn`) solo loggean localmente — si querés que un warning llegue a Sentry, hacé `Sentry.captureMessage('msg', 'warning')` manualmente.

## Por qué el logger es server-only

`pino` requiere APIs de Node.js (`stream`, `fs`, worker threads) que **no existen en Edge runtime** ni en el browser. `import 'server-only'` al tope de `logger.ts` hace que el build falle si un Client Component o el proxy lo importan por error.

En Edge usar `Sentry.captureException` directo es OK: el SDK Edge no requiere pino y ya está bootstrapeado vía `instrumentation.ts → sentry.edge.config.ts`.

## Cómo desactivar el envío a Sentry (default en dev/test)

`sentry-config-base.ts` calcula:

```ts
export const SENTRY_ENABLED =
  process.env.NODE_ENV === 'production' ||
  process.env.SENTRY_FORCE_ENABLE === 'true';
```

En dev/test sin `SENTRY_FORCE_ENABLE=true`, `Sentry.init({ enabled: false })` hace que `captureException`/`captureMessage` se vuelvan no-op. **No se manda nada al servidor de Sentry**, no se ensucia el dashboard.

Para validación end-to-end manual (ej: confirmar que `/api/test-error` llega), setear temporalmente en `.env.local`:

```bash
SENTRY_FORCE_ENABLE=true
```

Después borrar la línea (o setearla a `false`/vacía) para que dev quede limpio.

## Sample rates

| Entorno | `tracesSampleRate` | Replay | Profiling |
|---|---|---|---|
| dev | 0.10 (10%) | 0 | 0 |
| prod | 0.05 (5%) | 0 | 0 |

Replay y Profiling deshabilitados explícitamente — costosos y sin ROI claro en MVP. Se activan cuando haya tracción.

## Tunnel `/monitoring`

`withSentryConfig` en [`next.config.ts`](../../../next.config.ts) configura `tunnelRoute: '/monitoring'`. Los reportes del SDK browser se mandan a `/monitoring` (mismo dominio que la app) y Next.js los reenvía a Sentry. Bypass de adblockers que bloquean el endpoint público de Sentry.

`src/proxy.ts` excluye `/monitoring` del matcher para no agregar latencia ni interferir con el túnel.

## Validación end-to-end

Endpoint `GET /api/test-error` (gated por `NODE_ENV !== 'production'`):

1. `pnpm dev` con `SENTRY_FORCE_ENABLE=true` en `.env.local`.
2. `curl http://localhost:3000/api/test-error` → 500 (esperado).
3. Ver el error en `sentry.io/organizations/<SENTRY_ORG>/issues/` en ~30 segundos.
4. Borrar `SENTRY_FORCE_ENABLE=true` de `.env.local`.

## Producción (T-010)

Las 4 vars Sentry están configuradas como Vercel Environment Variables:

| Var | Scope Vercel |
|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | Production + Preview |
| `SENTRY_ORG` | Production + Preview |
| `SENTRY_PROJECT` | Production + Preview |
| `SENTRY_AUTH_TOKEN` | Production + Preview |

**`SENTRY_AUTH_TOKEN`** (T-010) tiene scope mínimo `project:releases` + `project:write`. Lo consume `withSentryConfig` en [`next.config.ts`](../../../next.config.ts) para subir source maps automáticamente en cada build de Vercel. NO se carga al `src/env.ts` schema porque es var de **build-time** (no se importa desde código de runtime).

Verificación post-deploy: `sentry.io → Releases → <release-sha>` debe tener tab "Artifacts" con `*.js` + `*.js.map` subidos. Si no, el token está mal o no se inyectó. Ver [docs/technical/06-deployment.md](../../../docs/technical/06-deployment.md) sección "Source maps a Sentry".

## Tracking de costo

Plan free de Sentry: 5 K errores/mes. Con `tracesSampleRate: 0.05` y replay/profiling en 0, deberíamos quedar muy por debajo del cap durante MVP. Monitorear el quota indicator del dashboard una vez por mes.

Cuando se agote el budget, evaluar:

- Subir a Team plan (USD 26/mes).
- O reducir aún más `tracesSampleRate`.
- O agregar `beforeSend` que filtre noise (ej: errores de extensiones de browser que vienen del cliente).
