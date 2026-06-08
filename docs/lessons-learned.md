# Lessons learned cross-sprint

Índice consolidado de lessons aprendidas durante la construcción de ConsultoraDemo. Cada entrada lleva referencia al ticket origen y al ticket donde se aplicó si aplica. Detalle granular del contexto vive en el sprint correspondiente (`docs/sprints/sprint-N.md`).

Criterio de inclusión: lessons taggeadas explícitamente "lesson aplicada" / "lesson learned" / "lesson T-XXX" o repetidas 2+ veces cross-ticket. Lessons inline en sprints quedan tal cual, este archivo es índice consolidado.

## DB / migrations

### `pnpm db:types` post-migration ANTES del primer commit

**Origen**: T-047. **Aplicada en**: T-052.

Después de `pnpm supabase db push` SIEMPRE correr `pnpm db:types` antes del primer commit. Sin esto el pre-push hook bloquea por typecheck cuando el test usa `admin.from('tabla')` que TS no reconoce hasta regenerar tipos. Script: `"db:types": "supabase gen types typescript --linked > src/shared/supabase/types.ts && prettier --write src/shared/supabase/types.ts"`.

### Audit trigger extension pattern

**Origen**: T-020 (audit_informes contenido). **Aplicada en**: T-027 (calendar_events parent_event_id), T-036 (extension calendar_events), T-050 (informes cliente_id).

Para extender un audit trigger existente: usar `CREATE OR REPLACE FUNCTION` sin tocar los 3 triggers AFTER (siguen apuntando a la función). Diff guard `is distinct from` debe incluir el nuevo field; payloads `before_data`/`after_data` deben incluirlo también. Campos grandes (>500 chars como `notas`/`contenido`/`descripcion`) se excluyen del payload Y del guard para no saturar audit_log.

### Audit trigger payload — PII exclusion

**Origen**: T-033 (telegram_subscriptions). **Aplicada en**: T-034 (push_subscriptions).

Audit triggers de subscriptions externas (Telegram chat_id, Push endpoint+keys) NUNCA incluyen el valor real en `before_data`/`after_data`. Solo `user_id` + boolean derivado (`chat_id_is_set` para Telegram, `has_user_agent` para Push). Razón: leak via audit permite admin ver chat_id de users (PII) o secret de routing del Push Service. Códigos consumibles (`link_code` Telegram) también excluidos del payload.

### Audit_log.consultora_id nullable forzado

**Origen**: T-033. Las rows de audit de subscriptions per-user no tienen contexto consultora. `ALTER TABLE public.audit_log ALTER COLUMN consultora_id DROP NOT NULL` (T-033 migration). FK `on delete restrict` queda intacta cuando `consultora_id IS NOT NULL`.

### Cascade DELETE bloqueado por audit_log retention

**Origen**: T-047 (test 15 reformulado). Invariante global del schema.

Las cascades `tabla.consultora_id ON DELETE CASCADE` NO se ejercitan end-to-end via DELETE de consultora porque los audit triggers se disparan DURANTE el cascade, insertan rows en `audit_log` apuntando a la consultora siendo eliminada, lo cual bloquea el DELETE original por `audit_log_consultora_id_fkey ON DELETE RESTRICT` (T-011). La cascade en el schema SI es válida — solo no se puede ejercitar via DELETE de consultora sin primero limpiar audit_log con cleanup admin explícito. Matchea patrón canónico T-027 test 11.

### AUD-001 immutable trigger rompió T-074 silenciosamente

**Origen**: CHORE-C (watchdog dunning rescue). **Aplicable a**: cualquier trigger BEFORE UPDATE/DELETE blanket sobre una tabla con escrituras activas.

AUD-001 (`20260524000002_audit_followup.sql`) agregó `billing_notifications_log_immutable()` con un `raise exception` blanket para UPDATE+DELETE. Eso rompió el flujo legítimo T-074: el cron daily hacía `claim → Resend.send → UPDATE resend_email_id`. El UPDATE post-claim quedó rechazado → `markLogResendId`/`markLogFailed` lo loguean con `logger.warn` (no-fatal por diseño) → toda row insertada desde 2026-05-24 quedó con `resend_email_id NULL`. Emails sí se enviaban (Resend dedup por idempotencyKey 24h evitó spam), pero observabilidad rota: no se podía distinguir sends exitosos de KO en DB. CHORE-C lo descubrió porque su watchdog hace EXACTAMENTE el mismo UPDATE → mismo livelock infinito si no se refinaba el trigger.

**Moraleja**: smoke productivo post-merge de migrations que afectan tablas con escrituras activas. Query las rows nuevas y verificar shape — `select count(*) from <tabla> where <campo de escritura> is null and created_at > '<fecha-merge>'`. Si el count es alto, hay flujo silenciosamente roto.

**Fix forward**: refinar trigger immutable para permitir transiciones legítimas. Patrón en `20260525000002_chore_c_fix_aud_001_trigger.sql`: UPDATE permitido solo si `OLD.<col> IS NULL AND NEW.<col> IS NOT NULL AND <todas las otras columnas idénticas>`. DELETE sigue rechazado para preservar append-only audit.

**Side effect en tests**: tests integration que hacían DELETE pre-cleanup sobre la tabla (ej. `billing-dunning-cron.test.ts` test 4) quedaron pre-existing broken — el DELETE rebota silenciosamente. Mantener para detección o reescribir con fixtures fresh-per-test. Mismo patrón ya documentado abajo en "Cascade DELETE bloqueado por audit_log retention".

### Placeholder check Vault robusto (regex vs equality)

**Origen**: T-034 smoke pre-Lautaro. **Aplicable a**: próximas migrations que toquen `process_pending_reminders()` helper.

El check `decrypted_secret = 'REPLACE_ME_POST_DEPLOY'` (exact match Y mayúscula) NO captura variantes con typo (ej `REPLACE_ME_POST_DEPLOy` con `y` minúscula). Síntoma: cron dispara POSTs pero `net._http_response` muestra `error_msg='Couldn't connect to server'` / `status_code=401` porque el secret de Vault no matchea ni con placeholder check ni con `INTERNAL_CRON_SECRET` de EasyPanel. Fix recomendado: regex `decrypted_secret like 'REPLACE_ME%'` o `length(decrypted_secret) != 64` como check más robusto. Documentado en `docs/operations/cron-secret-rotation.md` + `docs/operations/push-setup.md`. Aplicado en T-109 (`process_epp_weekly_summary`): `v_secret is null or v_secret like 'REPLACE_ME%' or length(v_secret) != 64`.

### Migración mergeada ≠ aplicada en DB (drift merge → deploy)

**Origen**: T-109 (drift de T-108 detectado en `supabase db push --dry-run` pre-aplicación).

Una migración puede estar mergeada a `main` hace días pero NUNCA aplicada a la DB: **merge ≠ deploy de migración**. T-108 (trial 7d → 14d) se mergeó pero no se pusheó → los signups recibían 7d en vez de los 14d que promete la landing, en silencio. Lo cazó un `supabase db push --dry-run` corrido antes de aplicar T-109, que listó T-108 como pendiente.

**Moraleja 1 — verificar `db push` post-merge de migrations**: tras mergear una migración, confirmar que se aplicó a la DB. Un `db push --dry-run` post-merge funciona como check de drift: si lista migraciones que creías aplicadas, hay gap proceso merge→deploy.

**Moraleja 2 — el smoke debe verificar el EFECTO REAL, no el "success" del CLI**: que `db push` reporte `Finished` (o que el PR mergeó) NO prueba que el cambio esté vivo. Verificar el efecto concreto en la DB: para funciones `select prosrc from pg_proc where proname='<fn>'` y confirmar el cambio (ej. `interval '14 days'` presente, `'7 days'` ausente); para tablas, query del schema. Es exactamente lo que habría cazado el drift de T-108 días antes.

### Smoke de crons: cadena pg_cron→pg_net→route + secret-sync Vault↔EasyPanel

**Origen**: T-109 (cron resumen semanal EPP). **Aplicable a**: todo cron nuevo (dunning T-074, reminders T-031).

