# ConsultoraDemo

Plataforma SaaS para consultores de Higiene y Seguridad Laboral en Argentina, **potenciada por IA**, con foco en dos pilares: **generación de informes técnicos** y **calendario de vencimientos con alertas proactivas**. No es una suite EHS genérica — son dos cosas hechas mejor que la competencia.

## Si sos Claude Code o un agente IA

Leé esto en orden y vas a tener todo el contexto que necesitás:

1. **`docs/discovery/`** — el porqué del producto (negocio, mercado, personas, competencia, requerimientos).
2. **`docs/technical/`** — el cómo se construye (skills, principios, arquitectura, datos, estructura, roadmap).
3. **`docs/adr/`** — decisiones puntuales con contexto y consecuencias.

Los documentos están numerados por orden de lectura. **Ningún cambio al código se hace sin antes leer los documentos relevantes.** Si algo del código no respeta lo documentado, es deuda técnica y se abre ticket.

## TL;DR del producto

Un consultor argentino de HyS atiende entre 5 y 20 clientes (PYMEs e industrias). Su día se reparte 60-70% en papelería repetitiva (informes técnicos en Word, planillas Excel, agenda papel) y 30-40% en visitas reales. Pierde clientes por descuido (vencimientos olvidados) y se come multas por entregas de EPP fuera de plazo (Resolución SRT 299/11 obliga renovación cada 6 meses).

ConsultoraDemo resuelve dos cosas con IA:
1. **Genera el informe técnico** (ruido, iluminación, puesta a tierra, RGRL, carga de fuego) en 5 minutos en lugar de 2-4 horas.
2. **Avisa antes de cada vencimiento** (protocolo anual, EPP a 6 meses, calibraciones, capacitaciones).

Pricing: USD 30/mes plan Pro. Trial de 7 días. Sin llamar a comercial.

## Stack

- **Frontend:** Next.js 16 con App Router + React 19 + TypeScript strict + Tailwind 4 + shadcn/ui.
- **Backend:** Next.js Route Handlers y Server Actions, en Vercel serverless.
- **DB / Auth / Storage:** Supabase (Postgres con RLS multi-tenant).
- **IA:** Anthropic Claude API (Sonnet 4.6 por default — ver ADR-0003).
- **Notificaciones:** Resend (email) + Telegram Bot API + push web.
- **Pagos:** Mercado Pago.
- **Tests:** Vitest + Playwright.
- **CI/CD:** GitHub Actions + Vercel deploy automático.
- **Observabilidad:** Sentry + Vercel Analytics.

Ver `docs/technical/00-skills-y-stack.md` para detalle y justificación.

## Principios no negociables

1. **Modularidad estricta.** 14 módulos independientes, conocidos solo por su API pública.
2. **Seguridad por defecto.** Auth en cada Server Action, validación Zod en cada borde, RLS en cada tabla, secrets en variables de entorno.
3. **Type safety end-to-end.** TypeScript strict, Zod en bordes, tipos generados desde schema SQL.
4. **Tests obligatorios para lógica de dominio.** > 70% cobertura. Pirámide 70/20/10.
5. **CI/CD desde el primer commit.** Branch `main` protegida, deploy automático.
6. **Observabilidad first-class.** Sentry, logs estructurados, métricas custom.
7. **Documentación viva.** ADRs, READMEs por módulo, CLAUDE.md sincronizado.
8. **Performance y accesibilidad como hard requirements.** Lighthouse > 90, WCAG AA.
9. **Costo bajo control.** Tracking de tokens IA por consultora, prompt caching, modelo según tarea.
10. **Simplicidad sobre cleverness.** Solución más simple que cumple, siempre.

Detalle en `docs/technical/01-principles.md`.

## Estructura del repo

```
consultora-demo/
├── docs/
│   ├── discovery/        ← negocio, mercado, personas, competencia, síntesis
│   ├── technical/        ← skills, principios, arquitectura, datos, estructura, roadmap
│   └── adr/              ← decisiones puntuales registradas
├── src/
│   ├── app/              ← rutas Next.js
│   ├── modules/          ← 14 módulos de negocio
│   ├── shared/           ← código compartido (UI base, supabase, ai, observability)
│   └── tests/            ← unit, integration, e2e
├── supabase/
│   ├── migrations/       ← SQL versionado
│   └── seed.sql
├── public/
├── .github/workflows/    ← CI/CD
└── ...
```

