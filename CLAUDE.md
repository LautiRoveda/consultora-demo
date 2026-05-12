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
1. **Genera el informe técnico** (ruido, iluminación, puesta a tierra, RGRL, carga de fuego) en 5 minutos en lugar de 2-4 horas. **Form estructurado por dominio** (CUIT, ART, áreas, turnos, modalidad operativa, …) + Claude Sonnet 4.6 con domain intelligence HyS argentina → output 80-90% completo que el profesional matriculado firma con edits menores (no placeholders `[A COMPLETAR]` por todos lados).
2. **Avisa antes de cada vencimiento** (protocolo anual, EPP a 6 meses, calibraciones, capacitaciones).

Pricing: USD 30/mes plan Pro. Trial de 7 días. Sin llamar a comercial.

## Stack

- **Frontend:** Next.js 16 con App Router + React 19 + TypeScript strict + Tailwind 4 + shadcn/ui.
- **Backend:** Next.js Route Handlers y Server Actions, en **VPS Hostinger Ubuntu 24.04** (EasyPanel + Docker, Node 22 alpine, `output: 'standalone'`). Hosting principal desde T-022.5 — ver ADR-0007.
- **DB / Auth / Storage:** Supabase (Postgres con RLS multi-tenant).
- **IA:** Anthropic Claude API (Sonnet 4.6 por default — ver ADR-0003).
- **Notificaciones:** Resend (email) + Telegram Bot API + push web.
- **Pagos:** Mercado Pago.
- **Tests:** Vitest + Playwright.
- **CI/CD:** GitHub Actions (213+ tests) + **deploy manual click "Implementar"** en EasyPanel UI tras cada merge a `main` (EasyPanel v2.30.0 self-hosted no expone Auto Deploy — tracking T-022.5-FU3). Vercel hot-backup pausado 4 semanas post-cutover.
- **Observabilidad:** Sentry (client + server + edge) + logs estructurados pino expuestos en EasyPanel UI.

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
- **ADRs iniciales** ✅ (template + ADR-0002 stack + ADR-0003 modelo Claude default + ADR-0004 branch protection diferida + ADR-0005 Vercel-GitHub auto-deploy [parcialmente reemplazado por ADR-0007] + ADR-0006 multi-tenant RLS strategy + **ADR-0007 VPS Hostinger + EasyPanel + Docker**).
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
  - **T-010** ✅ Vercel deploy desde main con 9 env vars (Production + Preview) + `SENTRY_AUTH_TOKEN` activo (source maps automáticos) + ADR-0005 + runbook `docs/technical/06-deployment.md`. URL Vercel: <https://consultora-demo.vercel.app> (hot-backup post-T-022.5; **URL productiva actual: <https://consultora-demo.test-ia.cloud>**).
