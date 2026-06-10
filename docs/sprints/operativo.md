# Operativo / Plataforma (transversal)

Tickets fuera del rango formal `T-001..T-078` del roadmap (`docs/technical/10-roadmap.md`), que tocan operaciones / branding / DX y no pertenecen a un módulo de negocio específico.

## T-079 ✅ Email templates de Supabase Auth con branding ConsultoraDemo

Doc operativo en `docs/operations/email-templates.md` con los 6 HTMLs (Confirm signup + Magic Link + Reset Password + Invite User + Change Email + Reauthentication) + paleta indigo (HEX, equivalentes a tokens `globals.css`) + tipografía system stack + dimensiones (600px container) + skeleton table-based + 2 nice-to-haves heredados (preheader text con `mso-hide: all` para Outlook + `<meta name="color-scheme" content="light">` para evitar inversión en Apple Mail iOS dark mode) + tabla de variables Supabase + compat matrix + instrucciones operativas (aplicar en dashboard, test plan manual, workarounds para variables no testables sin trigger real, rollback plan, migration path a Resend).

Templates aplicables via `Supabase Dashboard → Authentication → Email Templates`. Sin código en repo, sin migrations, sin tests automáticos — verificación es smoke manual disparando flow real desde `/signup`, `/login` magic, `/recuperar-password`. Subject `Confirm Your Signup` (inglés default Supabase) cambia a `Confirmá tu cuenta en ConsultoraDemo`.

URL VPS `consultora-demo.test-ia.cloud` reemplaza todas las menciones del `consultora-demo.vercel.app` deprecado desde T-022.5. SMTP queda en default Supabase para trial — evaluar Resend custom SMTP si el rate limit (~30 emails/h por proyecto free tier) se vuelve cuello de botella.

Cierra referencia circular pre-existente en `supabase/README.md` L161-167 (decía "wording final en el PR de T-012/T-013/T-014" y los PRs decían "wording final en supabase/README.md" — ahora ambos apuntan al doc operativo).

## T-052-FU2 ✅ Cierre lite — runbook escenario 2 + monitor Better Stack

Documentado el trigger secundario del incident T-052 (EasyPanel deploy via webhook resetea `endpoint-mode` → 502 hasta SSH manual). Decisión Lautaro 20/05/2026: NO investigar empíricamente ni automatizar stopgap por baja frecuencia esperada (1-2 deploys/sprint en esta fase, sin users productivos reales). Mitigación intermedia: monitor uptime free (Better Stack + alerta Telegram) detecta 502 > 5 min sostenidos, fix manual ~30s siguiendo runbook escenario 2. Setup operativo: `docs/operations/uptime-monitoring.md`. Decisión NO-auto-fix global (T-052-FU1) sigue vigente; el monitor sólo notifica, no toca el swarm. Reactivar T-052-FU2 full (investigación empírica + stopgap automatizado) si: >3 incidents/sprint, O 1 incident con 502 > 30 min, O llegan users productivos reales con SLA implícito.

## T-076 🔜 Doc-sync: drift `src/modules/` → `src/app/(app)/` (architecture + folder-structure)

`docs/technical/02-architecture.md` (L64, L424) y `04-folder-structure.md` (L55, 197, 201, 214, 245, 256, 290) describen la estructura vieja `src/modules/<nombre>/` con `index.ts`/`types.ts`/`README.md` por módulo. La realidad: módulos co-localizados en `src/app/(app)/<modulo>/` (`actions.ts` + `queries.ts` + `schema.ts` + componentes + subrutas `nuevo/`, `[id]/`). Es reescritura de arquitectura (no sync puntual) → ticket aparte. Alcance: realinear ambos docs + barrer referencias cruzadas. DevEx/doc, sin código.

(Number dentro del rango formal T-001..T-078: se ubica acá por ser DevEx/doc, no un módulo de negocio — coherente con el criterio de este archivo.)

## Seguros forward / Tech debt cross-modules

- **T-NOR (Normalización denormalized `consultora_id`)**: evaluar trigger BEFORE INSERT auto-populate `consultora_id` desde parent FK aplicado a TODAS las tablas con denormalización (`epp_entrega_items`, `empleados_puestos`, `informe_attachments`, `calendar_event_reminders`). **NO crear ahora** — emerge si:
  - Bug por olvido pasar `consultora_id` en algún server action nuevo.
  - O si la verbose del Insert pattern bloquea velocidad de desarrollo.

  **Decisión**: mantener convención explícita (TypeScript la enforce). Cleanup cross-modules en bloque, no parche puntual. Convención inicial documentada en T-100 (`docs/sprints/sprint-5.md` → Convenciones cerradas).