Detalle en `docs/technical/04-folder-structure.md`.

## 14 módulos

**Capa transversal:** Auth, Tenancy, Auditoría, Notificaciones.
**Capa coordinación:** Calendario.
**Capa negocio:** Informes, EPP, Checklists, Catálogo de Tareas, Accidentabilidad, Permisos de Trabajo, Documentos, Capacitaciones, Pagos.

Cada módulo en `src/modules/<nombre>/` con `actions.ts`, `queries.ts`, `schemas.ts`, `types.ts`, `index.ts`, `README.md` y, según necesidad, `components/` y subcarpetas específicas.

Detalle en `docs/technical/02-architecture.md`.

## Modelo de datos

Todas las tablas con `consultora_id` y RLS desde el día cero. UUIDs por defecto. Soft delete con `archived_at` donde corresponde. Audit log inmutable. Tipos TypeScript generados automáticamente desde el schema.

Schema completo en `docs/technical/03-data-model.md`.

## Roadmap

**Fase 1 (6-8 semanas) — MVP cobrable.** Auth, Tenancy, Auditoría, Notificaciones, Calendario, Informes (5 tipos), EPP con tracking y planilla Res 299/11, Checklists Lite, libro de incidentes, Pagos con Plan Pro USD 30. Trial 7 días.

**Fase 2 (4 semanas) — Plan Team.** Coordinación de equipo, asignación, aprobación, branding consultora.

**Fase 3 (5 semanas) — PWA offline + obra.** Permisos diarios, kit de jornada, captura cámara/GPS, sync diferido.

**Fase 4 (6 semanas) — Inteligencia.** Repositorio documental con OCR + RAG, capacitaciones automáticas, accidentabilidad con IA, Plan Enterprise con multi-establecimiento.

**Fase 5+** — Avanzadas (chat conversacional, visión computacional, integraciones, marketplace, internacionalización).

Roadmap detallado por tickets en `docs/technical/10-roadmap.md`.

## Estado actual

- **Discovery completo** ✅ (4 documentos en `docs/discovery/`).
- **Diseño técnico completo** ✅ (6 documentos clave en `docs/technical/` incluyendo `06-deployment.md`).
- **ADRs iniciales** ✅ (template + ADR-0002 stack + ADR-0003 modelo Claude default + ADR-0004 branch protection diferida + ADR-0005 Vercel-GitHub auto-deploy + ADR-0006 multi-tenant RLS strategy).
- **Prototipo Fase 0** ✅ (`public/prototipo/index.html` estático, accesible vía rewrite `/prototipo`).
- **Sprint 0 — setup del repo** ✅ **COMPLETO (10/10)**
  - **T-001** ✅ Next.js 16 + TS strict + Tailwind 4 + shadcn/ui base.
  - **T-002** ✅ ESLint 9 (flat) + Prettier 3 + Husky 9 (commit-msg, pre-commit, pre-push).
  - **T-003** ✅ Vitest 3 (projects: unit, component) + Playwright (chromium).
  - **T-004** ✅ GitHub Actions CI (`.github/workflows/ci.yml`) + flow PR-based + hook pre-push contra push directo a `main` (branch protection server-side diferida, ver ADR-0004).
  - **T-005** ✅ Supabase CLI + proyecto remoto `consultora-demo` en sa-east-1 + migration de extensiones (uuid-ossp, pgcrypto, vector, pg_cron) aplicada al remote. Docker Desktop **no** instalado: trabajamos contra el remote.
  - **T-006** ✅ Cliente Supabase (server, browser, service-role) + helper proxy + validación de env con Zod en `src/env.ts` (server-only).
  - **T-007** ✅ Sentry (client + server + edge configs + `instrumentation.ts`) + logger pino con captura automática a Sentry en `error()`/`fatal()`. `/api/test-error` dev tool.
  - **T-008** ✅ Theme shadcn alineado al prototipo (indigo brand + 4 severity tokens) + 7 componentes base + `/styleguide` dev tool.
  - **T-009** ✅ Landing pública productiva (`/`) + `/login` UI (auth real T-012) + páginas legales `/terminos` y `/privacidad` con noindex + `robots.txt` + `sitemap.xml`. Lighthouse 97/100/100/100.
  - **T-010** ✅ Vercel deploy desde main con 9 env vars (Production + Preview) + `SENTRY_AUTH_TOKEN` activo (source maps automáticos) + ADR-0005 + runbook `docs/technical/06-deployment.md`. **URL productiva: <https://consultora-demo.vercel.app>**.
