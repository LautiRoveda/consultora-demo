# ConsultoraDemo

Plataforma SaaS para consultores de Higiene y Seguridad Laboral en Argentina, **potenciada por IA**, con foco en dos pilares: **generación de informes técnicos** y **calendario de vencimientos con alertas proactivas**. No es una suite EHS genérica — son dos cosas hechas mejor que la competencia.

## Si sos Claude Code o un agente IA

Leé en orden: (1) `docs/discovery/` porqué · (2) `docs/technical/` cómo · (3) `docs/adr/` decisiones puntuales · (4) `docs/sprints/sprint-N.md` detalle granular ticket-por-ticket · (5) `docs/lessons-learned.md` lessons cross-sprint. Ningún cambio al código sin leer los docs relevantes; drift = deuda técnica → ticket.

## TL;DR del producto

Consultor argentino de HyS atiende 5-20 clientes (PYMEs + industrias). Día 60-70% papelería + 30-40% visitas. Pierde clientes por descuido (vencimientos olvidados) y come multas por EPP fuera de plazo (Res SRT 299/11 obliga renovación 6m).

ConsultoraDemo con IA: (1) **genera informe técnico** (ruido / iluminación / puesta a tierra / RGRL / carga de fuego) en 5 min vs 2-4 hs — form estructurado + Claude Sonnet 4.6 con domain intelligence HyS AR → output 80-90% que el matriculado firma con edits menores; (2) **avisa antes de cada vencimiento** (protocolo anual / EPP 6m / calibraciones / capacitaciones). Pricing ARS 30.000/mes plan único (15% off anual), trial 14d sin tarjeta, sin comercial.

## Stack

Next.js 16 (App Router) + React 19 + TS strict + Tailwind 4 + shadcn/ui · Server Actions + Route Handlers en **VPS Hostinger** (EasyPanel + Docker, Node 22 alpine, `output: 'standalone'`, imagen ~600 MB con Chromium-alpine + Puppeteer para PDFs) · **Supabase** (Postgres + RLS + Auth + Storage) · **Claude API Sonnet 4.6** (ADR-0003) · Notificaciones: **Resend** + **Telegram** + **Web Push VAPID** · Pagos Mercado Pago · Tests Vitest + Playwright · CI/CD GitHub Actions + Auto Deploy EasyPanel webhook · Observabilidad Sentry + pino.

URL productiva: <https://consultora-demo.test-ia.cloud>. Detalle en `docs/technical/00-skills-y-stack.md`.

## Principios no negociables

(1) **Modularidad estricta** — 14 módulos vía API pública. (2) **Seguridad por defecto** — auth en cada Server Action, Zod en cada borde, RLS en cada tabla, secrets en env. (3) **Type safety end-to-end** — TS strict + Zod en bordes + tipos generados desde schema SQL. (4) **Tests obligatorios** — >70% cobertura, pirámide 70/20/10. (5) **CI/CD desde el primer commit** — `main` protegida, deploy automático. (6) **Observabilidad first-class** — Sentry + logs pino + métricas custom. (7) **Documentación viva** — ADRs + READMEs + CLAUDE.md sincronizado. (8) **Performance + accesibilidad hard requirements** — Lighthouse > 90, WCAG AA. (9) **Costo bajo control** — tracking tokens IA + prompt caching + modelo según tarea. (10) **Simplicidad sobre cleverness**.

Detalle en `docs/technical/01-principles.md`.

## Economía de tokens (CC + orquestador)

Reglas de eficiencia: ahorran contexto SIN cambiar el resultado ni saltear el workflow. Ante conflicto, ganan los principios no negociables y las paradas plan-first.

1. **Contexto antes de actuar.** Leé los archivos/docs relevantes antes de codear o planificar. Si falta contexto, preguntá; no asumas.
2. **Leé lo justo.** `offset`/`limit` para secciones puntuales; Read directo si sabés la ruta; no releas un archivo ya leído salvo que haya cambiado.
3. **Tool calls en paralelo.** Lecturas/búsquedas independientes en un solo mensaje.
4. **Grep/Read antes que Agent.** Agent solo para búsquedas amplias o tareas multi-paso.
5. **Edit, no Write.** Write solo si el cambio es >80% del archivo. No copies el archivo editado en la respuesta: alcanza el diff.
6. **Respuestas al grano.** Tan cortas como la tarea permita, sin preámbulo ni resumen final, sin repetir lo que dijo el owner, sin adulación. Un briefing o un review pueden ser largos si el contenido lo exige; el ruido no.
7. **Alcance mínimo, seguridad incluida.** Implementá lo pedido, sin features ni abstracciones especulativas. Pero Zod en cada borde, auth en cada action, RLS y tests NO son extras: son el alcance. El minimalismo nunca recorta seguridad/validación/tests.
8. **Discrepancia técnica = breve y seguís.** Si discrepás, 1-2 oraciones y procedés con el criterio del owner — EXCEPTO si toca seguridad o una parada del workflow: ahí parás.
9. **No narres lo trivial.** Nada de "ahora voy a leer X"; los tool calls se ven. El plan-first formal (plan → review → OK) NO es narración: ese gate se mantiene siempre.
10. **Validá antes de declarar "listo".** Corré/testeá/verificá. Nunca "hecho" sin evidencia.