- **T-082-FU · Re-validar y corregir el runbook de Disaster Recovery** — ✅ DONE (mergeado #175, `91fe8d2`). **Corrección de estado:** el runbook T-082 (`docs/operations/disaster-recovery.md` + `scripts/backup-storage.ts` + `backup:storage`) **SÍ está en `main`** — se mergeó vía PR #104 (commit `9453de0`); la afirmación previa de "trabajo no mergeado / branch `feat/T-082-disaster-recovery` único respaldo" era **falsa** (verificado por git: `9453de0` toca los mismos 4 archivos que `6c6802e`). La branch vieja queda redundante; su borrado es cleanup aparte (post-merge). Re-validado contra la infra post-2026-05-18 (T-106/T-108/T-109/T-111) → **5 hallazgos**, todos de falsa-seguridad:
  - **(a) CRÍTICO** — Supabase Free NO tiene backups automáticos / PITR / restore por dashboard (confirmado T-111 F2). El runbook lo afirmaba en §1/§2/§5 y contaminaba §7/§8/§9/§10/Troubleshooting. **Fix:** §2 reescrito = backup manual real (`pnpm backup:db`, pg_dump → `backups/db/<ts>.sql`); §5 Escenario A = restore desde dump con `psql`, no dashboard.
  - **(b)** El restore selectivo choca los **triggers de inmutabilidad** (`audit_log`/`notification_log` bloquean UPDATE+DELETE; `billing_notifications_log` bloquea DELETE + UPDATE salvo `resend_email_id` NULL→non-NULL). **Fix:** nueva **§5.1** con el molde `DO` + `disable trigger user` (T-111 F2/F2b) + gotcha `session_replication_role` (no sirve en Supabase, 42501) + caveat `notification_digest_log` (append-only por UNIQUE, sin trigger).
  - **(c.1)** §4 secrets desactualizado vs `src/env.ts`: faltaban `MP_ACCESS_TOKEN`/`MP_WEBHOOK_SECRET` (billing/MP), `SENTRY_ORG`/`SENTRY_PROJECT`, `ARS_PRICE_MONTHLY`, `BILLING_GATE_DISABLED`, `ANTHROPIC_EPP_SUGGEST_MODEL`; naming `SENTRY_DSN`→`NEXT_PUBLIC_SENTRY_DSN`. T-109 NO sumó secret (reusa `INTERNAL_CRON_SECRET`). **Fix:** tabla §4 actualizada + nota "fuente de verdad = `env.ts`".
  - **(c.2) NUEVO** — `backup-storage.ts` respaldaba 2 de 3 buckets: faltaba **`epp-firmas`** (firmas legales Res 299/11) = pérdida de datos legal silenciosa. **Fix:** `STORAGE_BUCKETS` como fuente única en `types.ts` + el script itera sobre eso (ya no hardcodea) + mini-test anti-drift (`src/tests/unit/storage-buckets-coverage.test.ts`) que asserta `STORAGE_BUCKETS` === buckets de las migraciones (rompe si se olvida uno — demostrado en rojo/verde).
  - **Decisiones (owner):** P1 = backup DB manual real (`pnpm backup:db` pg_dump), NO upgrade a Pro (sin cliente pagando; §9 = camino futuro). P2 = fix `epp-firmas` dentro de este FU (es pérdida de datos legal, no va a follow-up) + el mini-test anti-drift.
  - **Estructura:** 3 commits (doc runbook / código / operativo.md). NO mergear sin OK del owner + CI verde.
  - **Estado de los follow-ups T-082** (disparadores detallados en `docs/operations/disaster-recovery.md` §Follow-ups abiertos):
    - **FU5** ✅ — doc-as-code anti-drift: test-meta `src/tests/unit/dr-config-coverage.test.ts` (alias `pnpm verify:dr-config`) valida §4 ↔ `src/env.ts` + scripts de backup + `.gitignore` + buckets contra el repo; corre en CI vía la unit suite.
    - **FU1–FU4 DORMIDOS** — NO son trabajo pendiente; se activan por disparador: FU1 → módulo operativo + olvido de correr el backup 2 meses seguidos; FU2 → 1er cliente pagando + Storage > 1GB; FU3 → upgrade a Supabase Pro; FU4 → 1er incidente donde el restore in-place sea overkill.

- **T-111 ✅ COMPLETO (F1 + F2 + F2b ejecutados 2026-05-31) · DEVEX: aislar integration tests (Supabase local efímero) + cleanup test data prod** (absorbe el ex-`T-DEVEX`). **Causa raíz**: `pnpm test:integration` corría all-at-once contra el Postgres prod-linked compartido → (a) fallas no determinísticas (RLS-claim collisions, fechas epoch por concurrencia) y (b) acumulación de ~14k consultoras de test en prod.
  - **F1 (aislamiento)**: `test:integration` ahora levanta un Supabase local efímero (`supabase start` + `db reset`) e inyecta sus keys (`scripts/test-integration-local.mjs`); cero cambios a la lógica de los tests (todo via `process.env`); `test:integration:remote` queda para debug puntual contra prod. Requiere Docker local. CI de integration (no corría) queda como follow-up.
  - **F2 (cleanup prod)**: borrado del test_set (identificación por EXCLUSIÓN: protegido = consultora con ≥1 member email ≠ @example.com; test = orphans con patrón + consultoras con members todos @example.com) vía bloque transaccional `DO` con `disable trigger user` + borrado explícito hijo→padre en orden topológico (Kahn dinámico sobre las FK; `session_replication_role='replica'` NO sirve en Supabase — `postgres` no es superuser → 42501; el cascade tampoco por las FK RESTRICT intra-dominio). Asserts pre/post (count del test_set, cero @gmail, cero huérfanos, restantes=5). **Backup**: Query B (dump JSON de los 5 reales, validado 1:1) + schema en git — Free NO tiene PITR ni backup automático; un full `pg_dump` habría respaldado solo basura (las 14k de test) → descartado. **Precondición cumplida**: E2E pausado (#161) congeló el universo en 14.484 (ver T-112). **EJECUTADO 2026-05-31** por Lautaro en el SQL editor (no el agente): **14.484 consultoras de test borradas, 5 restantes** (4 reales @gmail + "Debug"), reales intactos, bloque sin errores. **F2b** (`auth.users` de test): 5.811 users `@example.com`; el `delete` plano lo bloquea el trigger inmutable de `audit_log` (SET NULL sobre `actor_user_id`, 533 filas) + los audit AFTER de telegram/push en cascade → mismo molde `DO`+`disable trigger user`; cascadea `notification_channel_prefs`/`telegram_subscriptions`/`push_subscriptions` + `auth.*`; 4 @gmail intactos. **EJECUTADO 2026-05-31** por Lautaro: 5.811 `auth.users @example` borrados, 4 @gmail intactos, post-check 0/4/5 (0 @example, 4 @gmail, 5 consultoras). → **T-111 100% COMPLETO** (F1 aislamiento + F2 consultoras + F2b auth.users).
  - **Residuo detectado en T-114** (2026-06-04): 3 reminders EPP de test pre-T-111 (`created_at` desde 2026-05-22, anteriores a la migración T-100 → de `createCalendarEventAction`, no de la RPC EPP) sobrevivieron al cleanup. Benignos; purga opcional. No urge.

- **T-112 · DEVEX: aislar E2E (Playwright) de prod — Supabase efímero (sibling de T-111 F1)**. **Causa raíz**: el step `E2E tests` de `ci.yml` (job `ci`) corre Playwright contra la app buildeada con los secrets de prod, así que cada run crea consultoras de test en la DB prod-linked (~546 entre dos recounts de T-111 F2). F1 aisló los *integration*; los *E2E* siguen pegándole a prod. **Estado actual**: PAUSADO temporalmente (`if: false` en el step, T-111 F2) para congelar el universo antes del cleanup. **Solución permanente** (replicar el patrón F1 #158): levantar un Supabase local efímero (`supabase start` + `db reset`) + correr la app Next contra ese stack (Playwright `webServer` con las keys locales inyectadas), de modo que los E2E nunca toquen prod. Luego quitar el `if: false`. Considerar también un seed mínimo para los flows que hoy dependen de `admin.createUser`. **NO hacer durante T-111** — se registra para after-cleanup.

- **T-112 F1.2 + F1.3 ✅ Estabilización de la suite de integration (Supabase local, gate enforced)** (PR #166). Al aislar integration contra Supabase local (T-111 F1), `BILLING_GATE_DISABLED` cae al default `'false'` (gate enforced, igual que CI) → 15 archivos rojos. **F1.2** (12 archivos): tests que creaban su consultora fixture sin `trial_hasta` → `getBillingStatus` daba `TRIAL_EXPIRED` → toda acción/route gated (CREATE/EXPORT/GENERATE) cortaba con `BILLING_GATED`/402. Fix: helper compartido `src/tests/integration/helpers/consultora.ts` (`createTestConsultora`, trial vigente +30d por default) adoptado en los 12; incluye `informe-publish-action` (gate transitivo: `publishInformeAction` → `createCalendarEventAction`). **F1.3** (3 archivos residual, causa NO-gate): (1) `informes-rls` — expected del audit trigger sin `cliente_id` (T-050 lo sumó al payload) → +`cliente_id: null` ×4; (2) `billing-dunning-cron` — test 6 fecha por shift de TZ (ver BUG-PROD) + test 4 cleanup roto por AUD-001 (ver DEUDA-A) → consultora propia; (3) `billing-dunning-webhook` — acumulación cross-test por AUD-001 → queries scopeadas por `ref_id`. Job integration: **15 → 0**. Solo código de test; cero cambios a producción. Mergeado a `main` en `7f7f579` (squash, #166).

- **T-113 · Saneamiento post-T-112 (4 sub-tareas)** — se ejecutan como **PRs SEPARADOS** (NO un solo PR). Orden de prioridad:
  - **T-113a · F1.4 · estabilizar flaky `billing-actions-race`** — **ALTA** · ✅ DONE (#169, `a4edb05`, validado 5/5). Detalle ↓.
  - **T-113d · domar la flakiness SISTÉMICA de la suite integration** — **ALTA** · ✅ DONE (#173, `--no-file-parallelism` en integration, **5/5 verde**). Detalle ↓.
  - **T-113b · DEUDA-A · patrón DELETE-muerto en tests sobre tablas append-only** — **MEDIA** · ✅ DONE (#176, `68523dc`). 16 tests limpiados, ~22 deletes muertos removidos, guard test-meta agregado. Detalle ↓.
  - **T-113c · `retencion_datos_hasta` TZ** — **BAJA** · **DORMIDO** (latente, NO activo — nada que arreglar hoy; disparador: cableo del campo `retencion_datos_hasta`). Detalle ↓.

- **T-113a · F1.4 · Estabilizar flaky `billing-actions-race`** [ALTA] · ✅ **DONE** (#169, `a4edb05`). El test (`billing-actions-race.test.ts › createSubscriptionAction race condition`) asserteaba conteos fijos de llamadas a MP (`createPreapproval` 2× / `cancel` 1× + log "I1 race detected"), dependientes del interleaving de las 2 calls concurrentes → flapeó 1/6 (a veces la 2ª call corta en el pre-check `getActiveSubscription` sin pegarle a MP → 1× create, 0 cancel). **Fix (test-only)**: assertear el ESTADO FINAL determinístico (1 fila `pendiente_autorizacion` del winner + mismo `initPoint` para ambos clients + 1 ok / 1 DUPLICATE_SUBSCRIPTION_PENDING) + el invariante interleaving-agnóstico `cancel == create-1` y "el preapproval del winner nunca se cancela" (cero huérfanos en MP). Removido el assert del log (solo se emite en el path 23505, no en el pre-check). Sin `retries`. **Validado 5/5** (run 26753144490, attempts 1-5: `billing-actions-race` verde en las 5). Corrección del modelo: el loser **NO deja fila en DB** (el UNIQUE PARTIAL bloquea su INSERT); su huérfano es solo en MP.

- **T-113d · Domar la flakiness SISTÉMICA de la suite integration** [ALTA] · ✅ **DONE** (#173). **Causa raíz**: tests que procesan datos **globalmente** (sin scope a consultora) corriendo en **paralelo** (file-parallelism de vitest) contra la **misma DB local** → se pisan. Flakies del mismo molde: `billing-actions-race` (race de `createSubscriptionAction`, fixed en T-113a), `notifications-cron-rpc` (`process_pending_reminders()` limit 100/tick → `expected 100 to be 105`), la clase **dunning** (domada puntualmente en F1.3), y bajo serialización-1-proceso también `auth-callback` (exhaustión de conexiones). **Evaluación MEDIDA (A vs B):**
  - **Opción A (ELEGIDA)** — serializar integration. Probado en CI: `singleFork:true` (71 files en 1 proceso) → **3/3 ROJO** (`auth-callback` "createUser: fetch failed", exhaustión de conexiones). `fileParallelism:false` (serial, fork **fresco** por file) → **3/3 VERDE**. Costo: vitest 62.75s→86.29s (+23.5s); job integration ~3:44→~4:32 (+~45s) — **oculto bajo E2E** (~7:23, camino crítico del CI; los 3 jobs corren en paralelo) → **0 impacto en el wall-clock total del CI**.
  - **Opción B (DESCARTADA)** — scopear RPC globales por marker: toca **producción** (`process_pending_reminders` necesita param de consultora), ~7 archivos, whack-a-mole (no previene flakies futuros).
  - **Fix aplicado (config-only, cero prod)**: `--no-file-parallelism` SOLO en las invocaciones de integration (`scripts/test-integration-local.mjs` + script `test:integration:remote`), **NO** a nivel root → `unit`/`component` siguen en paralelo (confirmado: 525 tests, wall-clock 5.33s « acumulado). **Validado 5/5 verde** de la suite COMPLETA (run 26759726668, attempts 1-5, ~4:31 avg; cero flakies del molde) → **la clase de pollution murió**.

- **T-113b · DEUDA-A · Patrón `DELETE` muerto sobre tablas append-only en tests** [MEDIA] · ✅ **DONE** (#176, `68523dc`; detectado en F1.3). Tablas con trigger `BEFORE DELETE … RAISE EXCEPTION` (inmutables): `audit_log` (T-011), `notification_log` (T-031), `billing_notifications_log` (AUD-001, `20260524000002_audit_followup.sql`). Varios tests escritos ANTES del trigger respectivo limpian con `admin.from('<tabla>').delete()` → post-trigger ese DELETE lanza excepción que supabase-js devuelve en `{ error }` y el test no chequea → **no-op silencioso**. No fallan hoy porque (a) la DB efímera se resetea por run y (b) casi todos querean por `entity_id`/`ref_id` específico (no por conteo total). Deuda latente: si un test futuro comparte fixture y cuenta filas, falla como pasó en dunning. Candidatos con cleanup-delete sobre `audit_log` (verificar caso por caso que NO sea aserción de inmutabilidad intencional — `rls.test.ts`, `notification-log-rls.test.ts`, `audit-followup.test.ts` SÍ lo son): `epp-catalogo-actions`, `epp-entregas-actions`, `epp-entregas-queries`, `epp-empleado-timeline-queries`, `epp-padron-page`, `epp-pdf-route`, `epp-schema`, `epp-sugerir-route`, `epp-weekly-summary-cron`, `empleados-puestos-actions`, `empleados-puestos-queries`, `pagos-schema`, `push-subscriptions-rls`, `telegram-subscriptions-rls`. Sobre `billing_notifications_log`: los `afterAll` de `billing-dunning-cron`/`billing-dunning-webhook` (quedan tras F1.3, son no-op inofensivos). **Resuelto (T-113b)**: removidas ~22 sentencias `.delete()` muertas en 16 tests de integración; los 3 de aserción intencional (`rls.test.ts`, `notification-log-rls.test.ts`, `audit-followup.test.ts`) preservados; deletes reales conservados (incl. `notification_digest_log`, que NO tiene trigger de inmutabilidad). Agregado guard test-meta `src/tests/unit/append-only-delete-guard.test.ts` (tier unit, sin DB): prohíbe el patrón fuera de la allowlist de los 3 intencionales + 2º test anti-pudrición; demo red→green validada. CI 4/4 verde (Integration determinístico corrió los 16 archivos tocados → prueba de que solo se removió código muerto). **NO se tocaron triggers ni producción** — la inmutabilidad es invariante de producto. **DEUDA-A cerrada.**

- **T-113c · `retencion_datos_hasta` — bug de TZ LATENTE (NO activo)** [BAJA] (detectado en F1.3; re-diagnosticado). **El campo nunca se escribe en prod**: la columna `consultoras.retencion_datos_hasta` existe desde T-070 (`20260520000001_t070_pagos_schema.sql:32`, nullable sin default) y los crons de dunning la **leen** (`billing-notifications/route.ts`, `billing-dunning-recovery/route.ts`) pero **ningún flujo le hace `insert`/`update`** → siempre `null` → el email "trial expired" no muestra fecha de retención. El bug de TZ es **latente**: `formatDateAR` (`Intl.DateTimeFormat` timeZone `America/Argentina/Buenos_Aires` = UTC-3, `src/shared/lib/format-date.ts`) sobre un valor medianoche-UTC renderiza el **día anterior** (30/06 00:00Z → 29/06 21:00 AR → "29/06/2026"), pero como hoy no hay write, no se manifiesta. **NADA que arreglar hoy.** Cuando se implemente el seteo del campo: guardarlo **date-only** o a **mediodía UTC** para evitar el shift. (En F1.3, el test `billing-dunning-cron` test 6 pasaba el valor a mano → se fijó a mediodía UTC.)

- **Required checks (branch protection, forward)** — al configurar branch protection en `main`, los **3 jobs pueden ir `required`**: `CI` (build), `e2e-tests`, **y `integration-tests`**. El bloqueador de integration quedó **resuelto**: F1.4 en T-113a (`a4edb05`) + la flakiness sistémica en **T-113d** (#173, `--no-file-parallelism` → 5/5 verde, clase de pollution muerta). Ya no hay flake conocido que bloquee merges legítimos al azar.

## T-114 ✅ Fix: `gen_epp_planificaciones_y_calendar_for` no crea `calendar_event_reminders` (vencimientos EPP no notifican en prod) [ALTA] — EN PROD

**Detectado en T-057** (al calcar la maquinaria del Calendario para `gen_acciones_calendar_for`). La RPC EPP `gen_epp_planificaciones_y_calendar_for` (T-100, `20260523000001_t100_epp_schema.sql`) inserta el `calendar_event` con `reminder_offsets_days = array[14,3,0]` **pero NO inserta ninguna fila en `calendar_event_reminders`**. El cron `process_pending_reminders()` (`20260515095701_notifications_infrastructure.sql`) escanea `calendar_event_reminders WHERE status='pending' AND scheduled_at <= now()` → como no hay filas, **nunca dispara** → **los vencimientos de planificación EPP (renovación 6m, Res SRT 299/11) no generan ninguna notificación Resend/Telegram/Push en prod**. El array `reminder_offsets_days` queda como metadato muerto en el evento.

Contraste: el path TS `createCalendarEventAction` SÍ crea los reminders (vía `computeReminderRows` + insert service-role), por eso los vencimientos creados por formulario (protocolo/RGRL/custom) sí notifican; solo los generados por la **RPC EPP** quedan mudos.

**Fix:** replicar en la RPC EPP el mismo bloque que `gen_acciones_calendar_for` agregó en T-057 (`20260603000001_t057_checklists.sql`): por cada offset, `INSERT INTO calendar_event_reminders (event_id, consultora_id, offset_days, scheduled_at, status)` con `scheduled_at = (fecha_proxima − offset días) a las 12:00 UTC` (= 09:00 ART, espejo de `computeScheduledAtUtc`), omitiendo los que caen en el pasado, `ON CONFLICT (event_id, offset_days) DO NOTHING`. **Prioridad ALTA**: afecta notificaciones reales de un módulo ya en prod. **Verificación**: integration test que cierre una entrega EPP con item no-descartable y asserte que se crearon las filas de `calendar_event_reminders` (hoy faltaría — agregar). Considerar backfill de los eventos EPP ya existentes en prod sin reminders.

**Resuelto #204** (squash `87fb22b`, 2026-06-04). Migración `20260604000002`: redefinición de la RPC (patrón T-057, replica `computeReminderRows` — 12:00 UTC, omite pasado, `ON CONFLICT`) + backfill idempotente. red→green ejecutado en CI (run rojo → verde). `db push`: backfill 45 reminders. Verificación post: `huerfanos_futuros=0`. Smoke OK.

## T-115 🔜 Hardening: envolver `requireBillingAccess` en try/catch en los módulos que no lo hacen [MEDIA]

**Detectado en T-058.** `requireBillingAccess` (`src/shared/billing/access.ts`) llama a `getActiveSubscription` (`settings/billing/queries.ts`), que **tira** (`throw new Error(...)`) ante cualquier error de la query de suscripción. A diferencia de `getCurrentConsultora` (devuelve `null`, nunca tira), un fallo transitorio de DB en el billing-gate se propaga como un **reject sin manejar** de la Server Action → 500 en vez de un error de dominio limpio.

El preámbulo de **checklists** (T-058) ya lo envuelve en try/catch → `INTERNAL_ERROR` (ver `requireOwnerWithBilling` en `src/app/(app)/checklists/actions.ts`). Los módulos pre-T-058 que invocan `requireBillingAccess` **sin** try/catch siguen expuestos: `clientes/actions.ts`, `accidentabilidad/actions.ts`, y cualquier otro CREATE/EXPORT/GENERATE gateado (grep `requireBillingAccess`). **Fix:** envolver la llamada en cada módulo (o, mejor, extraer un helper compartido `requireOwnerWithBilling` / `requireBillingAccessSafe` que ya devuelva el discriminated-union failure `INTERNAL_ERROR`, y migrar los call-sites). **No se tocó en T-058** (sería scope creep cross-module). **Verificación**: unit test que mockee `getActiveSubscription` para tirar y asserte que la action devuelve `INTERNAL_ERROR` en vez de propagar.

> **Avance parcial (T-060a):** ya existe el helper compartido `src/shared/auth/with-billing.ts` (`requireMemberWithBilling` + `requireOwnerWithBilling`, billing en try/catch), usado por el módulo de ejecuciones de checklists. Falta migrar los call-sites pre-T-058 (`clientes`, `accidentabilidad`, …) a este helper.

## T-060c 🔜 RPC atómica `close_checklist_execution` (flip + CAPA + gen_acciones en una tx) [BAJA — opcional]

**Detectado en T-060b** (Enfoque 1, opción A). `cerrarEjecucionAction` inserta las CAPAs + invoca `gen_acciones_calendar_for` **antes** del flip a `cerrada` (último paso, CAS `.eq('estado','borrador')`). Eso garantiza que una ejecución `cerrada` SIEMPRE tenga sus CAPAs (el INSERT de CAPAs es fatal/pre-flip) y, en el happy path, sus eventos. Dos residuales conocidos, ambos de probabilidad ≈0 y auto-corregibles en reintento (la ejecución sigue `borrador` ante cualquier fallo pre-flip → todo re-corre idempotente):

- Si `gen_acciones_calendar_for` falla (es **no-fatal**, patrón EPP T-102 `planificacionWarning`), la ejecución queda `cerrada` con CAPAs pero **sin** `calendar_events`/reminders → se devuelve `calendarWarning`; NO se auto-regenera vía la action (re-cerrar da `ALREADY_CLOSED`). Mismo gap de "regenerar calendario post-cierre" que T-114 deja latente en EPP.
- Si el flip falla **persistentemente** tras CAPA+gen OK, queda un *borrador* con eventos vivos (alertas espurias) hasta el reintento.

**Fix (opcional):** RPC `security definer` `close_checklist_execution(...)` que haga INSERT de CAPAs + `gen_acciones_calendar_for` + UPDATE `estado='cerrada'` en **una sola transacción** (todo-o-nada) → elimina ambos residuales. **Requiere migración + `pnpm db:types`** (Docker para regenerar `types.ts`). No se hizo en T-060b porque (a) la opción A ya satisface la invariante "cerrada ⇒ con CAPAs", (b) sin Docker no se puede regenerar `types.ts` → el gate `db:types` fallaría. **Prioridad BAJA**: solo si los residuales molestan en prod.

## T-061-FU1 ✅ Ver inspecciones anuladas (toggle en el listado) — EN PROD

Mergeado #202 (`5fc7598`); la migración se aplicó a prod **antes** del merge (`db push --linked` diff-validado: única pendiente `20260604000001`). Calca el patrón de incidentes T-063-FU2.

- **Migración** `20260604000001_t061fu1_checklist_executions_heads_view.sql`: vista `checklist_executions_heads` (`security_invoker`, head de cada cadena SIN filtrar anulación = vigentes + tombstones) + `checklist_executions_vigentes` REDEFINIDA sobre heads (`create or replace`, single-source del `NOT EXISTS`) + 2 `grant select`. Read-only; no toca tabla/policies.
- **Query**: `getEjecucionesForConsultora(sb, { includeAnuladas })` switchea la fuente heads↔vigentes (mismo molde que `getIncidentes`).
- **UI**: toggle "Ver anuladas" (`EjecucionesAnuladasToggle`, push `?anuladas=1`) renderizado SIEMPRE (incluso en onboarding, así un tenant cuya única inspección fue anulada puede revelarla); `EjecucionesList` muestra el estado `anulada` (badge + subtítulo). El toggle cuenta en `hasActiveFilters` → no dispara el empty-state por sí solo.
- **Link fix (clave)**: las filas anuladas linkean al **original** (`corrige_id`), NO al tombstone vacío — ver lesson "tombstone vacío" en lessons-learned. El detalle del original (T-061b) ya renderiza todo + banner "anulada" (tiene hijo tombstone → `esVigente=false`).
- **types.ts**: hand-edit (sin Docker local; `db:types` usa `--linked`=prod, que aún no tenía la migración) — nueva view entry `checklist_executions_heads` + ref `_heads` en los 6 FK arrays (`corrige_id` ×3 relaciones, `execution_id` ×4 hijas). Validado por el **gate de drift de CI** (`gen types --local` + `git diff`).
- **Tests**: unit `ejecuciones-queries.test.ts` (source switching) + integration tests 13-14 (heads incluye anuladas / vigentes las excluye / RLS cross-tenant).

## Checklists · follow-ups abiertos (post T-061b/FU1) [BAJA]

Dos guardas no urgentes (no alcanzables por la UI hoy, pero blindan el modelo de anulación):

- **Guard redirect tombstone→original en `[id]/page.tsx`**: el acceso por URL directa al `tombstone.id` (`anulacion=true`) carga el detalle del tombstone vacío (sin respuestas/firma). Fix: si `basics.anulacion && basics.corrige_id` → `redirect(corrige_id)`. Requiere ampliar `getEjecucionBasics` con `anulacion` + `corrige_id` (hoy no los selecciona). La UI ya no expone el `tombstone.id` (lo cierra el link fix de FU1) → es defensa de borde.
- **`anularEjecucionAction` valide `estado='cerrada'`**: hoy solo rechaza `estado='anulada'` (`ALREADY_ANULLED`) → un **borrador** se puede anular vía backend y el original queda `estado='borrador'` (técnicamente editable, y `/[id]` cae en el runner en vez del detalle con banner). No alcanzable por la UI (el CTA de anular vive solo en el detalle de una cerrada). Fix: rechazar todo `estado !== 'cerrada'` en la action.

## T-116 ✅ Flaky `ClienteForm > DUPLICATE_CUIT` — `asyncUtilTimeout` global (project component) — EN MAIN

Mergeado #201 (`215dc7b`). Flaky pre-existente intermitente: el `waitFor`/`findBy` default de testing-library (1000ms) vencía bajo contención de CPU al correr los 94 archivos del project `component` en paralelo (cadenas RHF+Zod async, p.ej. `ClienteForm` DUPLICATE_CUIT) → fallaba ~1/N runs, verde en aislamiento. **NO** era state pollution (projects `unit`/`component` aislados, `isolate=true`, `setup.ts` trivial) ni de T-061-FU1 (su test es project `unit`, pool aparte). **Fix** (1 archivo): `configure({ asyncUtilTimeout: 5000 })` en `src/tests/setup.ts` (lo carga solo el project component → no afecta unit/integration); sube el techo de TODOS los async utils, los que ya pasaban resuelven al primer intento. **Verificado 5/5 corridas verdes** de la suite completa; el test resuelve en ~400ms. Sin migración.

## T-117 ✅ Asistente IA contextual de EPP (Haiku + tool-calling) — EN PROD

#206 (squash `ba13745`). Módulo `asistente` (`/asistente`, `/api/asistente`). 4 tools sólo-lectura mapeadas 1:1 a queries RLS-aware existentes (`buscar_empleado`, `epp_entregado_a_empleado`, `vencimientos_epp_de_empleado`, `vencimientos_epp_proximos`). Loop multi-turno `tool_choice:auto`, caps (5 iter / 1024 tok / rate-limit 15 min), gateado con `requireMemberWithBilling` (T-115-safe). Cero-DB. Modelo Haiku (env override).

## T-117-FU1 ✅ Robustez del asistente: búsqueda multi-término + fecha en prompt + reintento — EN PROD

#207 (squash `d0cbb79`). `searchEmpleadosForChat` (multi-término AND + accent-insensitive en JS, sin tocar `searchEmpleadosByNombre`); fecha de hoy (TZ AR) inyectada al system prompt; guía de reintento. Cero-DB. Pendiente dormido **T-117-FU2**: ventana de `vencimientos_epp_proximos` configurable (hoy fija 30 días).

## T-119 ✅ Lifecycle de planificaciones EPP: cerrar al reentregar + unicidad + backfill — EN PROD

#208 (squash `1fb740d`). Migración `20260604000003`: la RPC cierra la planif activa previa del mismo `(empleado, item)` al reentregar (dedup por `item_id`, evento→`completed`, reminders skipped) + unique parcial `uq_epp_planif_activa_empleado_item` + backfill. `db push`: 6 planif cerradas, 6 eventos completados; 16→10 activas, 0 duplicados. Smoke OK (lista Roveda limpia).

## T-118 ✅ Sincronización calendario → dominio (trigger AFTER UPDATE) — EN PROD

#209 (squash `bcf8e43`). Migración `20260604000004`: trigger `sync_calendar_event_to_origin` propaga `fecha` + `status` del evento al dominio (`epp_planificaciones` / `acciones_correctivas`) con `WHEN` clause + escritura separada fecha/status + guarda de idempotencia (no-op vs T-119) + backfill solo-fecha. `db push`: 2 planif re-sincronizadas (incluido el Guantes de Roveda 24/11→13/06), 0 desincronizadas. Smoke OK (mover fecha en calendario → reflejado en chat/ficha al instante).

## T-120 ✅ Lifecycle de CAPAs (`acciones_correctivas`): resolución con evidencia — EN PROD

#212 (squash `7884f70`). Cero-DB. `resolverCapaAction` (member, patrón CAPA-primero: flip a `'cerrada'` vía RLS con el cliente user-scoped + evento→`completed`/reminders skipped con service-role; no-conflicto con el trigger T-118) + `CapaResolverButton` (cierre con evidencia desde la ficha de inspección) + fix `CAPA_ESTADO_LABELS`. Cierra la clase B-CAPAs de ADR-0015 (T-119 cerró B-EPP; T-118 ya permitía cerrarla completando el evento desde el calendario — T-120 es el cierre CON evidencia).

## T-121 ✅ Coherencia `consultora_id` denormalizado (FK compuestas Ring A) + `audit_consultoras` — EN PROD

#215 (squash `1d2a7db`). Migraciones `20260605000004` (9 `unique (id, consultora_id)` en los parents + 17 FK COMPUESTAS `hijo.(<fk>, consultora_id) → parent.(id, consultora_id)` que reemplazan los FK simples preservando el `ON DELETE`; drop dinámico del `conname` real desde `pg_constraint`, aborta si no lo encuentra; guard pre-conteo fail-fast) + `20260605000005` (`audit_consultoras()` AFTER INSERT/UPDATE → `audit_log`, molde `audit_calendar_events`, SIN rama DELETE porque el hard-delete de consultoras es imposible — `audit_log` ON DELETE RESTRICT + inmutable). Guard 0 mismatches / 328 filas escaneadas. Cierra la clase D-RingA de ADR-0015. Alcance Ring A core: ownership NOT-NULL, ambos lados `consultora_id NOT NULL` (cero gaps de `MATCH SIMPLE`); Ring B/C → T-121-FU dormido.

## T-122 ✅ Sync `consultoras.plan` ↔ suscripciones (trigger) + backfill — EN PROD

#211 (squash `84b3ddc`). Migración `20260605000001`: trigger `sync_consultora_plan_from_suscripcion` (`AFTER INSERT OR UPDATE OF estado` en `suscripciones`) recomputa `consultoras.plan`/`trial_hasta` vía `EXISTS` sobre el estado VIGENTE de la consultora (suscripción en `activa`/`morosa`/`cancelada` → `plan='pro'` + `trial_hasta=NULL`; resto → `trial`), guard `is distinct from` idempotente + backfill promote-only + comments corregidos. Fuente única (ADR-0015 clase A en billing, misma forma que T-118). Cierra el drift del cache `plan` (una consultora que pagaba quedaba `trial` para siempre → badge del sidebar miente + dunning espurio). Backfill prod 0 (sin pagos reales todavía).

## T-123 ✅ Trigger skip reminders al finalizar evento (backstop estructural) — EN PROD

#213 (squash `2e5acda`). Migración `20260605000002`: trigger `skip_reminders_on_event_final` (`AFTER UPDATE OF status`, `WHEN old.status='pending' AND new.status IN ('completed','cancelled')`) skipea los reminders `pending` del evento al finalizarlo — fuente ESTRUCTURAL del skip, cubre todo camino (action/RPC/SQL directo/futuro). `security definer` (los reminders tienen UPDATE default-deny para authenticated). Como corre ANTES del skip explícito de `complete/cancelCalendarEventAction`, ese skip veía 0 filas → se quitó el `remindersSkipped` (count muerto post-trigger, no usado por la UI). Los otros 3 skips explícitos (anularEjecucion, resolverCapa T-120, RPC T-119) quedan redundantes inofensivos (idempotentes, sin count asertado). No-conflicto con T-118 (tablas disjuntas). Backfill 0.

## T-124 ✅ Churn reaper + cierra leak gate `cancelada` + limpieza enums muertos — EN PROD

#214 (squash `bca1ce8`). Migración `20260605000003` + fix de gate (`src/shared/billing/access.ts`). **Reaper** `process_subscription_churn()` (cron diario `0 3 * * *`, SQL puro) flipa una `cancelada`-vencida (`cancelar_en NULL` = churn MP por falta de pago, o `cancelar_en < now()` = gracia vencida) → `expirada`; el UPDATE dispara T-122 → recomputa `consultoras.plan='trial'`. **Gate fix** cierra el LEAK real: una `cancelada` con `cancelar_en NULL` caía a `ok:true` → ahora `if (!cancelarEn || cancelarEn < now)` bloquea (`SUBSCRIPTION_CANCELLED`); el test del leak se invirtió a `ok:false`. **Enums**: `calendar_event_reminders.status='failed'` REMOVido del CHECK (nunca se escribía; el fallo vive en `notification_log`) + espejo TS `REMINDER_STATUS_VALUES`; `estado_suscripcion` (`expirada` activado por el reaper, `trial` reservado) e `informes.status='archived'` (soft-delete diseñado-no-implementado, KEEP) redocumentados. Backfill 0.

## T-117-FU3 ✅ Asistente: streaming SSE + render markdown + tests del cliente — EN PROD

#217 (squash `511049f`). El chat del asistente pasa a **Server-Sent Events**: orquestador `streamEppChat` (`src/shared/ai/epp-chat-stream.ts`) emite eventos `delta` (token a token) / `tool` (nombre de la tool en curso) / `stop` / `usage` / `error` / `done`; encode en `src/shared/ai/sse-encode.ts`, parser isomórfico `src/shared/ai/sse-client.ts`. Los errores **post-200** (rate-limit, timeout, refusal, abort) viajan como evento SSE `error`, nunca HTTP 5xx. Render **markdown** en el cliente con `react-markdown` + `remarkGfm` + `rehype-sanitize` (`src/shared/ui/markdown.tsx`, sanitiza `<script>`/`on*`/`javascript:`). Cliente (`asistente-client.tsx`): throttle de re-render por `requestAnimationFrame` + fallback 250ms para tabs en background, botón "detener" vía `AbortController`. **Tests del cliente**: `src/tests/unit/ai-sse-client.test.ts` (fragmentación / CRLF / unicode) + `markdown.test.tsx` (bold/listas/tablas/sanitización). Cierra el pendiente "render markdown en el chat" que figuraba en CLAUDE.md.

## T-125 ✅ Asistente multi-módulo: registry de tools + Checklists/Inspecciones — EN PROD

#218 (squash `06a1a5f`). Reemplaza el `switch(name)` por un **registry** `Map<string, ToolEntry>` (`src/shared/ai/tools/registry.ts`) ensamblado de listas por módulo (`epp-tools.ts` + `common-tools.ts` + `checklists-tools.ts`); `dispatchTool()` hace lookup O(1) y **nunca tira** (envuelve todo error en `DispatchToolResult`). **Guardia anti-duplicados** al cargar el módulo: `if (TOOL_REGISTRY.size !== ALL_ENTRIES.length) throw`. Tools nuevas (read-only, RLS-aware): `buscar_cliente` (common) + `listar_inspecciones` / `inspeccion_detalle` / `capas_pendientes` (Checklists). Query nueva `getCapasForConsultora` en `src/app/(app)/checklists/ejecuciones/queries.ts`. System prompt ampliado a EPP + inspecciones + CAPAs. Cero-DB.

## T-126 ✅ Persistencia del chat del asistente (conversaciones + RLS) — EN PROD

#219 (squash `c620701`). Migración `20260606000001_t126_chat_persistence.sql`: tablas `chat_conversaciones` + `chat_mensajes` (detalle en `docs/technical/03-data-model.md` → "Asistente IA · chat"). **Persistencia client-driven (Option C)**: la route SSE (`/api/asistente`) **NO escribe** en DB — el cliente persiste el turno que mostró vía `persistChatTurnAction` (crea la conversación si `conversacionId=null`, inserta user+assistant en un statement → `seq` consecutivo; título derivado del 1er mensaje ≤80c) → route/orquestador intactos. UI de historial: sidebar `ConversacionList` + selección por `?c=<id>` + archivar (`archiveChatConversacionAction`, soft-delete `archived_at`). **RLS per-user** (`user_id = auth.uid()` + `is_member_of_consultora`): dos members de la misma consultora NO se ven los chats entre sí. Tests: `persist-chat-turn-action.test.ts` + `chat-persistence-rls.test.ts`. **Orden de deploy**: la migración se aplicó (`db push`) ANTES del merge (el código depende de las tablas) — gate migración-primero.

> **Notas operativas (T-126):**
> - **Integration NO contra prod (linked)** — durante T-126 la suite de integration se corrió contra el linked (=prod) y dejó consultoras orphan inertes, imborrables por el `audit_log` RESTRICT. Reincidente de la lección T-111: integration va a CI (Supabase local efímero) o local con Docker, **nunca** al linked. Ya hay memoria del tema.
> - **Mount Windows→sandbox** — una branch nueva sin commits propios (HEAD==main) se ve desde el sandbox del orquestador como "No commits yet / todo A". Es vista del mount, no corrupción del repo.

## T-127 Tanda 1 ✅ Responsive de primitivos compartidos — EN MAIN

#220 (squash `9916f50`). Patrón híbrido **`h-11 md:pointer-fine:h-9`** en los primitivos compartidos (44px táctil en mobile/touch / compacto en desktop+mouse) + `size="none"` en Button para esquivar el **footgun de tailwind-merge** (el merge "se comía" la altura híbrida) + Dialog/AlertDialog con `max-h` + scroll interno. Solo CSS/clases, sin lógica. **Tandas 2-6 + FUs ✅ EN PROD** (ver abajo); queda **T7 (pulido)**.

## T-117-FU2 🔜 DORMIDO

Ventana de `vencimientos_epp_proximos` configurable (hoy fija en 30 días). Disparador: pedido de producto / primer cliente que la necesite distinta.

## T-121-FU 🔜 DORMIDO

Coherencia Ring B (FK nullable / `SET NULL` / self-ref) + Ring C (template tree / system rows con `consultora_id NULL`, donde `MATCH SIMPLE` NO garantiza la igualdad — un NULL en la columna compuesta pasa el check). Censo completo en el plan de T-121. Disparador: antes de exponer API pública / multi-instancia.

## Flaky E2E 🔜

Estabilizar `checklists-ejecuciones.spec.ts:100` (`EXEC_NOT_DRAFT`, race entre el click "No cumple" y el toast). Flaky conocido, rescatado por retry ("1 flaky" en main); guardado en memoria como known-flake. Re-correr el job antes de investigar si E2E sale rojo solo por este test.

## doc-drift 🔜

`docs/technical/03-data-model.md` stale: menciona la tabla `establecimientos` fantasma (dropeada en T-052) y policies pre-T-015 (subqueries inline a `consultora_members` en vez de los helpers). Sync pendiente (sibling de T-076). _En este doc-sync solo se AGREGÓ la sección "Asistente IA · chat" (T-126); la staleness vieja sigue pendiente._

## T-127 Tandas 2-6 + FUs ✅ Responsive — EN PROD

Continuación del responsive (Tanda 1 ✅ cerró los primitivos). Tandas 2-6 + follow-ups, todas en prod:

- **T2 · tablas→cards** (#222, squash `0c26fae`): dual-render `hidden md:block` (tabla en desktop) / `md:hidden` (stack de cards en mobile) en el padrón EPP (`epp/padron`) + `EntregaDetailView`.
- **T2 FU1 · header entrega** (#223, squash `6ca9f8f`): `flex-wrap` en la barra de acciones del detalle de entrega para que wrappee en mobile (~375px).
- **T4 · barras de acción de forms** (#224, squash `b6c6cf1`): `flex flex-col-reverse gap-2 sm:flex-row sm:justify-end` (primario arriba en mobile) en 7 forms (Incidente · TemplateMeta · Cliente · Empleado · Categoria · Item · Puesto).
- **T3/T5/T6 + resto-T4** (#225, squash `9a3de8f`): T3 `TabsNav` con `overflow-x` (Calendar/Cliente/Epp/Catalogo/Settings) + hamburguesa en la landing (`LandingMobileNav` + `LandingHeader`) · T5 scroll-x del calendario del mes (`CalendarMonthView`) · T6 chat `min-w-0` + `break-words` (burbujas del asistente) · resto-T4 wizard de entrega (`EntregaWizard`/`EntregaItemsBuilder`: grids `sm:grid-cols-2` + de-anidar Card + barra responsive).
- **FU smoke** (#226, squash `a7ad767`): `SelectTrigger w-full` + dashboard con los 9 módulos en `QUICK_LINKS` + badge trial `pr-12 md:pr-4` (esquiva la X del Sheet).
- **T4 FU2 · select min-w-0** (#227, squash `dd4d377`): `SelectTrigger min-w-0` — el `w-full` solo no alcanzaba; `min-w-0` es el que deja truncar selects con valor largo en grid/flex.

## T-128 ✅ Selector de puesto del catálogo en el form de empleado (+ crear inline) — EN PROD

El campo "Puesto" del form de empleado pasó de texto libre a **selector del catálogo** (`puesto_id` → `empleados_puestos`), single, opcional, con búsqueda (combobox Popover+Input estilo `ClienteAutocomplete`, sin cmdk) + "crear puesto nuevo" inline (solo owners, reusa `createPuestoAction`).

- **Sincronía-puente**: la action sigue escribiendo el nombre del puesto en la columna legacy `empleados.puesto`, atómico dentro del INSERT/UPDATE; el join `empleados_puestos` es el único write separado, con éxito-y-warning (sin RPC: `empleados` no tiene policy DELETE → no hay compensación posible).
- **Edición**: espejo single, read-only si el empleado tiene ≥2 puestos (la ficha es la fuente de la gestión multi); re-check server-side defensivo.
- Sin migración SQL. PR #231.

## T-129 fase A ✅ Migrar consumers de `puesto` al catálogo + backfill — EN PROD

Consumers cortados del legacy `empleados.puesto` → catálogo, vía helper `getEmpleadoPuestosLabel` (nombres del catálogo concatenados, excluye archivados, `null` si no hay): informe de accidente (`puesto_afectado`), planilla Res 299/11 (`puestos_label`), asistente `buscar_empleado` (ya no expone puesto), detalle (sin Field "Puesto") + list card. `EmpleadoSummary` + las 3 búsquedas sin `puesto`.

- **Migración `20260608000001`**: función `backfill_empleados_puestos_from_legacy(p_consultora_id)` idempotente, best-effort, `security definer`, `service_role`. `db push` a prod ejecutado como gate (diff validado por el orquestador): **no-op verificado** (a_migrar 0→0, asignaciones/puestos 4→4; los empleados con puesto texto ya estaban asignados desde T-128).
- **Decisiones de producto**: concatenar nombres; quitar puesto de búsquedas/autocompletes/asistente; migrar datos best-effort.
- **Fase B** ✅ (hecha — ver entrada **T-129 fase B** abajo): dropeó `empleados.puesto` + la función backfill + el puente de `empleados/actions.ts` (#234). PR #232 (fase A), merge `049cd26`.

## T-129 fase B ✅ Drop de la columna legacy `puesto` + función backfill + puente — EN PROD

Cierre del hilo "campo Puesto": se eliminó el legacy `empleados.puesto` ahora que los consumers leen del catálogo (T-129 fase A). **Migración `20260608000002_t129_fase_b_drop_puesto.sql`** en una sola transacción y en este orden: (1) `CREATE OR REPLACE FUNCTION audit_empleados()` **sin** `puesto` — el trigger de auditoría referenciaba `new.puesto`/`old.puesto` en el diff-guard y en los payloads `before_data`/`after_data`, y Postgres NO lo trackea como dependencia del `DROP COLUMN`, así que recrearlo en la misma tx y **antes** del drop es obligatorio (si no, la próxima escritura tira `record "new" has no field puesto`); (2) `DROP COLUMN empleados.puesto`; (3) `DROP FUNCTION backfill_empleados_puestos_from_legacy`. `types.ts` editado **a mano** (quirúrgico, sin `db:types --linked` para no despertar el skew PostgREST). Se quitó el puente de escritura de `empleados/actions.ts` y se actualizaron los tests que asertaban el puente.

- **Orden invertido respecto del `db push` habitual** (que es migración-primero cuando el código depende del objeto nuevo): acá el código sin puente fue a prod **primero** (merge + auto-deploy) y el `db push` del DROP se aplicó **después** — el código ya no escribía la columna, así que el drop no podía romper escrituras en vuelo. Smoke pre y post-drop OK.
- PR #234, merge `a8be440`.

## T-131 fase A ✅ Dashboard operativo (pulso + contadores accionables + cola de atención) — EN PROD

Rediseño del dashboard: saludo + pulso del día + **4 contadores accionables** (no vanity metrics) + cola **"lo que necesita tu atención"** (`AttentionQueue`) con drill-to-action por tipo (EPP → planilla Res 299/11, protocolo → informe IA, resto → ver en agenda) + columna derecha (`DashboardSidebar`: nuevo informe / borradores / asistente) + FAB en mobile (`DashboardFab`). **Reemplaza el viejo `ProximosVencimientosPanel`.** Composición RSC con un agregador único (`DashboardData`) bajo `<Suspense>` (`DashboardSkeleton`).

- **Fechas por civil AR sobre la unión**: las severidades/conteos se derivan contra `todayCivilIsoAR()` sobre la unión de vencimientos, no por el corte UTC de las sub-queries (`getOverdueEvents`/`getUpcomingEvents`) — en la ventana 21-24h ART un vencimiento "de hoy" cuenta como vencido. El test del borde usa fecha mockeada, no la hora del CI (ver lessons).
- Sin migración. PR #235, merge `aab1c31`.

## T-131 fase B ✅ Semáforo por cliente en el dashboard (el diferenciador) — EN PROD

Semáforo de estado por cliente (`ClientSemaphore`). **RPC `semaforo_clientes`** (`20260609000001_t131_semaforo_clientes.sql`) que deriva el cliente de cada vencimiento por 3 caminos (informes → `cliente_id`; EPP → empleado → cliente; acción correctiva), con **cast seguro de metadata jsonb** (regex de formato UUID en el `WHERE` antes del `::uuid` — `metadata` es shape libre y un valor no-UUID reventaría la RPC entera), aislamiento por `my_consultora_ids()` y fecha civil AR (`p_hoy` + `at time zone`). Umbral: **rojo** = vencido, **amarillo** = ≤30d, **verde** = >30d o sin vencimientos. El merge con la lista de clientes se hace en el server.

- Migración aditiva (solo la RPC) → `db push` aplicado **antes** del merge (el código nuevo la consume al deploy).
- PR #238, merge `01b4041`.

## T-132 ✅ Endurecer el flake E2E del guard `EXEC_NOT_DRAFT` (split a test zero-write) — EN PROD

El guard `EXEC_NOT_DRAFT` flapeaba dentro del mega-test del runner de checklists: un `revalidatePath` en vuelo (de un save/foto previo del mismo test) re-renderizaba la ruta server-side y, al cambiar el estado out-of-band, swappeaba el componente (runner → `EjecucionDetailView`) desmontando el target del click → el click colgaba hasta el timeout. **Fix: split a un test zero-write dedicado** (sin escrituras previas → sin `revalidatePath` en vuelo → swap imposible por construcción); el mega-test queda en el happy path.

- Probado **red→green** en CI (viejo 5/20 rojo → nuevo 20/20 verde). Test-only, sin migración.
- PR #236, merge `ee11408`.

## T-133 ✅ Calendar hardening: M-1 (input trust) + L-1 (re-scope semáforo) — EN PROD

Auditoría de seguridad (Opus 4.8), hallazgos M-1 + L-1. Cierra en el borde de input la raíz del vector del semáforo (antes solo mitigado downstream con el regex UUID de T-131) y cubre la superficie UPDATE directo (PostgREST) que RLS no puede expresar.

- **M-1 borde Zod**: partición `SYSTEM_GENERATED_EVENT_TIPOS` (`epp_entrega`/`accion_correctiva` — solo los crean las RPCs `gen_*` service-role) vs `USER_CREATABLE_EVENT_TIPOS` (derivado, no lista duplicada) en `calendario/defaults.ts`. `createCalendarEventSchema` y los dropdowns (`EventForm`; `PostPublishEventDialog`, que ofrecía los 8 tipos con enum propio) solo aceptan user-creatable. `metadataField` (compartido create/update) rechaza las claves del namespace system (`SYSTEM_METADATA_KEYS` — las escriben las gen_* y las leen el semáforo y el contexto EPP). `updateCalendarEventAction` bloquea patches de `metadata` y de `recurrence_months` no-null en eventos system (`null` pasa: EventForm edit lo manda incondicionalmente; el trigger DB es el backstop).
- **M-1 defensa DB** (migración `20260609000002_t133_calendar_hardening.sql`): la policy INSERT excluye tipos system para authenticated (las gen_* son security definer vía service-role → bypassean RLS) + trigger BEFORE UPDATE `calendar_events_guard_system_rows`: `tipo` inmutable global (la WITH CHECK de UPDATE no ve OLD → no expresable en RLS) y metadata/recurrencia congeladas en filas system solo si `auth.role()='authenticated'`, con carve-out `cancel_reason` (el motivo de cancelación vive DENTRO de metadata y lo escribe el user-client al cancelar). Anti-drift SQL↔TS: test-meta `t133-system-tipos-sql-sync.test.ts` + comentarios cruzados.
- **L-1**: `semaforo_clientes` re-valida el id DERIVADO contra el tenant en las 3 ramas (joins a `clientes`/`empleados` con `my_consultora_ids()` — antes solo se scopeaba `ce.consultora_id`). El cast `::uuid` de metadata quedó envuelto en `CASE WHEN <regex>` (plan-independiente; la versión T-131 dependía del push-down del predicado del WHERE). Degradado granular intacto; misma firma → sin drift de types.ts.
- **Auditoría prod**: `scripts/dev-audit-system-events.ts` (READ-ONLY, lo corre el owner tras su OK; cuenta eventos system sin origen de dominio + con `recurrence_months`). Las filas pre-fix siguen siendo válidas; si una tiene recurrencia y se completa, el clon authenticated choca la policy → `auto_recurrence_failed` logueado y el complete cierra igual (diseño existente).
- **Residuales/FU**: FK compuesto `calendar_events(informe_id, consultora_id)` cerraría la rama 1 de raíz (candidato a FU). ~~DNI drift Zod↔SQL · rate-limit guard~~ cerrados en T-135 (L-2 + L-3); el `.or()` injection se cerró en T-134.
- Tests red→green: unit `calendar-schema.test.ts` (partición + tipos + claves reservadas) · integration: alta EPP manual reconvertida a negativo, guards de update/cancel (carve-out incluido), policy + trigger ambos sentidos (bloqueo authenticated / paso service-role, R3 `auth.role()`), anti-poisoning cross-tenant en las 3 ramas del semáforo.
- Migración aplicada a prod (diff-gate `migration list --linked` + `db push --dry-run` + OK del owner) ANTES del merge. Auditoría read-only de filas pre-fix: pendiente, la dispara el owner.
- PR #240, merge `fd9588e`.

## T-134 ✅ Sanitizar el término del `.or()` en búsqueda de empleados (PostgREST injection L-4) — EN PR

Auditoría de seguridad (Opus 4.8), hallazgo L-4 (bajo). `searchEmpleadosByNombre` escapaba solo wildcards LIKE e interpolaba el término en el string CRUDO del `.or()`, donde `,` `(` `)` `"` son sintaxis estructural de PostgREST (y `*` es alias de `%` en like/ilike, tampoco cubierto) → un término con coma inyectaba condiciones de filtro extra (intra-tenant; RLS contiene cross-tenant) y un paréntesis producía un 400 que la query se tragaba (`{ data }` sin chequear `error`). **Fix: allowlist name-safe** — `sanitizeNombreSearchTerm` (`empleados/search-term.ts`, pura, sin `'server-only'` → unit-testeable): letras con acentos (`\p{L}\p{M}`, NFD incluido) + dígitos + espacio + apóstrofo recto/tipográfico + punto + guion; el resto se descarta ANTES de interpolar. El escape de wildcards queda como defensa en profundidad (hoy no-op) y el guard de 2 chars pasa a evaluar el término SANEADO (`",a"` ya no llega a la query).

- **Barrido de la clase**: ese `.or()` era el ÚNICO con interpolación en todo el repo; los `.not()` existentes usan la forma parametrizada de 3 args. `searchClientesByRazonSocial` (`.ilike()` parametrizado por el builder) y `searchEmpleadosByDni` (digits-only + `.ilike()`) confirmados seguros — sin cambio.
- Tests red→green: unit del saneador (`empleados-search-term.test.ts` — estructurales + `*` + no-sobre-bloqueo "O'Brien"/"García-López"/NFD por escape) · integration test 18 (término inyectado `a,nombre.ilike.%` no trae la carnada que termina en "a"; paréntesis ya no produce el 400 tragado y matchea literal; apóstrofo sigue matcheando).
- Solo código, sin migración → no toca prod-DB; el deploy del merge alcanza. PR #TBD.

## T-135 ✅ Cierre de bajos de la auditoría: L-2 (drift DNI Zod↔SQL) + L-3 (guard Upstash en prod) — EN PR

Auditoría de seguridad (Opus 4.8), últimos dos hallazgos bajos (batcheados en un ticket; commits separados por concern). Solo código, sin migración → no toca prod-DB; el deploy del merge alcanza.

- **L-2 (UX, no vuln — la DB falla cerrado)**: `DNI_REGEX_INPUT` (permisivo, hasta 12 chars para tolerar separadores) dejaba pasar 9-12 dígitos puros que el CHECK SQL `^\d{7,8}$` (`20260519114309_empleados.sql:46`) rechazaba recién en el INSERT con error genérico. **Fix**: `.refine` en `dniField` (`shared/templates/common/dni.ts`) que valida la forma canónica POST-`normalizeDni` — `.refine` y NO `.transform` (rompe la inferencia RHF, 07-zod-rhf-gotchas). La regex canónica quedó extraída a `DNI_REGEX_CANONICAL` (fuente única, reusada por `formatDni`). Consumers verificados: `dniField` solo vive en el form de alta/edición (`empleados/schema.ts:67,81`); `searchEmpleadosByDni` tiene su propio normalize+guard (prefijo 3-8 dígitos, `queries.ts:140-142`) y NO se toca.
- **L-3 (señal de ops)**: `UPSTASH_REDIS_REST_URL/TOKEN` son `.optional()` en `env.ts` → si faltan en prod, `getRateLimiter` cae al noop (siempre allow) y TODOS los límites (signup/login/IA/webhooks) se desactivan en silencio (abuso/costo). **Fix**: warn de boot en `env.ts`, mismo molde que `BILLING_GATE_DISABLED`/`MP_TEST_PAYER_EMAIL` (console.warn — el logger pino no existe al boot del módulo; sale en stdout → EasyPanel logs). **WARN y no throw** (decisión del owner): seguro para disponibilidad. Condición extraída a la función pura `shouldWarnMissingRateLimit(env, nodeEnv)` para unit-testearla sin ejecutar el side-effect top-level del módulo (safeParse + throw al cargar).
- Tests red→green: unit `dni.test.ts` (9 y 12 dígitos puros + 9 con puntos rechazados; 7-8 dígitos y `12.345.678` siguen pasando) · unit `env.test.ts` (la pura: true en prod con ausencia total o parcial; false con ambas presentes, en development y con NODE_ENV undefined). Demo rojo→verde ejecutada en local (refine comentado / guard mutilado → rojo → restaurado → verde).
- PR #TBD.

## T-127 Tanda 7 🔜 pulido

Lo único pendiente de T-127: pulido de tipografía/densidad + barrido de headers compartidos + guard anti-drift del dashboard (`QUICK_LINKS` ↔ `NAV_ITEMS`, fuente única + test-meta). El owner sigue cuando quiera.

## T-126 producto 🔜 DORMIDO

Mejoras de producto sobre la persistencia del chat: renombrar/buscar conversaciones · RPC transaccional `create + insert` (hoy son 2 statements desde la action) · títulos de conversación generados por IA.

## Skew PostgREST local↔prod (`db:types`) 🔜

Prod corre PostgREST 14.5; la imagen de Supabase local es 14.x → `pnpm db:types` reintroduce el bloque `__InternalSupabase` que el gate `gen types --local` (drift de CI) rechaza. Fix de raíz: bumpear la imagen de Supabase local a 14.5, o stripear ese bloque en el script `db:types`. Detectado en T-126.

## Doc-sync · limpiar refs Vercel pre-T-022.5 en docs de planning 🔜

El claim de deploy quedó alineado en este sync (`PROJECT-CONTEXT.md` + `06-deployment.md` + nota de resolución en ADR-0007). Queda staleness Vercel-host **anterior** a T-022.5 en docs de planning, NO tocada por decisión del owner: `docs/technical/00-skills-y-stack.md` (Hosting=Vercel + "deploy automático a Vercel", L38/49/150/160/168), `docs/technical/01-principles.md:48`, `docs/technical/05-branch-protection.md §198-204`. Sibling del doc-drift de data-model y de T-076.