- **Sprint 1 — Auth + Tenancy + base multi-tenant** ✅ **COMPLETO (8/8)**
  - **T-011** ✅ Migration `tenancy.sql`: 3 tablas (`consultoras`, `consultora_members`, `audit_log`) + función `current_consultora_id()` + triggers + 5 RLS policies default-deny + ADR-0006.
  - **T-012** ✅ Signup flow productivo: `/signup` → `auth.signUp` + RPC `create_consultora_and_owner` (atómico, trial 7d, slug `unaccent`) → `/check-email` → email confirm → `/auth/callback?next=/login` → `/login?confirmed=1`.
  - **T-013** ✅ Login real (password) + magic link (botón secondary) + `/dashboard` stub (server-protected). `/auth/callback` con `?next=` allowlisted. Migration `dashboard_rls.sql` suma policy defensiva `consultoras_select_own_member`. `signOutAction` server-side.
  - **T-014** ✅ Password recovery completo + logout formalizado: `/recuperar-password` (form anti-enumeration) + `/cambiar-password` (server-protected) + `updatePasswordAction` con flujo `resetPasswordForEmail` → `/auth/callback?next=/cambiar-password` → `/dashboard?reset=ok`. Banner "Contraseña actualizada" en dashboard. Link "¿Olvidaste tu contraseña?" en LoginForm. 7 integration tests recovery + 6 E2E.
  - **T-015** ✅ RLS helpers SQL reusables: 4 funciones `stable security definer` en schema `public` (`is_member_of_consultora`, `is_owner_of_consultora`, `role_on_consultora`, `my_consultora_ids`). Policies pre-existentes refactorizadas (`consultoras_update_own_owner`, `consultoras_select_own_member`) — semántica idéntica, sin regresiones. 5 integration tests nuevos (13 → 18 RLS, 48/48 total). Migrations `20260511130757_rls_helpers.sql` + `20260511131522_rls_use_helpers.sql`. Dev tool `pnpm dev:smoke-rls-helpers`.
  - **T-016** ✅ Custom claim `consultora_id` en JWT via Supabase Auth Hook: `custom_access_token_hook()` inyecta `app_metadata.consultora_id` + `consultora_role` en cada token issue. `current_consultora_id()` refactor lee del claim. Fast-path en los 4 RLS helpers de T-015 (claim primero, fallback a `consultora_members`). Refresh explícito post-signin + post-callback PKCE. Validado E2E en prod: JWT real trae los claims.
  - **T-017** ✅ Layout autenticado con route group `(app)`: server-protected layout valida sesión + carga consultora via helper `getCurrentConsultora` (decodifica JWT claim para fast-path + fallback a `consultora_members`). App shell con sidebar (desktop fija + mobile Sheet), nav items con `usePathname`, user menu (DropdownMenu con cambiar contraseña + logout via `useTransition`). 4 shadcn components nuevos (sheet, dropdown-menu, avatar, tooltip). Dashboard simplificado con cards "Próximamente" por feature. Migración: `src/app/dashboard/*` → `src/app/(app)/dashboard/*`; `signOutAction` → `src/shared/auth/actions.ts`. Alert `?error=no_consultora` en LoginForm para edge case (user autenticado sin membership).
  - **T-018** ✅ E2E auth flow con Playwright: 5 tests con sesión real en `src/tests/e2e/auth-flows.spec.ts` (layout protection sin sesión + `no_consultora` alert + login happy path + logout + recovery completo 7 pasos). Helpers reusables en `src/tests/e2e/helpers/` (`createTestUserWithConsultora`, `deleteTestUser`, `generateRecoveryLinkUrl`, `loginViaUI`, `logoutViaUI`) que bypasean email rate limit via `admin.createUser({email_confirm:true})` + `admin.generateLink`. Cierra drift de placeholders Supabase en `ci.yml` → GitHub Secrets reales. Bump Node 20 → 22 LTS en CI (WebSocket nativo requerido por `@supabase/realtime-js`). Suite total: **39 unit/component + 57 integration + 28 E2E = 124 tests verdes** corriendo en CI sin opt-in flags.