- **Sprint 1 — Auth + Tenancy + base multi-tenant** ✅ **COMPLETO (8/8)**
  - **T-011** ✅ Migration `tenancy.sql`: 3 tablas (`consultoras`, `consultora_members`, `audit_log`) + función `current_consultora_id()` + triggers + 5 RLS policies default-deny + ADR-0006.
  - **T-012** ✅ Signup flow productivo: `/signup` → `auth.signUp` + RPC `create_consultora_and_owner` (atómico, trial 7d, slug `unaccent`) → `/check-email` → email confirm → `/auth/callback?next=/login` → `/login?confirmed=1`.
  - **T-013** ✅ Login real (password) + magic link (botón secondary) + `/dashboard` stub (server-protected). `/auth/callback` con `?next=` allowlisted. Migration `dashboard_rls.sql` suma policy defensiva `consultoras_select_own_member`. `signOutAction` server-side.
  - **T-014** ✅ Password recovery completo + logout formalizado: `/recuperar-password` (form anti-enumeration) + `/cambiar-password` (server-protected) + `updatePasswordAction` con flujo `resetPasswordForEmail` → `/auth/callback?next=/cambiar-password` → `/dashboard?reset=ok`. Banner "Contraseña actualizada" en dashboard. Link "¿Olvidaste tu contraseña?" en LoginForm. 7 integration tests recovery + 6 E2E.
  - **T-015** ✅ RLS helpers SQL reusables: 4 funciones `stable security definer` en schema `public` (`is_member_of_consultora`, `is_owner_of_consultora`, `role_on_consultora`, `my_consultora_ids`). Policies pre-existentes refactorizadas (`consultoras_update_own_owner`, `consultoras_select_own_member`) — semántica idéntica, sin regresiones. 5 integration tests nuevos (13 → 18 RLS, 48/48 total). Migrations `20260511130757_rls_helpers.sql` + `20260511131522_rls_use_helpers.sql`. Dev tool `pnpm dev:smoke-rls-helpers`.
  - **T-016** ✅ Custom claim `consultora_id` en JWT via Supabase Auth Hook: `custom_access_token_hook()` inyecta `app_metadata.consultora_id` + `consultora_role` en cada token issue. `current_consultora_id()` refactor lee del claim. Fast-path en los 4 RLS helpers de T-015 (claim primero, fallback a `consultora_members`). Refresh explícito post-signin + post-callback PKCE. Validado E2E en prod: JWT real trae los claims.
  - **T-017** ✅ Layout autenticado con route group `(app)`: server-protected layout valida sesión + carga consultora via helper `getCurrentConsultora` (decodifica JWT claim para fast-path + fallback a `consultora_members`). App shell con sidebar (desktop fija + mobile Sheet), nav items con `usePathname`, user menu (DropdownMenu con cambiar contraseña + logout via `useTransition`). 4 shadcn components nuevos (sheet, dropdown-menu, avatar, tooltip). Dashboard simplificado con cards "Próximamente" por feature. Migración: `src/app/dashboard/*` → `src/app/(app)/dashboard/*`; `signOutAction` → `src/shared/auth/actions.ts`. Alert `?error=no_consultora` en LoginForm para edge case (user autenticado sin membership).
  - **T-018** ✅ E2E auth flow con Playwright: 5 tests con sesión real en `src/tests/e2e/auth-flows.spec.ts` (layout protection sin sesión + `no_consultora` alert + login happy path + logout + recovery completo 7 pasos). Helpers reusables en `src/tests/e2e/helpers/` (`createTestUserWithConsultora`, `deleteTestUser`, `generateRecoveryLinkUrl`, `loginViaUI`, `logoutViaUI`) que bypasean email rate limit via `admin.createUser({email_confirm:true})` + `admin.generateLink`. Cierra drift de placeholders Supabase en `ci.yml` → GitHub Secrets reales. Bump Node 20 → 22 LTS en CI (WebSocket nativo requerido por `@supabase/realtime-js`). Suite total: **39 unit/component + 57 integration + 28 E2E = 124 tests verdes** corriendo en CI sin opt-in flags.

