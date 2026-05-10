# ADR-0005 · Vercel-GitHub integration nativa para auto-deploy

**Fecha:** 2026-05-10
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** documentación oficial Vercel + experiencia previa con Vercel preview deployments durante PRs de Sprint 0

## Contexto

T-010 cierra Sprint 0 dejando la app en producción end-to-end. ADR-0002 (stack inicial) ya fijó Vercel como host. Falta decidir **cómo se dispara el deploy**:

- Sprint 0 (T-001 a T-009) tuvo Vercel observando el repo y generando preview deploys por PR (configuración mínima). El preview de PR #6 falló por env vars faltantes, lo cual reveló que el setup completo todavía estaba pendiente.
- T-010 carga las 9 env vars reales como Vercel Secrets, activa `SENTRY_AUTH_TOKEN` para upload de source maps automático, y deja el flow operacional cerrado.
- La pregunta abierta era: **¿Vercel-GitHub integration nativa, o pipeline custom con GitHub Actions invocando `vercel deploy`?**

Mientras CI propio en GitHub Actions ya está corriendo (T-004) y maneja el gate de calidad (format + lint + typecheck + tests + build + e2e + grep secrets), conviene mantener **separados los roles**: CI verifica que el código está sano, Vercel hace deploy. Pero la mecánica del trigger puede ser ambas: integration nativa o Action que invoca CLI.

## Opciones evaluadas

### Opción A · Vercel-GitHub integration nativa (elegida)

- Vercel observa el repo. PRs → preview deploy automático. Merge a `main` → production deploy automático.
- **Pros:**
  - Zero config adicional. La integration ya estaba activa desde antes de T-010.
  - Preview deployments por PR sin tocar workflows.
  - Comments automáticos en el PR con la URL del preview.
  - Status checks integrados con GitHub (`Vercel`, `Vercel Preview Comments`).
  - Build duration: 1-3 minutos para esta app.
  - Rollback nativo (Promote previous deployment).
- **Contras:**
  - Vendor lock-in moderado a Vercel-GitHub. Si Vercel cambia su API, podríamos quedar con un setup roto.
  - El deploy se dispara incluso si CI propio está rojo (Vercel no espera el green de Actions). Mitigación: CI propio bloquea el merge (vía revisión humana o branch protection cuando se reactive — ADR-0004).
  - Build fees post-tráfico real (incluido en free tier mientras estemos bajo límites; ver runbook).

### Opción B · GitHub Actions custom con `vercel deploy`

- Actions invoca `vercel pull` + `vercel build` + `vercel deploy --prod` en cada push a main.
- **Pros:**
  - Control total del pipeline. Podemos gatear el deploy a que CI propio esté verde primero.
  - Posibilidad de hacer cosas custom pre/post deploy (ej: warm-up cache, slack notify).
  - Portable: si en Fase 5+ migramos a otro host (Fly, Railway), el workflow cambia mínimamente.
- **Contras:**
  - Setup extra: token Vercel, workflow YAML, manejo de secrets.
  - Duplicar trabajo: Vercel ya hace build, Actions lo replica. O exportar artifact del Action → upload a Vercel (más complejidad).
  - Preview deployments por PR requieren un workflow adicional con `pull_request` trigger.
  - 2x el costo (Actions minutes + Vercel build minutes), aunque ambos free.

### Opción C · Self-hosted (Fly.io, Railway, AWS)

- Migrar fuera de Vercel.
- **Pros:** sin lock-in, control de region, posibilidad de Docker, runner dedicado.
- **Contras:** mucho más DevOps, sin preview deployments nativos, sin edge functions out-of-the-box. Para Sprint 0 con 1 desarrollador es overkill. Para Sprint 0 fase MVP con free tier holgado, irrelevante.
- **Decisión:** descartada. Posible reconsideración en Fase 5+ si Vercel se vuelve caro o si llega un cliente Enterprise que pida self-hosting.

## Decisión

**Opción A — Vercel-GitHub integration nativa.**

Pipeline final:

1. **CI propio (GitHub Actions, `ci.yml`)** corre en cada PR y push a `main`. Verifica format + lint + typecheck + tests + build + e2e + grep service_role.
2. **Vercel** observa el repo independientemente. PR → preview deploy. Merge a `main` → production deploy.
3. Los dos pipelines son **independientes**: Vercel no espera el green de CI. La disciplina humana / branch protection cuando se reactive (ADR-0004) garantiza que solo merges con CI verde lleguen a `main`.

## Consecuencias

### Positivas

- Zero config adicional en T-010. El plumbing de auto-deploy ya estaba activo; T-010 solo cargó secrets.
- Preview deployments automáticos por PR — review visual sin levantar local.
- DX excelente: status check en el PR, URL del preview en comment, rollback con un click.
- Build fees, source map upload, edge function execution todo incluido en free tier durante Sprint 0.

### Negativas

- **Vendor lock-in moderado.** Si Vercel se vuelve caro post-tráfico, migrar requiere reescribir el plumbing de deploy. Mitigación: el código de la app es estándar Next.js — se ejecuta en cualquier Node runtime.
- **Sin gate CI → Deploy**. Vercel deploya aunque CI esté rojo. Mitigación: branch protection server-side cuando se reactive (ADR-0004) o disciplina manual hasta entonces.
- **Vercel build duration** podría volverse límite con app más grande (source map upload + e2e + Sentry release creation). Mitigación: revisar en T-XXX futuro si los builds pasan de 5 min.

### Inciertas

- **Costos a tracción real.** Free tier cubre fácil los primeros 100 cuentas pagas (USD 3000 MRR), pero si tracción explota, evaluar Pro (USD 20/mes) en cuanto bandwidth o build minutes superen 80% sostenido.
- **Edge function executions** del `proxy.ts`: cada request matcheado consume 1 ejecución. Si la landing tiene 10K visitas/día, son ~250K ejecuciones/mes solo en `/`. Free tier da 1M/mes. Margen OK al inicio. Monitorear.
- **Compatibilidad con Turbopack** del Vercel build: ha sido estable durante Sprint 0. Si Next.js 17 cambia algo crítico, reevaluar.

## Triggers para revisitar

Reabrir como **ADR-0005-bis** o un ADR-NNNN nuevo cuando:

- Costo Vercel + Sentry + Supabase pase de USD 50/mes sostenido (señal de tracción → evaluar self-host vs Pro tier).
- Latencia desde Argentina insatisfactoria (Vercel edge default está en US — si los usuarios reportan > 500 ms p95, evaluar Vercel Pro multi-region o migrar a un provider con presencia en Brasil).
- Vercel free tier limita > 80% sostenido (bandwidth, build, edge executions).
- Llegue contributor #2 → activar branch protection server-side (ADR-0004 trigger) y revisar si el deploy también necesita gating de CI.
- Apertura del repo (open source) → branch protection clásica gratis + revisar si el deploy expone algún secret de build.

## Referencias

- [ADR-0002](./0002-stack-eleccion.md) — ADR padre del stack que fija Vercel como host.
- [ADR-0004](./0004-diferir-branch-protection-server-side.md) — branch protection diferida; relevante para el "sin gate CI → Deploy".
- [docs/technical/06-deployment.md](../technical/06-deployment.md) — runbook operacional completo.
- Vercel docs · GitHub integration: <https://vercel.com/docs/git>
- Vercel docs · Environment Variables: <https://vercel.com/docs/projects/environment-variables>