- **Sprint 2 — Informes** 🔜 (próximo)
  - Arranca con **T-019** (generación de informes técnicos con IA · Claude API). Tickets posteriores definidos en `docs/technical/10-roadmap.md`.

### RLS / multi-tenancy

**Estrategia:** ADR-0006 (shared DB + RLS + custom claim en JWT). Decisión técnica completa con tradeoffs en `docs/adr/0006-multi-tenant-rls-strategy.md`.

**Helpers SQL reusables (T-015)** en schema `public`, todas `stable security definer set search_path = ''` con grants a `authenticated` + `service_role`:

- `is_member_of_consultora(uuid) → boolean` — true si `auth.uid()` es member de la consultora.
- `is_owner_of_consultora(uuid) → boolean` — idem + `role = 'owner'`.
- `role_on_consultora(uuid) → text` — rol del user en la consultora (`'owner'` | `'member'` | `null`).
- `my_consultora_ids() → setof uuid` — consultoras donde el user es member (MVP single-tenant per user, schema soporta m2m).

**Regla forward (no negociable):** TODA policy NUEVA de tablas del dominio (T-019+ clientes, empleados, informes, EPP, …) debe usar estos helpers, NO subqueries inline a `consultora_members`. Las policies pre-T-015 ya fueron refactorizadas en `supabase/migrations/20260511131522_rls_use_helpers.sql`.

Detalle + ejemplo de uso en `supabase/README.md` sección "RLS helpers". Definición en `supabase/migrations/20260511130757_rls_helpers.sql`.

## Cómo arrancar a construir

1. Asegurate de tener instalado Node 20+, pnpm, git, GitHub CLI, Supabase CLI y Vercel CLI.
2. Abrí Claude Code en este repo.
3. Decile: *"Leé `CLAUDE.md` y los documentos de `docs/`. Después arrancamos con el ticket T-001 del roadmap."*
4. Claude propone plan, validás, codea, hace PR.
5. Reviewás, mergéas, deploy automático.
6. Pasás al siguiente ticket.

## Glosario rápido

- **HyS:** Higiene y Seguridad Laboral.
- **EPP:** Elementos de Protección Personal.
- **SRT:** Superintendencia de Riesgos del Trabajo (regulador).
- **ART:** Aseguradora de Riesgos del Trabajo.
- **RGRL:** Relevamiento General de Riesgos Laborales (anual).
- **Res 299/11:** planilla de entrega de EPP firmada, renovación cada 6 meses.
- **Decreto 351/79 / 911/96 / 617/97:** decretos reglamentarios HyS por sector.
- **Protocolo:** informe con vigencia 12 meses, debe renovarse anualmente.

Glosario completo en `docs/discovery/06-glossary.md`.

## Decisiones tomadas en discovery (no re-discutir)

- D01 · Cliente target: el consultor profesional, no el empleador final.
- D02 · Foco geográfico inicial: AMBA + Córdoba + Santa Fe.
- D03 · Foco sectorial: industria + comercio + servicios privados + construcción.
- D04 · Pitch principal: resguardo legal — secundario: productividad.
- D05 · Versionado de normas SRT con libre elección.
- D06 · Comparación de versiones de norma con IA.
- D07 · Monitoreo normativo incluido en planes pagos, diferenciado por nivel.
- D08 · Foco del producto: generación de informes + calendario de vencimientos.
- D09 · Pricing público: Pro USD 30 / Team USD 100 / Enterprise USD 250.
- D10 · Plan Team disponible desde Fase 2.
- D11 · Plan Enterprise disponible desde Fase 4.
- D12 · Foco geográfico inicial AMBA + canales orgánicos.
- D13 · Programa de referidos activo desde el día uno.
- D14 · Métricas de validación con cláusulas de pivot a 60/90/180 días.

Lista viva en `docs/discovery/00-decisiones.md`.

## Disclaimer profesional

ConsultoraDemo es un asistente que genera documentos. **El profesional matriculado es responsable de revisar y firmar todo informe antes de presentarlo legalmente.** La app no reemplaza criterio profesional ni absuelve responsabilidad civil/penal. Esto está claro en los términos de uso y en cada informe generado.
