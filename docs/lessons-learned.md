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

### Placeholder check Vault robusto (regex vs equality)

**Origen**: T-034 smoke pre-Lautaro. **Aplicable a**: próximas migrations que toquen `process_pending_reminders()` helper.

El check `decrypted_secret = 'REPLACE_ME_POST_DEPLOY'` (exact match Y mayúscula) NO captura variantes con typo (ej `REPLACE_ME_POST_DEPLOy` con `y` minúscula). Síntoma: cron dispara POSTs pero `net._http_response` muestra `error_msg='Couldn't connect to server'` / `status_code=401` porque el secret de Vault no matchea ni con placeholder check ni con `INTERNAL_CRON_SECRET` de EasyPanel. Fix recomendado: regex `decrypted_secret like 'REPLACE_ME%'` o `length(decrypted_secret) != 64` como check más robusto. Documentado en `docs/operations/cron-secret-rotation.md` + `docs/operations/push-setup.md`.

## Tests integration

### Setup secuencial vs Promise.all

**Origen**: T-047. **Aplicada en**: T-048, T-052, T-053.

Setup tests integration siempre secuencial. Paralelizar INSERTs de consultoras + `auth.admin.createUser` (3+ calls) causa flakiness real con `ConnectTimeoutError 10s en sa-east-1` + `data.user` null por rate-limit silencioso de `auth.admin`. Costo +500ms por test, determinístico vs flaky. Issue [#56](https://github.com/LautiRoveda/consultora-demo/issues/56) captura Windows-local-only flakiness en paralelo, CI Ubuntu OK con workers=1.

### Cleanup orden FK explícito

**Origen**: T-049/T-050. **Aplicada en**: T-051, T-053.

Limpiar dependientes antes que padres (informes → clientes → users) evita FK violations contra `audit_log` durante el cleanup. Los audit triggers se disparan durante el cascade DELETE de consultora y bloquean por `audit_log_consultora_id_fkey ON DELETE RESTRICT` (T-011 invariante global). Splice de arrays en `afterEach`/`afterAll`.

### Test assertions sa-east-1 + Promise.all NO confiables

**Origen**: T-047. Test 3 (anon NO ve clientes) ajustada: `error.code === '42501' permission denied for function is_member_of_consultora` porque los helpers T-015 tienen grant `to authenticated, service_role` (NO anon); defensa en profundidad esperada — anon NUNCA debe llegar a evaluar el filtro RLS porque el helper rechaza antes.

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

### Dev local Chromium para PDF render

**Origen**: T-023, T-024-FU2. Documentado en `docs/technical/06-deployment.md` sección "Chromium para PDF render".

Dev local Windows/macOS necesita `CHROMIUM_PATH` apuntando a Chrome instalado — `puppeteer-core` NO descarga binario propio. El Dockerfile alpine ya lo tiene seteado en `/usr/bin/chromium-browser` para prod. Tests E2E con PDF en Windows local requieren `CHROMIUM_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"`.

### Service Worker (Web Push) sin caching para MVP

**Origen**: T-034 (decisión 5 + 10). Safari/iOS NO MVP — llegan en Fase 3 con PWA installable. SW estático `public/sw.js` (~50 líneas, scope default `/`) con handler `push` + `notificationclick` only. Sin install handler ni caching. VAPID keys generadas localmente con `npx web-push generate-vapid-keys` UNA VEZ — nunca regenerar productivo: invalida todas las subs existentes porque Push Service asocia public key al endpoint en subscribe.

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