Un cron en este stack es una cadena de cuatro saltos: `pg_cron` (schedule) → `process_*()` (lee `cron_dispatch_secret` + `cron_dispatch_base_url` del Vault) → `pg_net` (POST async) → route Next (valida `X-Internal-Cron-Secret` contra `env.INTERNAL_CRON_SECRET`). El smoke real verifica la cadena ENTERA, no un curl al route: (1) `vault.decrypted_secrets` ≠ placeholder y largo 64; (2) `select process_*()` manual; (3) `net._http_response` último = 200; (4) opcional fila en la log table.

**El secret vive DOS veces y deben ser idénticos**: `cron_dispatch_secret` (Vault, lo manda la función como header) y `INTERNAL_CRON_SECRET` (EasyPanel env, lo valida el route). Si rotás uno solo → **401** y el cron falla en silencio (pg_net no propaga el error a la vista). Sync = copiar el valor del Vault a EasyPanel + redeploy.

**0 emails con status 200 = éxito** cuando no hay actividad: el route hace skip silencioso si la consultora no tiene nada accionable (no inserta en la log table). El smoke valida el DISPARO (200), no el envío. Runbook completo: `docs/operations/t-109-weekly-summary-smoke.md`.

### Orden `db push` ↔ merge cuando el código depende de la migración

**Origen**: T-061-FU1. **Aplicable a**: cualquier merge cuyo código nuevo lea una vista/tabla/RPC recién creada.

El merge auto-deploya **solo el código** (webhook EasyPanel, no es job de GitHub Actions → no se ve por `gh`, tarda unos min en rebuildear la imagen ~600MB+Chromium). Las migraciones NO. Si el código mergeado **depende** de un objeto de la migración (FU1: `getEjecucionesForConsultora` lee `checklist_executions_heads`), aplicar la migración a prod **ANTES** del merge: apenas mergeás, el deploy publica el código y si la vista no existe, rompe. Si el código aún no usa el objeto, basta la misma ventana del merge. Gate del `db push`: `migration list --linked` + `db push --linked --dry-run` (diff validado por el orquestador) + OK explícito del owner (es prod), sin `--yes`/`--force` (el prompt se confirma a mano). Contraste con la "Moraleja 1" de T-108 (verificar post-merge): el post-merge sirve de check de drift, pero el ORDEN seguro con auto-deploy es **migración-primero**.

### Numeración de migraciones: contador secuencial por día, no HHMMSS

**Origen**: T-114/T-119. La convención `<YYYYMMDDHHMMSS>_<snake>` se usa como contador secuencial por día (`YYYYMMDD00000N`). Antes de nombrar: `ls supabase/migrations/ | tail`, tomar el siguiente `00000N`. En T-114 la 1ª propuesta colisionó con t061fu1 (mismo `000001`) → cazado en review → renombrada a `000002`.

### Sincronización proyección↔dominio por trigger (fuente de verdad única)

**Origen**: T-118 (auditoría 2026-06-04, ver ADR-0015). `calendar_events` copia fecha/estado del dominio (`epp_planificaciones`/`acciones_correctivas`); editar un lado no sincronizaba el otro. Fix: trigger AFTER UPDATE con WHEN clause + escritura separada + guarda de idempotencia (no-op vs el lifecycle de T-119). Regla: toda fecha/estado proyectada al calendario tiene fuente única sincronizada por trigger.

### Lifecycle: los pendientes generados necesitan un flujo de cierre

**Origen**: T-119 (auditoría, ADR-0015). `epp_planificaciones` y `acciones_correctivas` nacían 'activa'/'abierta' y nunca se cerraban (enum con estados de cierre que el código no seteaba) → acumulación de fantasma. Fix EPP: cerrar la previa al reentregar + unique parcial activas + backfill. CAPAs: T-120 ✅ (`resolverCapaAction`, cierre con evidencia). Regla: todo pendiente generado tiene un flujo de cierre + (si aplica) unicidad que lo blinde.

### FK compuesta para coherencia de tenant denormalizado

**Origen**: T-121 (auditoría ADR-0015, clase D-RingA). El `consultora_id` denormalizado en ~12 tablas hijas (fast-path de RLS, evita el join al parent) no tenía enforcement: un INSERT mal hecho o una RPC futura con bug podía plantar un hijo con el `consultora_id` de OTRO tenant → la RLS del hijo confía en su columna denormalizada → fuga cross-tenant. Fix declarativo (sin trigger): FK COMPUESTA `hijo.(<fk>, consultora_id) → parent.(id, consultora_id)`, que Postgres garantiza estructuralmente (`hijo.consultora_id = parent.consultora_id`). Requiere una `unique (id, consultora_id)` en el parent (destino del FK compuesto; Postgres exige UNIQUE CONSTRAINT, no índice suelto). Alcance Ring A: 17 FK + 9 uniques sobre ownership NOT-NULL (ambos lados `consultora_id NOT NULL` → cero gaps). Ring C (system rows con `consultora_id NULL`) NO se protege con `MATCH SIMPLE`: un NULL en la columna compuesta pasa el check → queda dormido (T-121-FU).

### Drop de constraint por resolución dinámica, no por nombre default

**Origen**: T-121 / T-124. Para reemplazar una constraint (FK simple → compuesto en T-121; CHECK inline en T-124) NO hardcodear el nombre default (`<tabla>_<col>_fkey`): puede diferir del real. Resolver el `conname` real desde `pg_constraint` (por `conrelid`/`confrelid`/columna, o por `pg_get_constraintdef ilike`) y `drop` vía `execute format`. Si no se encuentra → `raise exception` (NO `drop … if exists` silencioso, que dejaría la constraint vieja conviviendo con la nueva). Reaplicable limpio bajo `db reset`.

### Quitar valor de enum: text+CHECK trivial, enum TYPE pesado

**Origen**: T-124. Quitar un valor muerto depende de cómo está modelado: si es `text` + `CHECK in (…)` (ej. `calendar_event_reminders.status`), un `ALTER … DROP CONSTRAINT` + re-add sin el valor lo quita en una línea; si es un enum `TYPE` (ej. `estado_suscripcion`), no hay `DROP VALUE` → recrear el tipo entero es pesado → se REDOCUMENTA en vez de quitar. Y la asimetría: se QUITA el valor si es dato sin lógica (`failed`, que nunca se escribía); se REDOCUMENTA si tiene scaffolding/feature vivo (`archived` = soft-delete diseñado-no-implementado, con label + botones TS). Guard al estrechar un CHECK: `raise exception` si quedan filas con el valor a remover (mensaje legible antes de que el `ADD CONSTRAINT` falle solo).

### Skew PostgREST local↔prod en `pnpm db:types`

**Origen**: T-126. Prod corre PostgREST 14.5; la imagen de Supabase local (`supabase start`) es 14.x → al regenerar `src/shared/supabase/types.ts` con `pnpm db:types`, la versión local **reintroduce** el bloque `__InternalSupabase` que el gate de drift de CI (`gen types --local` + `git diff`) rechaza. Workaround manual: hand-edit del archivo (mismo recurso que en T-061-FU1). Fix de raíz pendiente (FU en `operativo.md`): bumpear la imagen local a 14.5, o stripear ese bloque en el script `db:types`.

## Tests integration

### Suite de integración + E2E escribían a prod → contaminación de 14k consultoras