## Estructura del repo

`docs/` (discovery + technical + adr + sprints + operations + lessons-learned.md) · `src/` (`app/` rutas Next.js + los 14 módulos co-localizados en `app/(app)/<modulo>/` · `shared/` UI base + supabase + ai + observability · `tests/` unit + integration + e2e) · `supabase/` (migrations + seed.sql) · `public/` · `.github/workflows/`. Detalle en `docs/technical/04-folder-structure.md`.

## 14 módulos

**Transversal** Auth · Tenancy · Auditoría · Notificaciones · **Coordinación** Calendario · **Negocio** Informes · EPP · Checklists · Catálogo de Tareas · Accidentabilidad · Permisos de Trabajo · Documentos · Capacitaciones · Pagos. Cada módulo vive co-localizado en `src/app/(app)/<modulo>/` (`actions.ts` + `queries.ts` + `schema.ts` + componentes `.tsx` + subrutas `nuevo/` y `[id]/`; `labels.ts`/helpers cuando aplica). Detalle en `docs/technical/02-architecture.md`.

## Modelo de datos

Tablas con `consultora_id` + RLS desde el día cero · UUIDs por defecto · soft delete con `archived_at` · audit log inmutable · tipos TS generados desde el schema (`pnpm db:types`). Schema completo en [`docs/technical/03-data-model.md`](docs/technical/03-data-model.md).

## Roadmap

Roadmap por fases en [`docs/technical/10-roadmap.md`](docs/technical/10-roadmap.md). Detalle granular ticket-por-ticket en `docs/sprints/`.

| Sprint | Tickets | Detalle |
|---|---|---|
| 0 ✅ | T-001..T-010 setup repo | [sprint-0.md](docs/sprints/sprint-0.md) |
| 1 ✅ | T-011..T-018 auth + tenancy | [sprint-1.md](docs/sprints/sprint-1.md) |
| 2 ✅ | T-019..T-025 informes | [sprint-2.md](docs/sprints/sprint-2.md) |
| 3 ✅ | T-026..T-037 + T-034 calendario + notificaciones | [sprint-3.md](docs/sprints/sprint-3.md) |
| 4 🚧 | T-047..T-055 clientes + empleados (Clientes ✅ + Empleados ✅) | [sprint-4.md](docs/sprints/sprint-4.md) |
| 5 ✅ | T-100..T-106 EPP + T-109 trazabilidad EPP per-empleado + resumen semanal + **T-114** (fix reminders EPP) | [sprint-5.md](docs/sprints/sprint-5.md) |
| 6 ✅ | Incidentes: T-062 + T-063 + T-063-FU1 + T-075 link IA + T-063-FU2 ✅. Checklists: T-057..T-059 + T-060/T-061 (lifecycle+runner+cierre+firma+PDF+anular+FU1) ✅ en prod. Consistencia EPP↔calendario: T-114/T-119/T-118 ✅. Asistente IA: T-117/FU1 + **T-117-FU3** (streaming SSE + markdown + tests del cliente) + **T-125** (registry de tools multi-módulo + Checklists/Inspecciones) + **T-126** (persistencia del chat) ✅. Responsive: **T-127 Tandas 1-6 + FUs** (primitivos híbridos · tablas→cards · nav móvil · forms · calendario · chat · wizard) ✅ (queda T7 pulido). Auditoría integridad ADR-0015: T-122/120/123/124/121 ✅ | [operativo.md](docs/sprints/operativo.md) |
| Op | Transversales (T-079 email templates, T-052-FU1/FU2 VPS runbook + monitor, T-111 aislamiento tests + cleanup prod, …) | [operativo.md](docs/sprints/operativo.md) |