- **Sprint 2 — Informes** 🚧 (en curso, 5 tickets completos)
  - **T-019** ✅ Módulo Informes MVP — primer ticket del módulo de negocio, sienta patrón forward para Clientes/Empleados/EPP/Calendario. Migration `20260511232802_informes.sql`: tabla `public.informes` (`tipo` text+check con 5 valores · `titulo` · `contenido` nullable · `status` `draft|published|archived` · `created_by`) + 2 indexes + 3 RLS policies (SELECT/INSERT/UPDATE con WITH CHECK) usando helpers de T-015 + sin policy DELETE (default-deny para authenticated; UI usa `status='archived'` como soft-archive) + función `audit_informes()` (security definer) con triggers AFTER INSERT/UPDATE/DELETE que escriben a `audit_log` con diff jsonb en `before_data`/`after_data`, cumpliendo la promesa de `tenancy.sql:237-238`. UI MVP bajo route group `(app)`: `/informes` (lista + empty state), `/informes/nuevo` (RHF + zodResolver + shadcn Select), `/informes/[id]` (placeholder de contenido — editor llega en T-020). `createInformeAction` con discriminated union. Sidebar item Informes pasa de `soon` → `live`. Tests: 21 integration RLS/audit/check + 3 integration actions con session cookie mockeado + 2 E2E happy path + 1 nuevo unit en `AppSidebarNav.test.tsx`. Suite total: **40 unit/component + 81 integration + 30 E2E = 151 tests verdes**.
  - **T-020** ✅ Editor de contenido + generación con Claude API — primer hit productivo a Anthropic. Anthropic SDK 0.95.1 (singleton server-only en `src/shared/ai/anthropic.ts`, modelo `claude-sonnet-4-6` por ADR-0003). 5 system prompts hardcoded en `src/shared/ai/prompts/` por tipo de informe (relevamiento/capacitacion/rgrl/accidente/otros), cada uno con header común (rol HyS AR, regla PII Ley 25.326, anti-invención de cuantitativos/normativa) + secciones específicas. `generateInformeContentAction` con discriminated union de 9 codes (INVALID_INPUT/UNAUTHENTICATED/NO_CONSULTORA/FORBIDDEN/NOT_FOUND/RATE_LIMITED/CONTENT_FILTER/TIMEOUT/INTERNAL_ERROR), prompt caching `ephemeral` sobre system block, `max_tokens: 4096` por Vercel Hobby 10s timeout (#26 sube a 8192 con Pro tier), logger nunca registra prompt ni response — solo metadata. `updateInformeContentAction` con permission gate defensivo + RLS WITH CHECK del lado DB. Migration `20260512003301_audit_informes_include_contenido.sql` extiende `audit_informes()`: diff guard ahora incluye `contenido`, payload jsonb agrega `contenido_size` + `contenido_preview` (500 chars + `...`). UI `/informes/[id]/editar` con `EditorView` client (RHF + zodResolver, state machine idle/generating/generated/saving, textarea userPrompt con cap 2000 chars + contador, botón "Generar con IA", preview markdown live), `MarkdownPreview` server reutilizable (react-markdown + remark-gfm + rehype-sanitize). `/informes/[id]` ahora renderiza markdown real con botón Editar condicional (creator OR owner). shadcn `textarea` instalado. Tests: 9 integration con `vi.mock('@/shared/ai/anthropic')` (preserva error classes reales del SDK) + 2 E2E (save flow + permission gate UI) + 1 unit nuevo en `env.test.ts`. Follow-up `#26` T-020-FU1 (`tech-debt`, `T-020-followup`). Suite total: **41 unit/component + 90 integration + 32 E2E = 163 tests verdes**.
  - **T-021** ✅ Templates parametrizados RGRL — primer **form-driven generation con domain intelligence**. Migration `20260512015104_informe_metadata.sql`: tabla `public.informe_metadata` (1:1 con `informes` via PK=FK `on delete cascade` · `data jsonb`) + 3 RLS policies (SELECT/INSERT/UPDATE) con `EXISTS`-subquery contra `informes` y helpers de T-015 (gate creator OR owner) + función `audit_informe_metadata()` (security definer) con guard `pg_column_size(data) <= 4 KB` y fallback `{_truncated: true}` sin `_field_count` innecesario. Módulo shared en `src/shared/templates/rgrl/`: schema Zod de 14 fields (`razon_social`, `cuit`, `domicilio`, `localidad`, `provincia` enum 24 valores, `actividad_principal`, `codigo_ciiu` opcional, `cantidad_empleados`, `distribucion_turno` enum, `modalidad_operativa` enum, `art_contratada`, `servicio_hys_modalidad` enum, `areas_relevadas` array min 1 max 20, `riesgos_pre_detectados` opcional, `fecha_relevamiento`) + 5 constantes (PROVINCIAS_AR, DISTRIBUCION_TURNO, MODALIDAD_OPERATIVA, SERVICIO_HYS_MODALIDAD, AREAS_RELEVADAS_PRESETS) + helpers `normalizeCuit` / `normalizeRgrlMetadata` + `renderRgrlMetadataAsPromptContext` con sanitización anti-prompt-injection (escape backticks + blockquote para riesgos + footer re-anclaje) + `RgrlMetadataForm` (client RHF, 5 secciones responsive `md:grid-cols-2`, checkbox group iterando presets + textarea "Otras áreas" con dedup case-insensitive cap 20, `<Input type="date">` nativo, `normalizeCuit` onBlur) + `RgrlMetadataSummary` (client con Collapsible "Ver datos completos" + `useMediaQuery` SSR-safe con `useSyncExternalStore`). `generateInformeContentAction` extendido: si `tipo='rgrl'` y hay metadata, prepende al **user message** (system block intacto → prompt caching ephemeral preservado), fallback no bloqueante a comportamiento T-020 si metadata no parsea (drift). `updateInformeMetadataAction` nueva con UPSERT por `informe_id`. `createInformeAction` acepta `metadata` opcional, no bloqueante si persist falla. UI `/informes/nuevo` rewritten a wizard 2-step (`AlertDialog` "Crear sin datos" con label "Crear vacío"), `/editar` suma panel Collapsible arriba con form RGRL + acción separada "Guardar datos", `/[id]` renderiza summary arriba del markdown cuando hay metadata. 3 shadcn components nuevos (`alert-dialog`, `collapsible`, `checkbox`) + 1 hook `useMediaQuery` en `src/shared/lib/`. Tests: 5 integration `informes-metadata-actions` (INVALID_INPUT/UNAUTHENTICATED/NOT_FOUND/FORBIDDEN/UPSERT + audit) + 5 integration `informes-metadata-rls` (SELECT cross-tenant denied + SELECT permitido owner + INSERT denied member-non-owner + UPDATE denied cross-tenant + cascade DELETE) + 4 nuevos en `informes-content-actions.test.ts` (inyecta context + shape end-to-end + combina notes + fallback schema-drift) + 2 E2E `informes-rgrl-template.spec.ts` (wizard happy path + permission gate UI sobre summary). Smoke productivo: output del LLM con todos los valores del form inyectados, placeholders `[A COMPLETAR]` solo en campos no provistos, domain knowledge correcto (Decreto 1338/96, 351/79, WBGT, LOTO, audiometrías), Claude detectó inconsistencia provincia ↔ localidad y la corrigió con nota al firmante. Suite total: **41 unit/component + 104 integration + 34 E2E = 179 tests verdes**.
  - **T-022** ✅ Templates parametrizados para los 4 tipos restantes — **completa el módulo Informes con form-driven generation cross-tipo**. 4 schemas Zod nuevos en `src/shared/templates/<tipo>/schema.ts`: `capacitacion` (10 fields: 3 cliente + fecha + modalidad enum + duracion_horas decimal + tema_principal + capacitador_nombre + capacitador_matricula opt + cantidad_asistentes + contenidos_resumen opt), `relevamiento` (8 fields: 5 cliente+sitio + fecha + areas_relevadas array + agentes_a_relevar enum array de 10 valores HyS + equipos_medicion opt), `accidente` (12 fields: 3 cliente + fecha + hora HH:MM + lugar + puesto + tipo_lesion array Anexo I Res. SRT 1604/07 + partes_cuerpo array + gravedad enum + dias_baja opt + testigos boolean + descripcion_inicial min 10 max 4000), `otros` (4 fields wildcard: razon_social + cuit + tema_informe + objetivos opt). Módulo `common/` nuevo con `commonClientFields()`/`commonClientFieldsWithSite()` factories + `sanitizeField`+`renderAsBlockquote` + `normalizeCuit` + `PROVINCIAS_AR`+`provinciaName` + `AREAS_RELEVADAS_PRESETS` + `fechaIsoField`+`HORA_HHMM_REGEX` + `summary-ui.tsx` (`Item`+`StatusBadge`+`formatFecha`). 4 renders markdown en `<tipo>/render.ts` con footer de re-anclaje específico por tipo (accidente: NO inventar causa raíz ni testigos; relevamiento: umbrales SRT Decreto 351/79 Anexo V + Res. 295/03; capacitación: no inventar listado nominal; otros: adapta a tema+objetivos sin estructura impuesta). 4 `<Tipo>MetadataForm` client + 4 `<Tipo>MetadataSummary` client siguiendo patrón canónico T-021 (grid 2 cols desktop, Separator+h3 por sección, RHF FormField, Collapsible "Ver datos completos"). **Registry pattern split**: `registry/server.ts` (schemas+renders+normalize, importable desde Server Actions sin arrastrar JSX) + `registry/client.tsx` (defaults+FormComponent+SummaryComponent, bundle visual). `updateInformeMetadataInputSchema` → **discriminated union** `z.discriminatedUnion('tipo', [...])` con 5 variantes; el action verifica `input.tipo === informe.tipo` server-side. Wizard `/informes/nuevo` refactor con `useFormsByTipo()` hook que instancia 5 `useForm` hardcoded (React Rules of Hooks no permite Object.fromEntries+map) — volver al mismo tipo preserva values (UX preferida). `EditorView` refactor: `FormComponent` dinámico del registry; `useForm<FieldValues>` con `SCHEMA_BY_TIPO[tipo]` casteado a `ZodType<FieldValues, FieldValues>`. `/informes/[id]/page.tsx` refactor: `SummaryComponent` dinámico. `getInformeMetadata(supabase, id, tipo)` genérica con return type discriminado `{ tipo, data: unknown } | null`. **RGRL adopta `commonClientFieldsWithSite`+`fechaIsoField`** sin breaking (jsonb keys idénticas, smoke check verde contra 53 filas reales en remote). Tests: 4 unit `templates-<tipo>-schema.test.ts` (~7 tests c/u con happy path + validación bounds + normalize + render sanitize) + 5 nuevos integration en `informes-metadata-actions` via `describe.each(tipoFixtures)` (4 happy path UPSERT por tipo + 1 mismatch tipo) + 2 E2E `informes-capacitacion-template.spec.ts` (wizard happy path + save metadata). Ajuste de `informes.spec.ts` (T-019) al wizard 2-step (los 5 tipos ramifican ahora, no hay "quick path"). Smoke productivo en preview con los 4 tipos nuevos: **outputs truncated por `max_tokens=4096`** (capacitación corta en Anexo D, accidente en sección 7 hallazgos, relevamiento en tabla 4.3 ergonomía, otros en sección 5.4.2). Calidad excelente hasta el cut — follow-up T-022-FU1 (`#36`, cierra automáticamente con T-022.5 migración VPS). Follow-up T-022-FU2 (`#37`, flaky retry pre-existente T-020). Suite total: **68 unit/component + 109 integration + 36 E2E = 213 tests verdes**.
  - **T-022.5** ✅ Migración deployment Vercel → **VPS Hostinger + EasyPanel + Docker** — destraba el cap `max_tokens` (sin timeout de plataforma) y baja USD 20/mes vs Vercel Pro. PR `#39` merge SHA `f61aec2`. ADR-0007 con config literal del Service para EasyPanel UI. `next.config.ts` `output: 'standalone'` (imagen Docker ~350 MB vs ~1.2 GB). `Dockerfile` multi-stage Node 22 alpine + corepack `pnpm@11.0.9` + user no-root, **deps stage usa `pnpm install --frozen-lockfile --ignore-scripts` + `pnpm rebuild sharp esbuild`** (workaround dual: bypass `ERR_PNPM_IGNORED_BUILDS` de pnpm 11 strict mode + husky `prepare` postinstall fail por `.git` excluido en `.dockerignore`). `actions.ts` sube `max_tokens` 4096 → 8192 (cap teórico Sonnet 4.6 = 64 k). Deploy operacional: click manual "Implementar" en EasyPanel UI tras cada merge (v2.30.0 self-hosted no expone Auto Deploy ni webhook URL — probamos 2 approaches automáticos antes de aceptar manual; tracking T-022.5-FU3). Vercel queda como **hot backup 4 semanas** con auto-deploy pausado, decommission programado +28 días (tracking T-022.5-FU2). Cierra issues `#26` (T-020-FU1) + `#36` (T-022-FU1). Suite total mantiene **213 tests verdes** (cambios sin impacto de runtime); CI ya no tiene job `deploy` (lo dispara EasyPanel del lado del VPS). Smoke productivo end-to-end ✅ con los 5 tipos generando outputs completos sin truncar. **URL productiva: <https://consultora-demo.test-ia.cloud>**.
  - **T-023** 🔜 (próximo) Export PDF de informes. Permite al consultor descargar el informe generado como PDF firmable. Briefing por venir.

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