**Origen**: T-111. **Aplicada en**: F1 (#158) integration aislado; T-112 pendiente (E2E).

Hasta T-110 `pnpm test:integration` corría contra el Postgres prod-linked compartido (`source .env.local && vitest --project integration`) y el step `E2E tests` de `ci.yml` corre Playwright contra la app buildeada con secrets de prod. Cada run creaba consultoras + `auth.users` de test en prod → se acumularon **14.484 consultoras de test + 5.811 `auth.users @example`** antes de detectarlo. F1 (#158) aisló integration con un Supabase local efímero (`scripts/test-integration-local.mjs`: `supabase start` + `db reset` + keys locales inyectadas, cero cambios a los tests). **E2E sigue pegándole a prod → T-112** lo replica.

**Moralejas**: (1) ningún test contra prod-linked — stack efímero por capa de la pirámide. (2) Si ya hay contaminación, el cleanup one-shot debe: (a) **frenar TODAS las fuentes primero** (se pausó el step E2E con `if: false`, #161) o el borrado se revierte solo con el siguiente run de CI; (b) identificar lo protegido por **EXCLUSIÓN** (consultora con ≥1 member email ≠ `@example.com`), no por patrón frágil; (c) `DO` transaccional + `disable trigger user` (owner, no superuser) + borrado topológico (Kahn dinámico sobre `pg_constraint`) con FK ACTIVAS. `session_replication_role='replica'` NO va en Supabase (`postgres` no es superuser → 42501) y el cascade tampoco sirve (FK RESTRICT intra-dominio + el trigger inmutable de `audit_log` bloquea el SET NULL/UPDATE que el cascade dispara). (3) Para `auth.users`: el `delete ... where email ilike '%@example.com'` plano falla por el mismo motivo (SET NULL sobre `audit_log.actor_user_id` lo rebota el trigger inmutable) → mismo molde. (4) Backup en Free (sin PITR ni backup automático): dump JSON acotado de los registros protegidos + schema en git; un `pg_dump` completo sin Docker/`pg_dump` nativo no era viable y solo habría respaldado la basura a borrar.

### Setup secuencial vs Promise.all

**Origen**: T-047. **Aplicada en**: T-048, T-052, T-053.

Setup tests integration siempre secuencial. Paralelizar INSERTs de consultoras + `auth.admin.createUser` (3+ calls) causa flakiness real con `ConnectTimeoutError 10s en sa-east-1` + `data.user` null por rate-limit silencioso de `auth.admin`. Costo +500ms por test, determinístico vs flaky. Issue [#56](https://github.com/LautiRoveda/consultora-demo/issues/56) captura Windows-local-only flakiness en paralelo, CI Ubuntu OK con workers=1.

### Cleanup orden FK explícito

**Origen**: T-049/T-050. **Aplicada en**: T-051, T-053.

Limpiar dependientes antes que padres (informes → clientes → users) evita FK violations contra `audit_log` durante el cleanup. Los audit triggers se disparan durante el cascade DELETE de consultora y bloquean por `audit_log_consultora_id_fkey ON DELETE RESTRICT` (T-011 invariante global). Splice de arrays en `afterEach`/`afterAll`.

### Test assertions sa-east-1 + Promise.all NO confiables

**Origen**: T-047. Test 3 (anon NO ve clientes) ajustada: `error.code === '42501' permission denied for function is_member_of_consultora` porque los helpers T-015 tienen grant `to authenticated, service_role` (NO anon); defensa en profundidad esperada — anon NUNCA debe llegar a evaluar el filtro RLS porque el helper rechaza antes.

### red→green ejecutado en CI (2 commits) cuando no hay Docker local

**Origen**: T-114. El gate 'demo red→green ejecutada' choca sin Docker (integration necesita `supabase start`). Solución: commit 1 = solo el test (sin la migración) → job Integration ROJO real; commit 2 = agrega la migración → VERDE. El squash colapsa. NO sirve 'diferir a CI' sin el commit-1-sin-migración (CI siempre corre la branch completa → siempre verde). Aplicado T-114 #204 (run rojo `26963251304` → verde `26963914133`).

**Nota T-123 (trigger AFTER roba el count)**: cuando el fix es un trigger `AFTER UPDATE`, corre ANTES del código de la action que (antes) hacía el mismo trabajo → ese código ve 0 filas. En T-123 `skip_reminders_on_event_final` skipea los reminders antes de que `complete/cancelCalendarEventAction` los skipee → el `remindersSkipped` que la action devolvía leía 0 → se quitó (count muerto post-trigger). Al testear un trigger que duplica lógica de app, asertar el ESTADO FINAL (filas `skipped`), no el count que devuelve la action.

### Búsqueda para LLM: multi-término + accent-insensitive, aislada de los autocompletes

**Origen**: T-117-FU1. `searchEmpleadosByNombre` (ILIKE del string completo en un campo) no matcheaba 'nombre apellido' juntos ni acentos. Para el chat se hizo `searchEmpleadosForChat` (split en tokens + normalize NFD strip diacríticos en JS, sobre el set activo del tenant) SIN tocar la query de autocomplete que usan otros módulos.

## Tests unit / component

### Flaky por timeout de `waitFor` bajo contención del CI (project component)

**Origen**: T-116. **Aplicable a**: cualquier `.test.tsx` con cadenas async (RHF+Zod, toasts) en el project `component`.

`ClienteForm > DUPLICATE_CUIT` flapeaba ~1/N en CI: el `waitFor`/`findBy` default de testing-library (1000ms) vence bajo contención de CPU al correr los 94 archivos del project `component` en paralelo; en aislamiento pasa siempre. **Fix**: `configure({ asyncUtilTimeout: 5000 })` global en `src/tests/setup.ts` (lo carga solo el project component → no toca unit/integration); sube el techo de TODOS los async utils, y los que ya pasaban resuelven al primer intento. **Diagnóstico**: los projects de vitest (`unit` .test.ts/node, `component` .test.tsx/jsdom, `integration`) corren en pools/environments separados con `isolate=true` → un test de un project NO contamina a otro. **Descartá cross-project antes de buscar state pollution**: el flaky de un `.test.tsx` no lo causa un `.test.ts` nuevo de otro ticket (caso real: se sospechó de T-061-FU1, cuyo test es project `unit`, pool aparte). Verificación de un fix de flaky por timing: correr la suite completa 3-5× seguidas, no una sola vez.

## Tests E2E

### Server Actions de Next.js 16 NO son invocables desde Playwright

**Origen**: T-051. **Aplicable a**: futuros tests adversariales action-level.

CSRF tokens dinámicos + endpoint `_rsc/[hash]` generado en build sin acceso desde browser sandbox. Tests E2E adversariales de business logic action-level deben quedar en integration tests (Node con invocación directa). E2E adversariales solo pueden cubrir la capa UI (RLS automático de queries, filtros client-side, permission gates visuales).

### shadcn `CardTitle` primitive NO es semantic heading

**Origen**: T-050/T-051. `CardTitle` shadcn primitive es `<div data-slot="card-title">`, NO semantic heading. Tests E2E que verifican títulos de Cards usar `getByText`, NO `getByRole('heading')`.

### Issue #56 — Chromium Windows local flakiness

**Origen**: T-037. **Status**: cerrado pragmáticamente.

4 E2E flaky pre-existentes (`auth-flows.spec.ts` + `consultora-logo.spec.ts` + `informes-attachments.spec.ts` + `informes-pdf-export.spec.ts`) son Windows-local-only:
- `consultora-logo.spec.ts` / `informes-attachments.spec.ts` / `informes-pdf-export.spec.ts` requieren `CHROMIUM_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"` (puppeteer-core no descarga binario propio en Windows).
- `auth-flows.spec.ts` recovery flow: `ERR_NAME_NOT_RESOLVED` de Chromium al primer goto `/auth/callback?token_hash=...` en Windows local. 5 fixes probados, ninguno resolvió.

CI Ubuntu NO exhibe el problema (los PRs T-024..T-036 todos pasaron con retries=2). Decisión: comment inline al inicio de cada test afectado apuntando a runbook + issue, documentar lesson en runbook. Refactor estructural del browser pool (pre-warm en `next start` boot) queda como T-037-FU1 (tech-debt, low priority).

### `waitFor` toast antes de navegar post-action

**Origen**: T-049 (E2E test 3). Race entre `setDialogOpen(false)` sync y `startTransition` async causa que el `goto` post-archive traiga el cliente todavía no archivado de DB. Esperar el toast garantiza que la action completó.

## Server actions

### Discriminated union return — NUNCA throw

**Origen**: T-019. Patrón canónico forward.

Toda server action: `{ok:true,...} | {ok:false, code, message, fieldErrors?}`. Codes específicos por action (INVALID_INPUT / UNAUTHENTICATED / NO_CONSULTORA / NOT_FOUND / FORBIDDEN / INTERNAL_ERROR + codes business-specific como DUPLICATE_CUIT, DUPLICATE_DNI, ALREADY_FINAL, CLIENTE_NOT_FOUND_OR_FORBIDDEN). NO `FORBIDDEN` en codes cuando RLS no rechaza por ownership (any-member-edits tablas como Clientes/Empleados); si pasa 42501 es drift y mapea a INTERNAL_ERROR + Sentry warn.

### Cross-tenant defense pre-INSERT con SELECT RLS-aware

**Origen**: T-050 (decisión 14 plan-mode). **Aplicada en**: T-053 (Empleados cliente_id).

Los FK constraints NO respetan RLS (constraint check directo a nivel DB); sin SELECT defensive el atacante puede INSERT con FK apuntando a row de otro tenant + leakear información de existencia. Pattern obligatorio para todo action que acepte FK opcional/required cross-módulo. Mapping a `INVALID_INPUT` con `fieldErrors.<campo>` específicos (NO `FORBIDDEN`/`<CAMPO>_NOT_FOUND` nuevos codes — mantiene discriminated union estable). Implementación: `await supabase.from('tabla_fk').select('id').eq('id', parsed.data.fk_id).maybeSingle()` con cliente authed (RLS automático filtra cross-tenant).

### Schema LOCAL workaround gotcha RHF

**Origen**: T-049. **Aplicable a**: Empleados/EPP/etc forward.

Zod schemas con fields opt `.min(N)` rechazan `''` (RHF defaults a string vacío, NO `undefined`). Workaround triple defense:
1. Schema LOCAL permisivo en form (`string().max(N).optional()` sin min).
2. `diffPatch` convierte `'' → null` pre-invoke al action.
3. Action Zod estricto.
4. SQL CHECK final.

Follow-up T-049-FU1 abierto para helper canónico `optionalString({min, max})` en `src/shared/lib/`.

### Mapping declarativo exhaustivo para configs cross-tipo

**Origen**: T-050. **Patrón forward**: cualquier helper que cambie comportamiento según un tipo discriminante.

Cuando un helper debe comportarse distinto según el tipo activo (5 tipos de informe en T-050), mapping `Record<Tipo, Config>` exhaustivo con tipos discriminantes es más robusto que `if (tipo === 'X' || tipo === 'Y')` hardcoded. Refactor obligatorio si el conditional excede 2 valores. Verificación inline de los schemas reales antes del briefing (T-050 desviación reveló que `otros` cherry-pickea solo `razon_social + cuit`, no las dimensiones binarias asumidas — requiere mapping con 2 dimensiones `includeSite`+`includeDomicilio`).

### Idempotency cascade 4 capas

**Origen**: T-031 (notifications dispatch).

(1) UNIQUE constraint DB layer; (2) `UPDATE status='sent'` en la misma transacción que el SELECT FOR UPDATE SKIP LOCKED, antes del side-effect — at-most-once delivery, claim layer; (3) lookup en log table por `(entity_id, channel, status='sent')` antes de emitir — sender layer; (4) provider SDK con `idempotencyKey` por request — provider layer dedupea ventana 24h.

### revalidatePath strategy

Para acciones que afectan multiple paths: revalidar el path canónico + cualquier path donde la row aparezca embedded. `revalidatePath` de ruta inexistente es no-op silent en Next.js → forward-compat para cuando otro ticket cree el detail/tab view. Ejemplo T-053: `revalidatePath('/empleados/${id}')` + `revalidatePath('/clientes/${cliente_id}')` aunque ninguno existe al merge de T-053.

### Gate leak: una `cancelada` sin `cancelar_en` daba acceso

**Origen**: T-124. `getBillingStatus` (`src/shared/billing/access.ts`) bloqueaba una suscripción `cancelada` solo si `cancelar_en < now()`; una `cancelada` con `cancelar_en NULL` (churn real: MP la canceló por falta de pago, sin período de gracia stampeado) caía a `ok:true` → acceso filtrado. El leak estaba TESTEADO como `ok` (el test afirmaba el bug). Fix: `if (!cancelarEn || cancelarEn < now)` bloquea de inmediato; el test se invirtió a `ok:false`. La capa estructural la cierra el churn reaper (T-124, cron diario) que flipa esas filas a `expirada` y, vía el trigger T-122, recomputa `consultoras.plan='trial'`. Moraleja: un gate con rama "período venció" debe tratar el `NULL` del deadline como "sin gracia" (bloquea), no como "gracia infinita" (abre).

### Cache denormalizado: fuente única + sync por trigger

**Origen**: T-122 (auditoría ADR-0015, clase A en billing; misma forma que T-118 calendario→dominio). `consultoras.plan` / `trial_hasta` son un cache denormalizado de `suscripciones.estado`, pero ningún write path lo mantenía (el webhook MP updatea `suscripciones`, no `consultoras`) → una consultora que paga quedaba `plan='trial'` para siempre → el badge del sidebar mentía y el cron de dunning le mandaba "tu trial vence" a un cliente que paga. Fix: trigger `AFTER INSERT OR UPDATE OF estado` que recomputa el cache desde el estado VIGENTE de la consultora (`EXISTS` sobre TODAS sus suscripciones, no la fila `NEW`, para no degradar por un evento stale sobre una fila histórica) + guard `is distinct from` (idempotente, no churnea `updated_at`) + backfill promote-only. Regla: todo cache denormalizado necesita un productor único (trigger) que lo mantenga en la misma transacción que la fuente.

### Persistencia client-driven (Option C): el cliente persiste lo que muestra

**Origen**: T-126 (chat del asistente). **Aplicable a**: cualquier feature de streaming donde el output renderizado ES lo que hay que persistir. La route de streaming (`POST /api/asistente`) NO escribe en DB — devuelve el SSE y listo; el cliente, en el punto de commit (stream `done`, o abort con parcial), llama a una server action (`persistChatTurnAction`) con el turno exacto que mostró. Ventaja: el orquestador/route quedan intactos (sin acoplar persistencia al loop de tool-calling) y se persiste exactamente lo visible. La server action sigue siendo RLS-aware (per-user): aunque el contenido venga del cliente, el write solo entra en la conversación propia del user. Las tablas son append-only (mensajes sin UPDATE/DELETE).

## UI patterns

### Card density del list view: placeholders `—` literal

**Origen**: T-049 (decisión Lautaro Opción A).

Preserva grid + altura constante + ritmo visual escaneable + estándar admin tables Linear/Notion. NO compactar slots vacíos (rompe grid). Cambio menor "Sin industria" → "—" para consistencia visual de los 3 placeholders idénticos.

### Search scope del list view multi-field

**Origen**: T-049 (decisión Lautaro Opción B). Matchear razón_social + nombre_fantasia + cuit con CUIT digits-only normalize ambos lados (`qDigits.replace(/[-\s]/g, '')` + `c.cuit.replace(/-/g, '').includes(qDigits)`). El consultor piensa "el cliente del galpón" tanto como en razón formal; CUIT es identificador práctico cuando solo recordás eso.

### Sub-tabs en layout (no en cada page)

**Origen**: T-030 (CalendarTabsNav). **Aplicada en**: T-035 (SettingsTabsNav). Patrón: layout server compartido con header h1 + descripción + child client `<TabsNav />` con Link plano + `usePathname` + match con `startsWith(t.href + '/')` defensivo para sub-rutas. Clases shadcn `bg-background shadow-sm` (active) vs `text-muted-foreground hover:text-foreground hover:bg-background/50` (inactive).

### Permission gate UI espeja backend

**Origen**: T-029 (EventViewPanel). **Aplicada en**: T-030 (EventAgendaCard), T-036 (PublishButton), T-049 (ClienteActionsButtons).

Si backend tiene gate creator OR owner / owner-only → UI calcula `canEdit = ...` server-side + Tooltip wrapper sobre `<span>{button}</span>` (Radix necesita el span porque buttons disabled no disparan pointer events) con copy "Solo el creador o un owner pueden modificar...". Test cubre los 3 casos: creator, owner non-creator, member non-creator non-owner. Cuando NO hay gate por ownership (Clientes/Empleados any-member) UI tampoco tiene disabled state.

### shadcn primitives con patrón `radix-ui` unificado

**Origen**: T-008/T-017. **Aplicable forward**: cualquier `pnpm dlx shadcn add ...`.

Los primitives instalados deben usar `import { X as XPrimitive } from "radix-ui"` (unificado), NO `@radix-ui/react-x` separados. Si shadcn cambia el patrón en el futuro: regrep `@radix-ui/react-` post-add + reescribir a `radix-ui` unificado + NO sumar paquetes separados a `package.json`. Convención documentada inline en `popover.tsx:5-15`.

### `Tooltip` necesita `TooltipProvider`

**Origen**: T-029. Descubierto durante primer E2E (todos fallaron con "Tooltip must be used within TooltipProvider"). El AppShell ya wrappea `<AppSidebarNav>` con uno pero el contenido del shell NO heredaba. Fix: agregar al root de cada View que use Tooltip envolviendo los componentes hijos.

### `useWatch` en lugar de `form.watch()` (RHF + React Compiler)

**Origen**: T-029. `form.watch()` dispara warning React Compiler "Use of incompatible library" (memoización inestable) que el pre-commit hook (`--max-warnings=0`) bloquea. Migrar a `useWatch({ control, name })` de RHF — API estable + sin warning.

### Date picker — civil ISO local TZ, NO toISOString

**Origen**: T-029 (decisión 5 / ajuste 5). Helper puro `dateToCivilIso(date)` con `format(date, 'yyyy-MM-dd')` de date-fns en lugar de `date.toISOString().slice(0,10)`. `toISOString()` convierte a UTC primero — si browser TZ ≠ UTC, el user clickea 15-jun pero el ISO sale con día -1 (UTC+12 NZ) o día +1 (UTC-3 ART). `format()` lee local TZ del Date, matchea siempre el día que el user clickeó.

### Drawer state derivado (no doble fuente de verdad)

**Origen**: T-029. `viewEventId` viene del `searchParams.get('event')` directamente; `intent` local solo para create/edit. Evita la trampa "setState dentro de useEffect" que ocurre al sincronizar dos fuentes — el lint rule `react-hooks/set-state-in-effect` lo flag (problema descubierto + fixed en pre-commit T-029).

### Server/client split para PDF print de componentes con state interactivo

**Origen**: T-023-FU4. **Aplicada en**: 5 sibling Server Components `<Tipo>MetadataSummaryContent.tsx`.

Cuando un componente client (Collapsible+useMediaQuery+useState) tiene que renderearse en PDF via Puppeteer (que no hidrata) → crear Server Component sibling sin el state interactivo (grid `grid-cols-2` plano con todos los campos, sin Collapsible). PrintTemplate consume el Server Component; web sigue consumiendo el Client (compact+Collapsible expand). Blast radius 0 en la UI web.

### `<base href>` para que Tailwind cargue en PDF

**Origen**: T-023-FU4. Puppeteer `page.setContent(html)` renderea en `about:blank` sin baseURL → la stylesheet relativa nunca se carga. Fix: helper `src/shared/pdf/inject-base-href.ts` con regex que prepend `<base href="${internalBaseUrl}/"/>` al primer `<head>` del HTML antes de pasar a `htmlToPdf()`.

### CSP `img-src` para signed URLs cross-origin

**Origen**: T-024 hallazgo crítico. El CSP `img-src 'self' data:` bloquea silenciosamente las signed URLs cross-origin al host `*.supabase.co`. Fix: derivar el origin desde `NEXT_PUBLIC_SUPABASE_URL` y agregarlo dinámicamente al `img-src` server-side, con fallback `https:` si el env está malformado (más restrictivo que `*`). Síntoma sin fix: PDF sale con alt text + icono "broken image" donde debería estar el logo/foto.

### Tombstone vacío: el listado de anulados linkea al original, no al tombstone

**Origen**: T-061-FU1 (checklists). **Aplicable a**: cualquier listado "ver anulados" sobre el modelo de supersession `corrige_id` + tombstone.

Anular inserta un **tombstone hijo** (`anulacion=true`, `corrige_id`→original) que **NO** copia el snapshot/respuestas/firma — esos viven en el registro original. La vista `_heads` devuelve el **tombstone** como head de la cadena (el original queda superseded por su hijo). Si el listado de anulados linkea a `row.id` (el tombstone), el detalle busca datos por `execution_id=tombstone.id` → **pantalla vacía**. **Fix**: linkear las filas anuladas a `corrige_id` (el original), cuyo detalle ya renderiza todo + banner "anulada" (tiene hijo tombstone → `esVigente=false`). Incidentes (T-063-FU2) lo resuelve distinto: su `HistorialTimeline` sigue `corrige_id` desde el detalle del propio tombstone. **Moraleja**: al calcar el patrón `_heads`/"ver anulados" de otro módulo, resolver primero **de dónde salen los datos del detalle** del tombstone — no asumir que el head trae el contenido.

### Responsive híbrido `h-11 md:pointer-fine:h-9` + footgun de tailwind-merge

**Origen**: T-127 Tanda 1. **Aplicable forward**: sizing de cualquier primitivo compartido (Button, Input, Select, …). Target táctil 44px en mobile/touch, compacto en desktop con mouse: clase híbrida `h-11 md:pointer-fine:h-9` (variante `pointer-fine` = dispositivos con puntero preciso). **Footgun**: `tailwind-merge` (el `cn()` de shadcn) colapsa clases de la misma familia y "se come" la altura híbrida cuando el primitivo ya trae una `h-*` por default → agregar un `size="none"` (sin `h-*` propio) en el primitivo para que la clase híbrida del caller gane. Dialog/AlertDialog: `max-h` + scroll interno para que el contenido largo no desborde en pantallas chicas. Tandas 2-6 + FUs ✅ EN PROD; queda T7 (pulido) — ver `operativo.md` y la sección **Responsive / UI (T-127)** abajo.

## Responsive / UI (T-127)

### SelectTrigger: `w-fit` → `w-full min-w-0`

**Origen**: FU smoke (#226 agregó `w-full`) + Tanda 4 FU2 (#227 agregó `min-w-0`). El `w-full` solo **NO** alcanza para evitar overflow: `min-w-0` es el que deja truncar. Footgun de selects (u otros controles con texto largo) dentro de un grid/flex — el ítem flex/grid tiene `min-width: auto` por default y se niega a encoger por debajo del ancho de su contenido; `min-w-0` lo libera. Forward: cualquier control con valor largo dentro de un contenedor flex/grid necesita `min-w-0`, no solo `w-full`.

### Verificar overflow mobile sin prod ni Docker

**Origen**: FU smoke T-127. Ruta dev throwaway + assertion Playwright `scrollWidth <= clientWidth` en viewport mobile + demo red→green. **NO** confirmar un smoke "a ojo" ni con zoom-out del browser (el zoom-out esconde el overflow real) — me costó una ronda.

### Dual-render tablas→cards

**Origen**: T2 (#222). Tabla en desktop (`hidden md:block`) + stack de cards en mobile (`md:hidden`), renderizando los mismos datos dos veces. Más simple y accesible que forzar una sola tabla a colapsar en mobile.

### Barras de acción de forms: `flex-col-reverse … sm:flex-row`

**Origen**: T4 (#224). `flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end` — el `flex-col-reverse` deja el botón **primario arriba** en mobile (orden DOM secundario→primario, invertido visualmente) y la fila clásica `justify-end` en desktop.

### Grid stack: `grid gap` vs `grid grid-cols-1`

**Origen**: T-127. `grid gap` (columna implícita `auto`) **no** encoge el contenido; `grid grid-cols-1` usa `minmax(0,1fr)` y sí lo deja encoger. Importa cuando algo adentro debe truncar.

### Header compartido aside/Sheet: `pr-12 md:pr-4`

**Origen**: FU smoke (#226). Cuando un header se comparte entre un aside fijo (desktop) y un Sheet (mobile, con su botón X arriba-derecha), `pr-12 md:pr-4` reserva el espacio de la X en mobile sin desperdiciarlo en desktop.

### Drift `QUICK_LINKS` (dashboard) ↔ `NAV_ITEMS`

**Origen**: #226 (corrigió el dashboard a los 9 módulos). Dos listas de navegación paralelas que se desincronizan. Fix forward: fuente única + guard test-meta que falle si divergen — pendiente (T-127 Tanda 7).

## Operativo / VPS

### Dockerfile build args para env vars `required` en `src/env.ts`

**Origen**: T-031 hotfix #72. **Aplicada en**: T-033, T-034. **Repetida en**: T-070 → fix T-070-FU1.

Env vars `required` en `src/env.ts` DEBEN declararse como `ARG` + `ENV` entries en el stage `builder` del Dockerfile. Sino EasyPanel build falla mid-collecting page data `/_not-found` con `Invalid environment variables — ver logs arriba`. **CI no detecta el bug** porque corre `pnpm build` directo en Ubuntu runner sin Docker multi-stage; matriz de validación pre-merge requiere chequear `Dockerfile` cuando se suman env vars required en `src/env.ts`.

**T-070-FU1 (21/05/2026)**: `ARS_PRICE_MONTHLY` introducido sin actualizar Dockerfile. EasyPanel build falló post-merge → container corriendo image viejo (con `plan_tier`) contra DB schema nuevo (con `plan`) → prod runtime-broken hasta que se aplicó este fix. **Regla forward (reforzada)**: cada var NUEVA `required` en `src/env.ts` exige co-commit en el mismo PR que toque **3 lugares**: (a) `src/env.ts` Zod schema, (b) `Dockerfile` builder ARG + ENV, (c) `.github/workflows/ci.yml` job env block. Las tres ubicaciones se chequean en review.

### Secret mismatch silente — generar fresh + pegar inmediato

**Origen**: T-031, T-033, T-034 smoke productivo.

Si cron procesa pero `notification_log` queda vacío + `net._http_response` muestra `status_code=401` → EasyPanel `INTERNAL_CRON_SECRET` ≠ Supabase Vault `cron_dispatch_secret` por copy-paste con espacios invisibles o truncado al pegar entre 2 UIs. Fix: regenerar fresh con `openssl rand -hex 32` y pegar el MISMO valor en ambos lados inmediatamente sin intermediarios. NO copiar entre UIs. Documentado en `docs/operations/cron-secret-rotation.md`.

### Resend domain verification timing

**Origen**: T-031 smoke productivo. Dominio muestra badge "Verified" en dashboard cuando DNS records resuelven (SPF+DKIM+DMARC green), PERO la verificación completa en el backend del provider toma **~4 min más** post-badge verde. Síntoma: primer envío real falla con `RESEND_VALIDATION_ERROR`. NO es bug del código — race entre DNS check inicial y backend verification. Mitigación: esperar 5+ min post-badge verde antes del smoke productivo.

### External API "future timestamp" validations — aplicar buffer > 1min

**Origen**: T-071-FU1 (22/05/2026). **Aplicable forward**: cualquier integración que pase timestamps a una API external que valide "future date".

MP API rechaza `POST /preapproval` con `auto_recurring.start_date = new Date().toISOString()` literal por `"cannot be a past date"` — cuando el request llega al server MP (~50-200ms de latencia red sa-east-1 + posible clock skew entre VPS y MP), ese ISO ya es pasado. Fix: buffer de 5min en el default de `createPreapproval` + en el caller (`src/app/(app)/settings/billing/actions.ts`) que pasa `startDate` explícito a MP Y lo persiste en `suscripciones.periodo_inicio` (ambos sites deben usar el mismo valor para coherencia DB/MP). **Regla forward**: cuando una API external valida `start_date >= now()` u otros timestamps "future", aplicar buffer ≥ 5min (no 1min — clock skew en cloud workers puede pegar 1-3min en peor caso). NO confiar en sincronía perfecta entre tu reloj y el del provider.

### MP sandbox bloquea auto-purchase (seller email == buyer email)

**Origen**: T-071-FU2 (22/05/2026). **Aplicable forward**: testing de integraciones con APIs de pago / marketplaces que validen relación seller↔buyer.

Smoke MP real bloqueado en sandbox: click "Suscribirme" → checkout carga → botón Confirmar disabled. MP sandbox rechaza preapproval cuando el `payer_email` matchea con el seller del app (Lautaro logueado como TEST buyer + email del owner consultora = mismo dueño de la app MP). No hay error visible en logs server-side — el block es UI-level en el checkout. Fix: env var opcional `MP_TEST_PAYER_EMAIL` que `createSubscriptionAction` usa como `payer_email` cuando está set, dejando el owner real intocado para prod. Warn explicito en `env.ts` si la var queda set en `NODE_ENV=production`. **Regla forward**: para testing de integraciones MP / payment APIs / marketplaces, prever inyección de email/user buyer distinto al seller desde el inicio del schema env (no agregar como hot-fix post-bloqueo). Crear TEST USER explícito en el panel del provider y documentar su email en `.env.example` comentado.

### VPS reboot recovery (Hostinger + Docker swarm) — pattern recurrente confirmado

**Origen**: T-052 mid-merge (19/05/2026 AM). **Incidents confirmados**: 2 (19/05/2026 AM + PM). **Runbook copy-paste**: [docs/operations/vps-reboot-recovery.md](operations/vps-reboot-recovery.md).

Tras reboot del VPS Hostinger por mantenimiento, el VIP allocation del swarm queda inconsistente — todos los services del swarm devuelven "Host unreachable" desde Traefik aunque containers estén Ready (afecta TODOS los dominios productivos, no solo consultora-demo). Diagnóstico: `docker exec traefik wget http://service_name:80/api/health` falla con "Host is unreachable" pero `wget` directo al IP del container respondé OK → VIP fantasma. Fix: `docker service update --endpoint-mode dnsrr` en cada service del swarm. `dnsrr` (DNS round-robin) bypasea el VIP — DNS resuelve directo al IP del task, sin downtime adicional.

### EasyPanel resetea endpoint-mode en cada deploy productivo

**Origen**: T-052-FU2 post-T-055 deploy (20/05/2026 00:34 GMT). EasyPanel CE self-hosted aplica `docker service update` en cada deploy via webhook sin preservar `--endpoint-mode dnsrr` manual — cada merge a main revierte el service a `vip` default → reproduce el VIP fantasma del escenario 1 (T-052-FU1) scoped al service deployado → 502. Decisión 20/05: NO investigar empíricamente ni implementar stopgap automatizado por baja frecuencia esperada (1-2 deploys/sprint en esta fase). Mitigación intermedia: monitor uptime + alerta Telegram via Better Stack free tier + fix manual ~30s (`docker service update --endpoint-mode dnsrr agendalo_consultora-demo`). Reactivar full si frecuencia >3 incidents/sprint o llegan users productivos reales. Runbook: [docs/operations/vps-reboot-recovery.md](operations/vps-reboot-recovery.md) escenario 2. Monitor setup: [docs/operations/uptime-monitoring.md](operations/uptime-monitoring.md).

### EasyPanel Auto Deploy via GitHub webhook

**Origen**: T-022.5-FU3. Push a `main` dispara deploy automático sin intervención. Habilitado en EasyPanel CE self-hosted. Pre-FU3 era click manual "Implementar" en EasyPanel UI tras cada merge.

**El auto-deploy publica el CÓDIGO, NO las migraciones** (T-059). Las migraciones de Supabase siguen siendo `db push --linked` manual y diff-validado (T-016). Implicancia: si un PR mete una migración + código que la usa con un nav-item `live`, mergear auto-deploya el código → si la migración no se aplica a prod en la **misma ventana del merge**, el feature queda **roto en prod** (tablas inexistentes). Práctica segura: aplicar la migración en la ventana del merge, o mantener el nav-item `soon`/gated hasta aplicarla. *Caso testigo: checklists (T-057..T-059) — nav `live` + migraciones diferidas → `/checklists` roto en prod hasta el `db push`.*

### Dev local Chromium para PDF render

**Origen**: T-023, T-024-FU2. Documentado en `docs/technical/06-deployment.md` sección "Chromium para PDF render".

Dev local Windows/macOS necesita `CHROMIUM_PATH` apuntando a Chrome instalado — `puppeteer-core` NO descarga binario propio. El Dockerfile alpine ya lo tiene seteado en `/usr/bin/chromium-browser` para prod. Tests E2E con PDF en Windows local requieren `CHROMIUM_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"`.

### Service Worker (Web Push) sin caching para MVP

**Origen**: T-034 (decisión 5 + 10). Safari/iOS NO MVP — llegan en Fase 3 con PWA installable. SW estático `public/sw.js` (~50 líneas, scope default `/`) con handler `push` + `notificationclick` only. Sin install handler ni caching. VAPID keys generadas localmente con `npx web-push generate-vapid-keys` UNA VEZ — nunca regenerar productivo: invalida todas las subs existentes porque Push Service asocia public key al endpoint en subscribe.

### Management API de Supabase para queries de catálogo en prod sin psql

**Origen**: T-124. **Aplicable forward**: verificación read-only post-`db push` de objetos que PostgREST NO expone (`cron.job`, `pg_proc`, `pg_constraint`, `pg_type`). El cliente supabase-js / REST solo ve tablas de `public` con grants; para confirmar que un cron quedó scheduleado, que una función tiene el `prosrc` esperado o que un CHECK se estrechó, usar la Management API `POST /v1/projects/{ref}/database/query` con el access-token (SQL read-only). Extiende la receta `db-push-prod-verify-recipe` (tsx + service-role para objetos de `public`): para el catálogo del sistema, Management API. Sin Docker/psql local.

## Security

### Audit_log immutability via trigger

**Origen**: T-011 (`audit_log` original). **Aplicada en**: T-031 (`notification_log`).

Pattern: trigger BEFORE UPDATE/DELETE en `audit_log` + tablas de bitácora que retorna `null` para que la operación no haga nada. Incluso service-role bypasea RLS pero NO el trigger. **Caveat T-031-FU1**: el trigger bloquea cascade UPDATEs de FK columns con `ON DELETE SET NULL` — fix futuro: refinar trigger para permitir solo cambios en FK columns whitelist `[reminder_id, event_id, recipient_user_id]`, bloqueando UPDATE de payload `status`/`provider_message_id`/`error_code`/`error_detail`/`sent_at`.

### Magic bytes anti-MIME-spoof

**Origen**: T-024. **Aplicable forward**: cualquier upload de binarios.

Validar MIME del Content-Type del request + size + magic bytes header del binario (primeros bytes). Falla cerrado para MIMEs desconocidos. Whitelist: PNG `89 50 4E 47 0D 0A 1A 0A` / JPG `FF D8 FF` / WEBP `RIFF....WEBP` / PDF `%PDF` / DOC/XLS CFB `D0 CF 11 E0 A1 B1 1A E1` / DOCX/XLSX ZIP `PK\x03\x04`+variantes. Implementación en `src/shared/storage/validators.ts:magicBytesMatch`.

### Sharp pipeline: strip EXIF/ICC + rotate por orientation

**Origen**: T-024. `processAttachmentImage()` con `rotate()` (honra EXIF Orientation — foto de iPhone con orientation=6 sale rotada en cualquier visor que no respete EXIF) + `withMetadata({ exif: undefined, icc: undefined })` strip (defensa privacy + size) + resize con `withoutEnlargement` + re-encode al mismo formato (evita conversion no consentida + previene smuggling).

### Wildcards escape en `.ilike()` Supabase

**Origen**: T-048 search. Antes de `.ilike('field', '%${input}%')` escapar wildcards defensivo: backslash primero (`\\` → `\\\\` para evitar duplicar al escape siguiente) + `%` → `\\%` + `_` → `\\_`. Cap input via `q.trim().slice(0,100)` + return `[]` si `< 2 chars`. Test 17(e) T-048 confirma el escape funciona end-to-end contra Supabase JS sin pivot a validación.

### Server-only modules vía `import 'server-only'`

**Origen**: T-020 (anthropic singleton). **Aplicada en**: T-031 (resend), T-033 (telegram bot-client), T-034 (web-push), queries de todos los módulos.

Helpers / clients con secrets o lógica server-only marcados con `import 'server-only'` defensivo en línea 1. Build falla si un Client Component lo importa por error. Patrón canónico para queries: `import 'server-only'` + sin `'use server'` (server actions sí lo tienen) para que sean importables desde Server Components Y Server Actions.

### Service-role solo cuando RLS bloquea legítimamente

**Origen**: T-028 (reminders), T-031 (notifications endpoint), T-034 (push subscribe).

Service-role bypasea RLS — usar SOLO cuando RLS default-deny bloquea legítimamente un caso que YA pasó por permission gate server-side (ej INSERT en `calendar_event_reminders` desde server action que ya validó member, INSERT en `notification_log` desde dispatcher, UPSERT en `push_subscriptions` desde endpoint que ya verificó session). NUNCA pasar `service-role` por params del cliente — siempre crear cliente nuevo per request con `createServiceRoleClient()`.

### at-most-once delivery (UPDATE 'sent' ANTES del HTTP side-effect)

**Origen**: T-031. UPDATE `status='sent'` en la misma transacción que el SELECT FOR UPDATE SKIP LOCKED, ANTES del `net.http_post`. Si HTTP falla, no reintenta — log a `notification_log` con `failed` + Sentry capture. Notification no es critical path; at-most-once aceptado vs at-least-once que duplica spam al user.

### API privada por default — `isPublicApi` helper en middleware

**Origen**: CHORE-A (C7 audit). **Aplicable forward**: toda route API nueva.

`src/shared/supabase/middleware.ts:updateSession` corta con 401 toda request `/api/*` sin sesión, EXCEPTO las que matchean `isPublicApi(pathname)`. Helper combina `PUBLIC_API_PREFIXES` (regex de prefijos públicos por convención: `/api/health`, `/api/webhooks/*`, `/api/cron/*`, `/api/push/*`, `/api/test-error`, `/api/monitoring/*`) + `PUBLIC_API_EXACT` (set de paths exactos públicos por razón legacy, ej `/api/calendar/dispatch-reminder` que se creó pre-convention `/api/cron/`).

Defense-in-depth: si un route handler omite `auth.getUser()` por regression de PR, el middleware corta antes. Convención forward: API nueva privada por default. Para hacerla pública, sumar al PUBLIC_API_PREFIXES (si toda la familia es pública) o a PUBLIC_API_EXACT (si es un caso aislado). NO sumar prefix nuevo (ej `calendar`) si solo una route del prefix es pública — preferir exact path para evitar que routes futuras bajo el mismo prefix queden públicas por accidente.

### Constant-time compare para secrets en webhooks (`constantTimeEqual`)

**Origen**: CHORE-A (C1 audit). **Aplicable forward**: cualquier webhook/cron endpoint que valide un secret en header.

`===` y `!==` abortan en el primer byte distinto → leak por timing del prefix correcto del secret a atacantes remotos. Usar `constantTimeEqual(provided, env.SECRET)` de `@/shared/security/timing-safe.ts` (wrapper sobre `node:crypto.timingSafeEqual` con length check defensive).

Aplicado en 3 webhooks pre-launch: `/api/webhooks/telegram`, `/api/calendar/dispatch-reminder`, `/api/cron/billing-notifications`. MP signature verify ya usa `timingSafeEqual` directo desde T-067 (puede refactorizarse al helper pero no urgente).

### PII redact en logger — `pino.redact` + `redactSensitive` para Sentry

**Origen**: CHORE-A (C6 audit). **Aplicable forward**: cualquier `logger.error({ ... })` con context PII.

`pino.redact` SOLO afecta el transport local (stdout / file). `Sentry.captureMessage(msg, { extra: { context: arg } })` recibe el arg crudo porque va por path paralelo en el wrapper. Por eso `src/shared/observability/logger.ts` aplica DOS redactions: `pino.redact.paths` para stdout + `redactSensitive(arg)` interno antes del `Sentry.captureMessage`. Single source of truth en `REDACT_KEYS` set: `ip`, `email`, `recipientEmail`, `payer_email`, `authorization`, `password`, `token`, `chatId`.

Convención forward: si necesitás loggear PII para alerting interno, usar key NO listada en `REDACT_KEYS` (ej hash del userId, IP truncated a /24).

### IP validation antes de INSERT en `audit_log.ip` (`inet`)

**Origen**: CHORE-A (C8 audit). **Aplicable forward**: cualquier write a columna `inet`.

`request.headers.get('x-forwarded-for')` es controlado por el cliente y puede traer basura, CSV con proxy chain, o vacío. INSERT directo a columna `inet` falla con error opaco si el valor no parsea. Usar `getValidatedClientIp(request)` de `@/shared/security/identify.ts` que aplica `getClientIp` (primer hop del CSV) + regex IPv4/IPv6 simple + retorna `null` si no es válido. Aplicado en los 3 audit_log writers: `/api/informes/[id]/pdf`, `/api/informes/[id]/generate-stream`, `/api/epp/entregas/[id]/pdf`.

## Timezone

### Display siempre TZ AR vía helper, storage UTC

**Origen**: T-085. **Aplicable forward**: cualquier display de fecha.

Política completa en [docs/technical/08-timezone.md](technical/08-timezone.md). Helper centralizado en [src/shared/lib/format-date.ts](../src/shared/lib/format-date.ts) — hardcodea `timeZone: 'America/Argentina/Buenos_Aires'` en cada `Intl.DateTimeFormat`, inmune al runtime TZ (UTC del container, local del browser). Dos familias separadas: `format*AR` para timestamptz UTC (`created_at`, `firmado_at`), `formatCivil*AR` para `date` civil YYYY-MM-DD (`fecha_vencimiento`, `fecha_ingreso`). Prohibido en código nuevo: `toLocaleDateString`, `Intl.DateTimeFormat` directo, `date-fns/format()` sobre timestamps. Excepción documentada: `event-form-helpers.ts` (roundtrip browser-local para el date picker).

### TZ tests cross-day window flakiness

**Origen**: T-105 (PR #147 fix-up post-merge #146).

Tests que usan helpers tipo `isoDaysFromNow(n)` con `setUTCDate` rompen entre **00:00–03:00 UTC** porque el runtime bucketiza con `todayCivilIsoAR()` (T-085). El CI del PR puede pasar (horario UK day) y el de main fallar (cross-day window) — escenario observado en commits `bba439e..9b18bc0`. Síntoma típico: assertions del estilo `expected '2' to be '1'` en counts de buckets "hoy", o eventos con `fecha_vencimiento: isoDaysFromNow(0)` cayendo en bucket-siete.

**Patrón canónico en tests**: helpers de fecha SIEMPRE anclados a `todayCivilIsoAR()` + civil offset día a día sin tocar UTC. Ejemplo:

```ts
function isoDaysFromNow(n: number): string {
  const todayCivil = todayCivilIsoAR();
  const [y, m, d] = todayCivil.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
```

Reproducción local: clock real entre 00:00 y 03:00 UTC (= 21:00–00:00 AR día anterior), o `vi.useFakeTimers() + vi.setSystemTime(new Date('2026-05-27T00:30:00Z'))`. Validación cerrada cuando el patrón pre-fix falla y el post-fix pasa en el mismo runner.

**Audit pendiente**: 5 integration tests con el mismo bug listados en issue [#148 (T-105-FU2)](https://github.com/LautiRoveda/consultora-demo/issues/148). No bloquean CI hoy (requieren `.env.local`) pero rompen smoke local en cross-day. Tech-debt clase B.

## AI / Prompts

### Tablas SRT al prompt IA (T-107)

**Origen**: T-107. **Aplicable forward**: T-107-FU0 (Res 84/12 iluminación), T-107-FU1 (Res 886/15 ergonomía), T-107-FU2 (Res 295/03 químicos), T-107-FU3 (IRAM WBGT carga térmica).

Tablas regulatorias HyS (Res SRT) cargadas como `const` TypeScript en `src/shared/ai/srt-tables/`, **NO en DB**, inyectadas al prompt vía 2do breakpoint `cache_control: 'ephemeral'` en `system[]`. Patrón canónico para futuros agentes.

**Por qué NO en DB**: versionado via git + diff visible en PR + sin UI admin overhead. Trade-off: cambio requiere deploy, no toggle runtime. Aceptable porque las tablas SRT cambian raramente (Dec 351/79 sigue siendo base hace 47 años; cambios típicos 1-2x por década).

**Por qué 2 breakpoints `system[]`**: el bloque SRT varía con `agentes_a_relevar` del informe. Si concatenamos al `system[0]` (prompt static), cualquier cambio de agentes invalida el cache cross-informe del prompt completo (~3600 tokens). Separado en `system[1]` → cache hit cuando misma combinación de agentes (caso real: regeneración del mismo informe + informes consecutivos del mismo consultor). El `system[0]` sigue cacheando normal sin importar el shape de `system[1]` porque es prefix base. Anthropic SDK 0.95.1 acepta hasta 4 breakpoints por request.

**Mínimo cache Sonnet 4.6**: 1024 tokens (NO 2048 como decía el comentario del prompt pre-T-107). Verificado contra docs Anthropic 2026-05-27. Medir tokens del bloque ANTES del primer commit del módulo con `client.messages.countTokens()` — patrón en `scripts/dev-measure-srt-tokens.ts` + `pnpm dev:measure-srt-tokens`.

**Política de actualización**: detección manual mensual newsletter SRT + RSS BO sección Trabajo (responsable hasta T-107-FU4: Lautaro). Cambio menor (valor numérico, vigencia, fraseo) → bump `version_tabla` + commit con quote textual literal de la nueva fuente primaria + URL Infoleg en el mensaje + redeploy. Cambio mayor (norma reemplazada por número nuevo) → nuevo file `res-XX-YY-[agente].ts`; versión vieja queda en git history (NO archivada como `_V1` para evitar confusión runtime).

**Disclaimer obligatorio en output del informe**: footnote en sección 4 `Mediciones realizadas` con fecha de verificación (`{VERIFIED_AT}` reemplazado por el helper) + link a `srt.gob.ar`. Sin esto, riesgo legal real si la tabla queda stale. El helper `formatVerifiedAt` **throws** en formato inválido del `version_tabla` por diseño — disclaimer con fecha rota es bug VISIBLE que el matriculado nota al revisar; silent fallback escondería el problema.

**Regla SRT condicional en el prompt static**: pre-T-107 el prompt prohibía toda cita literal de Res SRT. Post-T-107 la regla es condicional: "Si aparece bloque `## Criterios SRT para evaluación de [AGENTE]`, citá literal; si no, modo genérico". Aplicable a cualquier futuro prompt que reciba contexto regulatorio dinámico.

**Audit observabilidad**: log de `informe_content_generated` ahora incluye `srtBlocks: number` (0 ó 1) — útil para verificar en logs productivos que el cache hit del 2do breakpoint se está dando cuando se espera.

**Origen del patrón**: [ADR-0013](adr/0013-srt-tables-en-prompt-ia.md).

### Registry de tools del asistente (name→handler + guardia anti-duplicados)

**Origen**: T-125. **Aplicable forward**: sumar módulos al asistente IA. En vez de un `switch(name)` que crece con cada tool, un **registry** `Map<string, ToolEntry>` (`src/shared/ai/tools/registry.ts`) ensamblado de listas por módulo (`epp-tools.ts` + `common-tools.ts` + `checklists-tools.ts`). `CHAT_TOOLS` (las definitions para Anthropic) y `TOOL_REGISTRY` (name→handler) se derivan de la MISMA lista, así no se desincronizan. `dispatchTool()` hace lookup O(1) y **nunca tira** (envuelve todo error / nombre desconocido en `DispatchToolResult` → el loop de tool-calling lo recibe como `tool_result` y sigue). **Guardia anti-duplicados** al cargar el módulo: `if (TOOL_REGISTRY.size !== ALL_ENTRIES.length) throw` — si dos módulos registran el mismo nombre, rompe al import (no en runtime silencioso). Sumar un módulo = agregar su lista de `ToolEntry` + spread en el registry; cero cambios al orquestador.