**Próximo ticket**: **Checklists/Inspecciones** (T-057..T-061 + FU1) ✅ en prod (lifecycle + runner + cierre con firma + PDF + anular). **Tanda de consistencia EPP↔calendario** ✅ en prod (T-114 fix reminders · T-117/FU1 asistente IA · T-119 lifecycle planificaciones · T-118 sync calendario→dominio; ADR-0015). **Auditoría de integridad ADR-0015** ✅ en prod (T-122 plan-cache · T-120 lifecycle CAPAs · T-123 skip reminders estructural · T-124 churn reaper + leak gate · T-121 FK compuestas Ring A + audit_consultoras). **Pagos** en prod (MP Subscriptions, billing gate, trial 14d). **Campo Puesto → catálogo** ✅ en prod (T-128 selector + T-129 fase A/B: corte de consumers al catálogo + drop de la columna legacy). **Rediseño del dashboard** ✅ en prod (T-131 fase A operativo + fase B semáforo por cliente; T-132 endureció el flake E2E del guard EXEC_NOT_DRAFT). **Templates moldeables** ✅ ÉPICA CERRADA (T-138 fases 1+2: campos personalizados + instrucciones en los 5 tipos · secciones configurables en relevamiento/capacitacion/otros — rgrl/accidente fijos por estructura legal; system prompt estático re-armado desde catálogo → caching intacto · **T-139 fase 3**: plantillas guardables "Mis plantillas" — tabla `informe_plantillas` + RLS per-consultora + snapshot-on-apply con degrade + gestión en `informes/plantillas`). **Editor WYSIWYG del informe** ✅ núcleo cerrado (T-140 Fase 1 editor Plate `platejs` + source-mode + round-trip markdown `remark-gfm` · FU1 full-width/tablas mobile/preview contextual · T-141 Fase A toolbar de formato + operaciones de tabla por celda `disableMerge` · Fase C autosave server draft-only `informes.contenido_borrador` + promoción del borrador al publicar; B1 slash / B2 syntax highlighting diferidos por bajo valor). Próximo: **auditoría de seguridad (Opus 4.8)** / **RGRL completo** / T-127 Tanda 7 pulido / FU dormidos (T-117-FU2 ventana vencimientos, T-126 producto, skew PostgREST local↔prod, T-121-FU, flaky E2E, doc-drift data-model) — a definir por el owner.

## RLS / multi-tenancy

**Estrategia ADR-0006**: shared DB + RLS + custom claim JWT. Tradeoffs en `docs/adr/0006-multi-tenant-rls-strategy.md`.

**Helpers SQL reusables (T-015)** en schema `public`, todos `stable security definer set search_path = ''` con grants a `authenticated` + `service_role`:

- `is_member_of_consultora(uuid) → boolean` — `auth.uid()` es member.
- `is_owner_of_consultora(uuid) → boolean` — idem + `role = 'owner'`.
- `role_on_consultora(uuid) → text` — `'owner' | 'member' | null`.
- `my_consultora_ids() → setof uuid` — consultoras del user (MVP single-tenant per user, schema soporta m2m).

**Regla forward (no negociable):** TODA policy NUEVA de tablas del dominio (clientes / empleados / informes / EPP / …) debe usar estos helpers, NO subqueries inline a `consultora_members`. Policies pre-T-015 ya refactorizadas en `supabase/migrations/20260511131522_rls_use_helpers.sql`.

**Custom claim JWT (T-016):** `consultora_id` + `consultora_role` inyectados en cada token issue via `custom_access_token_hook()`. Los 4 helpers tienen fast-path que lee del claim, fallback a `consultora_members`.

Audit triggers + ejemplos: `supabase/README.md` + [lessons-learned.md](docs/lessons-learned.md).

## Cómo arrancar a construir

Instalá Node 22+ / pnpm / git / GitHub CLI / Supabase CLI · Abrí Claude Code en este repo · Decile *"Leé `CLAUDE.md` y los documentos de `docs/`. Arrancamos con el ticket T-XXX del roadmap"* · Plan → validás → codea → PR → reviewás → merge → deploy automático.

Lessons forward consolidadas en [docs/lessons-learned.md](docs/lessons-learned.md).

## Glosario rápido

**HyS** Higiene y Seguridad Laboral · **EPP** Elementos de Protección Personal · **SRT** Superintendencia de Riesgos del Trabajo · **ART** Aseguradora de Riesgos del Trabajo · **RGRL** Relevamiento General de Riesgos Laborales (anual) · **Res 299/11** planilla entrega EPP firmada (renovación cada 6m) · **Decreto 351/79 / 911/96 / 617/97** decretos reglamentarios HyS por sector · **Protocolo** informe con vigencia 12m, renovable anual.

Glosario completo en `docs/discovery/06-glossary.md`.

## Decisiones tomadas en discovery (no re-discutir)

**D01** target = consultor profesional (no empleador final) · **D02/D12** foco geográfico AMBA + Córdoba + Santa Fe via canales orgánicos · **D03** foco sectorial industria + comercio + servicios privados + construcción · **D04** pitch resguardo legal > productividad · **D05/D06/D07** normas SRT libre elección de versión + comparación IA + monitoreo en planes pagos · **D08** foco del producto: informes + calendario · **D09** pricing Pro USD 30 / Team USD 100 (Fase 2) / Enterprise USD 250 (Fase 4) · **D13** referidos desde día uno · **D14** métricas con cláusulas de pivot 60/90/180 días.

Lista viva en `docs/discovery/00-decisiones.md`.

## Disclaimer profesional

ConsultoraDemo genera documentos. **El matriculado revisa y firma todo informe antes de presentarlo legalmente.** No reemplaza criterio profesional ni absuelve responsabilidad civil/penal.
