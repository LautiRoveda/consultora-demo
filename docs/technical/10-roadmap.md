# Technical 10 · Roadmap de implementación

Cómo construir el sistema, ticket por ticket, con dependencias claras. La idea: cada ticket es chico, autocontenido, y cuando termina deja el sistema en estado "verde y deployable".

## Filosofía de implementación

- **Construir el esqueleto antes que la carne.** Primero los módulos transversales (Auth, Tenancy, Auditoría, Notificaciones, Calendario), después la lógica de negocio. Sin un buen esqueleto, los módulos de negocio se pisan entre sí.
- **Ticket = PR.** Un ticket cierra cuando hay PR mergeada en main, con CI verde, código en producción.
- **Tickets pequeños.** 200-500 líneas de cambio promedio. Si pesa más, partir.
- **Deploy continuo.** Cada PR mergeada se deploya. Si el deploy falla, el revert es inmediato.
- **TDD donde aplica.** Para lógica de dominio (cálculos, generadores, validadores), escribir test primero. Para UI, no es obligatorio.

## Estado del roadmap

Última actualización: 2026-06-13 (doc-sync: **RAR Fase 1 CERRADA** —T-143 #259, catálogo de agentes 658/96 + exposición puesto×agente, en prod; épica RAR sigue abierta con Fases 2/3—). Previo (2026-06-09): campo Puesto → catálogo **CERRADA** —T-129 fase B dropeó la columna legacy `empleados.puesto` + función backfill + puente, #234—; rediseño del dashboard **CERRADO** —T-131 fase A operativo #235 + fase B semáforo por cliente #238—; T-132 #236 endureció el flake E2E del guard `EXEC_NOT_DRAFT`.

- **Sprint 0/1** (T-001..T-018) ✅ ejecutados con la numeración planificada original.
- **Sprint 2 original** ("Auditoría + Notificaciones + Calendario") ✅ ejecutado con numeración real **T-026..T-037 + T-034** durante el Sprint 3 cronológico real. Ver CLAUDE.md para mapping detallado.
- **Sprint 3 original** ("Pagos") ✅ **EJECUTADO** (renumerado T-039..T-046): módulo Pagos en prod — billing gate `requireBillingAccess`, MP Subscriptions (ADR-0008), dunning T-074, trial 14d T-108, `/settings/billing`.
- **Sprint 4 original** ("Informes core") ✅ ejecutado mayormente durante Sprint 2 real (T-019..T-025) con tipos genéricos en lugar de norma-específicos.
- **Sprint 5/6 originales** (EPP / Checklists) ✅ **ejecutados** (EPP T-100..T-106/T-109/T-114, Checklists T-057..T-061 — en prod, ver `operativo.md`). Sprint 7 ("Pulido") 🔜 sin renumerar.
- **Tanda de consistencia EPP↔calendario** (2026-06-04, ADR-0015): T-114 (fix reminders EPP), T-117/FU1 (asistente IA EPP), T-119 (lifecycle planificaciones), T-118 (sync calendario→dominio) — todas en prod. **Pagos · EPP · Checklists/Inspecciones · Accidentabilidad/Incidentes** están en prod (ver `CLAUDE.md` + `operativo.md`).
- **Asistente IA + responsive** (2026-06-06, post-ADR-0015): el asistente evolucionó con streaming SSE + render markdown (T-117-FU3), registry de tools multi-módulo + tools de Checklists/Inspecciones (T-125) y persistencia del chat con conversaciones + historial (T-126); arrancó el responsive de primitivos compartidos (T-127 Tanda 1). Detalle en `operativo.md`.
- **Responsive T-127 completo** (2026-06-08): el responsive de la app quedó cerrado — tandas 1-6 + follow-ups en prod (primitivos híbridos · tablas→cards · nav móvil/landing · barras de forms · calendario · chat · wizard de entrega). Queda **T7 (pulido)**: tipografía/densidad + guard anti-drift del dashboard. Detalle en `operativo.md`.
- **Campo Puesto → catálogo** ✅ **CERRADA** (2026-06-09): el campo "Puesto" del empleado pasó de texto libre a selector del catálogo (T-128, #231), los consumers legacy de `empleados.puesto` se cortaron al catálogo vía el helper `getEmpleadoPuestosLabel` + backfill idempotente (T-129 fase A, #232, `049cd26`) y la **fase B** dropeó la columna legacy + la función backfill + el puente de escritura (T-129 fase B, #234, migración `20260608000002`) — todo en prod. Detalle en `operativo.md`.
- **Rediseño del dashboard** ✅ **CERRADA** (2026-06-09): dashboard operativo —saludo + pulso + 4 contadores accionables + cola "lo que necesita tu atención" + columna derecha + FAB móvil— (T-131 fase A, #235) y **semáforo por cliente** vía RPC `semaforo_clientes` (T-131 fase B, #238), ambos en prod; reemplaza el viejo `ProximosVencimientosPanel`. **T-132** (#236) endureció el flake E2E del guard `EXEC_NOT_DRAFT` (split a test zero-write). Detalle en `operativo.md`.
- **RAR (Relevamiento de Agentes de Riesgo) · Fase 1** ✅ (2026-06-13): vertical nuevo —la DJ anual del 658/96 de trabajadores expuestos—. Fase 1 = catálogo de agentes `rar_agentes` (seed idempotente de 22 agentes con códigos ESOP de la Res SRT 81/2019) + modelo de exposición puesto×agente `puesto_agentes` (FK compuestas Ring A), módulo `src/app/(app)/rar/` (T-143, #259, en prod). **La épica sigue ABIERTA**: Fase 2 (nómina de expuestos + planilla PDF + `rar_presentaciones`) y Fase 3 (vencimiento anual en el calendario) pendientes. Modelo en `docs/adr/0016-rar-modelo-datos.md`; detalle en `operativo.md`.

**Source of truth de tickets ejecutados**: `CLAUDE.md`.

**Convención forward**: cada ticket nuevo toma el siguiente number libre cronológicamente. NO reusar numbers ya ejecutados. Próximo libre: **T-077** (T-075 = link `informe_id`/IA de Accidentabilidad; T-076 = doc-sync `src/modules/` en `operativo.md`).

## Fase 1 · MVP cobrable (target: 6-8 semanas con foco)

### Sprint 0 · Setup del repo (semana 1, día 1-3)

Tickets base que dejan el repo listo para construir features.

- **T-001 · Inicializar Next.js 16 con TypeScript strict.** ✅
  Crear el proyecto, configurar `tsconfig`, instalar Tailwind, configurar shadcn/ui CLI, primer commit.

- **T-002 · Configurar ESLint + Prettier + Husky + commit hooks.** ✅
  Reglas de formato y linting. Pre-commit hook que corre `lint-staged`.

- **T-003 · Configurar Vitest y Playwright.** ✅
  Setup de tests unitarios y E2E. Test "hello world" pasando.

- **T-004 · Configurar GitHub Actions CI.** ✅
  Workflow que en cada PR corre typecheck + lint + test + build. Branch protection en main.

- **T-005 · Configurar Supabase local + remote.** ✅
  Crear proyecto en Supabase, instalar Supabase CLI, primera migration vacía aplicada en remoto.

- **T-006 · Setup del cliente Supabase + helpers para Server Components.** ✅
  `src/shared/supabase/server.ts`, `client.ts`, `middleware.ts`. Validación de env vars con Zod en `src/env.ts`.

- **T-007 · Configurar Sentry + estructura de logs.** ✅
  Sentry inicializado en server y client. Logger custom con niveles y contexto.

- **T-008 · Configurar Tailwind y shadcn/ui base.** ✅
  Theme oscuro tipo prototipo Fase 0. Primeros componentes (Button, Input, Form) instalados desde shadcn.

- **T-009 · Página landing minimalista + ruta `/login`.** ✅
  Landing con propuesta de valor + CTA → /signup. Form de login y signup funcional pero sin lógica todavía.

- **T-010 · Configurar Vercel deploy desde main.** ✅
  Cada merge en main triggea deploy. Variables de entorno cargadas. URL pública funcionando.

**Criterio de aceptación Sprint 0:** repo iniciado, CI verde, app en producción mostrando landing y formulario de login. Sin features funcionales todavía pero todo el plumbing listo.

---

### Sprint 1 · Auth + Tenancy + base multi-tenant (semana 1-2)

- **T-011 · Migration: Tenancy schema (consultoras, consultora_users).** ✅
  Aplicar schema de M2 con RLS policies. Tipos generados.

- **T-012 · Módulo Auth: signup con creación de consultora.** ✅
  El usuario se registra, se crea su consultora, queda logueado como admin. Email de bienvenida (con Resend).

- **T-013 · Módulo Auth: login + magic link.** ✅
  Login email/password. Magic link como alternativa.

- **T-014 · Módulo Auth: logout + recuperación de contraseña.** ✅

- **T-015 · Módulo Tenancy: getCurrentConsultora + helpers RLS.** ✅
  Funciones helper para todas las queries posteriores.

- **T-016 · Custom claim `consultora_id` en JWT.** ✅
  Auth Hook de Supabase que agrega el tenant_id al JWT al login.

- **T-017 · Layout autenticado `(app)` con guard.** ✅
  Layout que verifica sesión, muestra navegación lateral, dropdown de usuario.

- **T-018 · Test E2E: signup → login → logout flow.** ✅

**Criterio de aceptación Sprint 1:** un usuario puede registrarse creando su consultora, loguearse, ver una página vacía con su nombre, y desloguearse. Multi-tenancy garantizado por RLS, verificado con tests de integración.

---

### Sprint 2 · Auditoría + Notificaciones + Calendario (semana 2-3)

- **T-019 · Migration: audit_log + triggers append-only.** ✅ subsumed en T-011 real (tenancy.sql incluye audit_log + patrón triggers).
- **T-020 · Módulo Auditoría: appendAuditEntry.** ✅ subsumed (patrón audit triggers replicado en cada migration de dominio).
- **T-021 · Migration: notification_templates, preferences, queue, telegram_links.** ✅ ejecutado como T-031 real (notifications infrastructure migration).
- **T-022 · Módulo Notificaciones: dispatcher + adapter Email (Resend).** ✅ ejecutado como T-031 real (dispatcher + Email/Resend).
- **T-023 · Módulo Notificaciones: adapter Telegram con onboarding del bot.** ✅ ejecutado como T-033 real (Telegram bot + webhook + sender).
  Crear bot en BotFather, webhook handler, flujo de vinculación con código.
- **T-024 · Migration: calendar_events.** ✅ ejecutado como T-027 real (migration calendar_events + RLS + audit).
- **T-025 · Módulo Calendario: scheduleEvent + getUpcoming + getOverdue.** ✅ ejecutado como T-028 real (server actions CRUD + queries).
- **T-026 · Cron job: alertas de eventos próximos.** ✅ ejecutado como T-031 real (cron pg_net + process_pending_reminders).
  pg_cron que cada hora detecta eventos con `fecha_alerta <= now()` pendientes y dispara notificaciones.
- **T-027 · UI: panel "Próximos vencimientos" en dashboard.** ✅ ejecutado como T-030 real (UI agenda + dashboard panel "Próximos vencimientos").
- **T-028 · Tests integración: notificación end-to-end.** ✅ ejecutado como T-037 real (tests E2E + smoke productivo cierre Sprint 3).

**Criterio de aceptación Sprint 2:** un evento programado a 3 días dispara una notificación por email (y Telegram si vinculado). El usuario ve "vencimientos próximos" en su dashboard.

---

### Sprint 3 · Pagos + Plan Pro + trial (semana 3-4) ✅ EN PROD

- **T-039 · Migration: subscriptions, invoices, ai_usage_log.**
- **T-040 · Módulo Pagos: definición de planes y guard de acceso.**
- **T-041 · Integración Mercado Pago: setup de credenciales.**
- **T-042 · Flujo de suscripción: usuario elige Plan Pro → MP checkout → webhook.**
- **T-043 · Webhook handler con validación de firma.**
- **T-044 · Trial automático al signup (7 días o 5 informes).**
- **T-045 · UI: página `/facturacion` con plan actual e historial.**
- **T-046 · Tests E2E: trial expira → bloqueo de acceso a features pagas.**

**Criterio de aceptación Sprint 3:** un usuario puede activar Plan Pro pagando con MP. El trial expira y se bloquea acceso. Facturación visible.

---

### Sprint 4 · Informes core (semana 4-5) ✅ ejecutado

> El Sprint 4 original "Informes core" (planificado como T-037..T-050) se ejecutó **durante el Sprint 2 cronológico real** con numeración T-019..T-025 + T-036 y enfoque distinto: en lugar de un generador por norma específica (Ruido / Iluminación / Puesta a Tierra / RGRL / Carga de Fuego), se construyó un sistema **form-driven con 5 tipos genéricos** (relevamiento / capacitación / rgrl / accidente / otros) más template registry split server/client.
>
> **Mapping legacy → real:**
>
> - T-037 norm_templates + informes → ✅ subsumed en T-019 real (informes table, sin tabla `norm_templates` separada).
> - T-038 seed norm_templates → ❌ Fuera de MVP (number reusado por el propio ticket de cleanup del roadmap; ver `Estado del roadmap`).
> - T-039 cliente IA abstracto → ✅ ejecutado como T-020 real (singleton lazy Anthropic SDK).
> - T-040..T-044 generadores por norma → ✅ subsumed en T-021/T-022 reales (tipos genéricos en lugar de norma-específicos).
> - T-045 UI formulario dinámico → ✅ ejecutado como T-021/T-022 reales (template registry).
> - T-046 UI editor de prompt → ✅ ejecutado como T-020 real (EditorView con Claude streaming).
> - T-047 comparación de versiones (D06) → ❌ Fuera de MVP.
> - T-048 listado + detalle → ✅ ejecutado como T-019 real.
> - T-049 firmar + PDF → ✅ ejecutado como T-023 real (export PDF Puppeteer) + T-036 real (publish flow).
> - T-050 auto-renovación 12 meses al firmar → ✅ ejecutado como T-036 real (modal post-firma + recurrencia con parent_event_id).
>
> **Numbers T-037, T-039..T-050 ya consumidos por la planificación legacy.** Solo T-038 se reusó (este ticket de cleanup). Los numbers T-039..T-046 fueron **renumerados al Sprint 3 Pagos**; los numbers T-047..T-050 fueron **renumerados al Sprint 5 EPP**. Detalle ticket-por-ticket de los reales en `CLAUDE.md`.

**Criterio de aceptación Sprint 4:** ✅ cumplido — los 5 tipos de informe se generan con IA, se editan en markdown, se exportan a PDF con branding, se listan + detallan, y al publicar disparan modal de agenda con recurrencia.

---

### Sprint 5 · EPP core (semana 5-6)

- **T-047 · Migration: clientes, establecimientos, empleados, epp_items, epp_deliveries.**
- **T-048 · Seed de epp_items iniciales (catálogo común argentino).**
- **T-049 · Módulo EPP: CRUD de empleados + alta masiva por CSV.**
- **T-050 · UI: padrón de empleados por establecimiento.**
- **T-051 · Módulo EPP: registerDelivery + checkDuplicate.**
- **T-052 · UI: registro de entrega con firma digital en pantalla.**
  Captura de firma con canvas + storage en Supabase.
- **T-053 · Cálculo automático de `proxima_entrega_calc` y agendamiento.**
- **T-054 · Reporte mensual del padrón con estado por empleado.**
- **T-055 · Generación de planilla Resolución 299/11 PDF.**
- **T-056 · IA: sugerencia de EPP por puesto.**

**Criterio de aceptación Sprint 5:** un usuario puede dar de alta empleados, registrar entregas de EPP con firma, ver vencimientos próximos, exportar planilla 299/11.

---

### Sprint 6 · Checklists Lite + Incidentes (semana 6-7)

- **T-057 · Migration: checklist_templates, checklist_executions.** ✅ ejecutado (#193) — schema base (9 tablas + RLS system-aware/freeze + audit + seed RGRL de sistema), aplicado en prod.
- **T-058 · Módulo Checklists: CRUD de templates.** ✅ ejecutado (#194) — actions + RPCs clone/create + queries.
- **T-059 · UI: editor de checklist (items, criterios, requeridos).** ✅ ejecutado (#195) — editor con Dialogs + reorder ↑/↓ (RPC two-phase) + versionado + clone RGRL, en prod.
- **T-060 · Módulo Checklists: ejecutar checklist con firma.**
- **T-061 · UI: ejecución de checklist en mobile (responsive).**
- **T-062 · Módulo Accidentabilidad: libro de incidentes simple (sin IA).** ✅
- **T-063 · UI: alta/listado de incidentes.** ✅
  - **T-063-FU1 · Pulido UX libro de incidentes** ✅ — historial enriquecido (resalta los campos que cambiaron), filtro gravedad server-side, copy "víctima"/"involucrado" según tipo.
  - **T-063-FU2 · Ver anulados en el listado** ✅ DONE (#191) — toggle "incluir anulados" (calca `IncludeArchivedToggle` de `clientes`); vista `incidentes_heads` (head de cadena, anulados incluidos), badge "Anulado", toggle visible incluso en onboarding.
- **T-075 · Link `informe_id` incidente↔informe + botón "Generar investigación IA"** ✅ DONE (#191, en prod) — RPC `security definer` `link_informe_to_incidente` (UPDATE acotado a `informe_id`, audit `action='linked'`, append-only intacto); reusa `createInformeAction` con metadata pre-poblada desde el incidente + cliente/empleado; botón muta a "Ver informe" si ya está vinculado, deshabilitado sin cliente. Solo `tipo='accidente'`.

**Criterio de aceptación Sprint 6:** el usuario puede crear sus checklists, ejecutarlos firmados, registrar incidentes en un libro digital.

---

### Sprint 7 · Pulido y lanzamiento (semana 7-8)

- **T-064 · Branding personalizable del informe (logo, color).**
- **T-065 · Configuración de notificaciones por usuario (preferencias).**
- **T-066 · Páginas de error elegantes (404, 500, sesión expirada).**
- **T-067 · Onboarding interactivo en primer login.**
- **T-068 · Documentación pública de ayuda + FAQ.**
- **T-069 · Política de privacidad + términos de uso.**
- **T-070 · Tests E2E completos de los flujos críticos.**
- **T-071 · Auditoría de seguridad: revisar RLS policies con suite de tests.**
- **T-072 · Optimización Lighthouse > 90 en /, /login, /dashboard.**
- **T-073 · Tracking de usage por consultora (analytics interno).**
- **T-074 · Email de bienvenida + tour del producto.**

**Criterio de aceptación Fase 1:** producto completo, testeado, con docs, listo para vender. Primer cliente real puede arrancar.

---

## Fase 2 · Plan Team + coordinación de equipo (target: 4 semanas)

- Roles más finos (admin, consultor senior, consultor junior, asistente)
- Dashboard de coordinación: ver qué hizo cada técnico
- Asignación de visitas / informes a técnicos específicos
- Aprobación de informes antes de firma final
- Plan Team activable con upgrade desde Pro
- Branding por consultora más completo
- API básica para integraciones simples

## Fase 3 · PWA, permisos diarios, kit de jornada (target: 5 semanas)

- Convertir app en PWA instalable
- Service Worker con cache estratégico
- IndexedDB para datos offline
- BackgroundSync API para sync diferido
- Cámara nativa + GPS
- Módulo Permisos de Trabajo (altura, confinado, caliente, eléctrico)
- Módulo Catálogo de Tareas (kit de jornada inteligente)
- Captura de mediciones (viento con anemómetro)

## Fase 4 · Documentos + Capacitaciones + Accidentabilidad IA (target: 6 semanas)

- Módulo Documentos con OCR + búsqueda semántica con pgvector
- Q&A sobre manuales con RAG
- Módulo Capacitaciones con generador de material didáctico
- Módulo Accidentabilidad con análisis IA y jerarquía de controles
- Plan Enterprise activado con multi-establecimiento y API pública

## Fase 5+ · Avanzadas

- Asistente conversacional ("ChatHyS")
- Visión computacional para auditorías de planta
- Marketplace de checklists compartibles
- Integraciones (anemómetros Bluetooth, sistemas ART, contables)
- Whitelabel para consultoras grandes
- Internacionalización Chile / Uruguay / México

## Cómo trabajar con Claude Code

1. Abrir el repo en Claude Code.
2. Decir: *"Leé `CLAUDE.md` y los documentos en `docs/technical/`. Después arrancamos por T-001."*
3. Claude propone un plan para el ticket actual.
4. Validás, decís dale, Claude trabaja.
5. Reviewás el PR, mergeás, deploy automático.
6. Pasás al siguiente ticket.

Mantener disciplina: **un ticket por vez**. Más vale uno terminado por día que tres a medias.
