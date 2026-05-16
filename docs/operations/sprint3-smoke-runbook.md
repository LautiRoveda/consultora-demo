# Sprint 3 · Smoke productivo runbook

Validación manual end-to-end de los 9 tickets cerrados del Sprint 3 (Calendario + Notificaciones multi-canal + Integración Informes↔Calendario) en el VPS productivo `https://consultora-demo.test-ia.cloud`.

**Cuándo correr**:
- Post-merge T-037 (responsabilidad de Lautaro como validación final del Sprint 3).
- Post-deploy mayor que toque el módulo Calendario, Notificaciones o Informes.
- Si Lautaro observa síntomas raros en producción (reminders no llegan, modal post-firma roto, etc).

**Tiempo total estimado**: **~45-60 min** ejecutando todos los 15 pasos secuencialmente. Si solo se valida un módulo específico, ir directo a la sección correspondiente.

**Prerequisitos globales**:
- Acceso productivo a `consultora-demo.test-ia.cloud` con cuenta owner.
- Acceso productivo a Supabase Studio (project `consultora-demo`).
- Acceso al bot `@consultora_demo_reminders_bot` desde móvil + cuenta de email accesible (Gmail / Outlook).
- Sesión SSH/EasyPanel para inspeccionar logs si algo falla.

---

## Índice

1. [Setup pre-smoke (env vars + secrets)](#1-setup-pre-smoke)
2. [Calendario mensual — CRUD eventos](#2-calendario-mensual)
3. [Calendario agenda — filtros + buckets](#3-calendario-agenda)
4. [Dashboard panel "Próximos vencimientos"](#4-dashboard-panel)
5. [Settings notificaciones — email + mute](#5-settings-notificaciones)
6. [Vinculación Telegram](#6-vinculacion-telegram)
7. [Reminder real al bot + email](#7-reminder-real)
8. [Publish informe + modal post-firma](#8-publish-informe-modal)
9. [Toggle workflow auto-create-event (silent path)](#9-toggle-workflow)
10. [Unpublish informe (reversibilidad)](#10-unpublish-informe)
11. [Recurrencia auto-complete + parent_event_id](#11-recurrencia)
12. [Bot bloqueado + auto-unlink](#12-bot-bloqueado)
13. [Mute temporal bloquea ambos canales](#13-mute-temporal)
14. [Sección "Vencimientos vinculados" en informe](#14-vencimientos-vinculados)
15. [Permission gates (creator OR owner)](#15-permission-gates)

Plus: [Troubleshooting tests E2E](#troubleshooting-tests-e2e)

---

## 1. Setup pre-smoke

**Verificar que el deploy está sano antes de empezar**.

### 1.1 Env vars en EasyPanel

Acceder al panel del service `consultora-demo` en EasyPanel y verificar las env vars:

- `RESEND_API_KEY` — set, no placeholder.
- `RESEND_FROM_ADDRESS` — `noreply@mail.consultora-demo.test-ia.cloud` (o el dominio verificado).
- `RESEND_REPLY_TO_ADDRESS` — set (puede ser idem a `FROM`).
- `INTERNAL_CRON_SECRET` — set, no placeholder, mínimo 32 chars.
- `TELEGRAM_BOT_TOKEN` — set, formato `<id>:<35-char-hash>`.
- `TELEGRAM_BOT_USERNAME` — set, sin `@`, ej `consultora_demo_reminders_bot`.
- `TELEGRAM_WEBHOOK_SECRET` — set, mínimo 32 chars.

### 1.2 Vault secrets sincronizados con env vars

Studio → SQL Editor:

```sql
select name, decrypted_secret
  from vault.decrypted_secrets
 where name in ('cron_dispatch_secret', 'cron_dispatch_base_url');
```

- `cron_dispatch_secret` debe matchear **exactamente** `INTERNAL_CRON_SECRET` de EasyPanel.
- `cron_dispatch_base_url` debe ser `https://consultora-demo.test-ia.cloud`.

⚠️ **Lesson T-031 + T-033**: NO copiar el secret entre las 2 UIs (espacios invisibles + truncado). Generar fresh con `openssl rand -hex 32` y pegar en ambos lados de cada rotación. Más detalle en `docs/operations/cron-secret-rotation.md`.

### 1.3 Cron job activo

```sql
select jobid, schedule, command, active
  from cron.job
 where jobname = 'process-pending-reminders';
```

Debe estar `active=true` con schedule `*/5 * * * *`.

### 1.4 Resend DNS records OK

Resend dashboard → Domains → tu dominio. Estado debe ser **Verified** + SPF/DKIM/DMARC green.

⚠️ **Timing race**: post-verificación de DNS records, el sender efectivo tarda ~4 min más en habilitarse en el backend de Resend. Esperar antes del primer envío real.

### 1.5 Bot Telegram alive

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getMe" | jq .
```

Debe devolver `{ok: true, result: { username: "consultora_demo_reminders_bot", ... }}`.

### 1.6 Webhook Telegram configurado

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo" | jq .
```

`url` debe ser `https://consultora-demo.test-ia.cloud/api/webhooks/telegram` con `pending_update_count: 0` (idealmente).

### Criterios de éxito

- ✅ Todas las 7 env vars de EasyPanel set sin placeholders.
- ✅ Los 2 Vault secrets matchean EasyPanel + DB.
- ✅ Cron job activo.
- ✅ Dominio Resend verified.
- ✅ Bot Telegram responde a `getMe`.
- ✅ Webhook Telegram configurado.

Si cualquier item falla, **STOP**. Revisar `docs/operations/resend-setup.md` + `telegram-setup.md` para fixes.

---

## 2. Calendario mensual

**Validar CRUD básico de eventos via UI**.

### 2.1 Crear evento custom

1. Login en `consultora-demo.test-ia.cloud` con cuenta owner.
2. Sidebar → `Calendario` (vista por default = mensual).
3. Click en cualquier día futuro (a +30 días para tener margen). Drawer abre en modo create.
4. Completar:
   - **Tipo**: `custom`.
   - **Título**: `SMOKE 2 mensual custom`.
   - **Descripción**: (opcional).
   - **Recordatorios**: `[7, 0]` (default custom + el día del vencimiento).
   - Toggle **Recurrente**: OFF.
5. Click `Crear vencimiento`.

### 2.2 Editar evento

1. Click en el evento creado en el calendario.
2. Drawer pasa a modo `view`. Click `Editar`.
3. Cambiar título a `SMOKE 2 mensual custom EDITADO`.
4. Click `Guardar cambios`.

### 2.3 Completar evento

1. Click en el evento → `view` → `Marcar completado`. AlertDialog confirm.
2. Verificar UI: el evento pasa a render con line-through + variant emerald.

### 2.4 Cancelar evento (NUEVO evento para no contaminar el de 2.3)

1. Crear otro evento `SMOKE 2 mensual cancel`.
2. Click → `Cancelar` con motivo `Smoke test cancel`. AlertDialog confirm.
3. Verificar UI: variant muted + line-through.

### 2.5 Sanity check DB

```sql
select titulo, status, completed_at, metadata->'cancel_reason' as cancel_reason
from public.calendar_events
where titulo like 'SMOKE 2 mensual%'
order by created_at desc;
```

Esperado:
- `SMOKE 2 mensual cancel` → `status='cancelled'`, `cancel_reason='Smoke test cancel'`.
- `SMOKE 2 mensual custom EDITADO` → `status='completed'`, `completed_at` populado.

### Criterios de éxito

- ✅ Drawer abre y cierra sin glitches.
- ✅ Eventos se persisten en DB con shape correcto.
- ✅ AlertDialog confirm aparece para cancel/complete.
- ✅ Variants visuales correctos por estado.

### Cleanup

```sql
delete from public.calendar_events where titulo like 'SMOKE 2 mensual%';
```

---

## 3. Calendario agenda

### 3.1 Tab Agenda + buckets

1. En `/calendario`, click tab `Agenda`. URL pasa a `/calendario/agenda`.
2. Verificar render con 4 buckets: `Hoy`, `Próximos 7 días`, `Próximos 30 días`, `Más adelante`.
3. Bucket "Más adelante" es Collapsible por default closed.

### 3.2 Crear 4 eventos en distintos buckets

Desde la UI o admin SQL (más rápido). Studio:

```sql
-- Asumiendo tu user_id + consultora_id (reemplazar con valores reales).
-- Auth.uid() funciona en Studio si estás logueado.
insert into public.calendar_events
  (consultora_id, tipo, titulo, fecha_vencimiento, status, created_by, reminder_offsets_days)
values
  ((select consultora_id from public.consultora_members where user_id = auth.uid() limit 1),
   'custom', 'SMOKE 3 hoy', current_date, 'pending', auth.uid(), array[0]::int[]),
  ((select consultora_id from public.consultora_members where user_id = auth.uid() limit 1),
   'custom', 'SMOKE 3 en 5d', current_date + 5, 'pending', auth.uid(), array[3]::int[]),
  ((select consultora_id from public.consultora_members where user_id = auth.uid() limit 1),
   'custom', 'SMOKE 3 en 20d', current_date + 20, 'pending', auth.uid(), array[7]::int[]),
  ((select consultora_id from public.consultora_members where user_id = auth.uid() limit 1),
   'custom', 'SMOKE 3 lejano', current_date + 60, 'pending', auth.uid(), array[30]::int[]);
```

### 3.3 Verificar buckets

Refresh `/calendario/agenda`. Verificar:
- `Hoy` → 1 evento (`SMOKE 3 hoy`).
- `Próximos 7 días` → 1 evento (`SMOKE 3 en 5d`).
- `Próximos 30 días` → 1 evento (`SMOKE 3 en 20d`).
- `Más adelante` (Collapsible cerrado por default) → click expand → 1 evento (`SMOKE 3 lejano`).

### 3.4 Filtros

1. Click filtro tipo → check `custom` → ver que los 4 siguen visibles (todos son custom).
2. Click filtro status → check solo `completed` → bucket-mode pasa a flat-mode + lista vacía (no hay completed).
3. Reset filtros.

### 3.5 Navegación cross-mes con URL state

1. Click tab `Mensual` → URL `/calendario`.
2. Navegar al mes siguiente con la flecha del header.
3. URL pasa a `/calendario?month=YYYY-MM`. Refresh → mes preserved.

### Criterios de éxito

- ✅ Los 4 eventos caen en los 4 buckets correctos.
- ✅ "Más adelante" empieza Collapsible cerrado.
- ✅ Filtros aplican sin reload de página.
- ✅ URL state cross-mes persiste tras refresh.

### Cleanup

```sql
delete from public.calendar_events where titulo like 'SMOKE 3 %';
```

---

## 4. Dashboard panel

### 4.1 Panel "Próximos vencimientos"

1. Si el cleanup de step 3 ya está hecho, crear 1 evento via UI con `fecha = today + 5d` titulado `SMOKE 4 panel`.
2. Navegar a `/dashboard`.
3. Arriba del header "Bienvenido a ConsultoraDemo" debe aparecer el panel:
   - Counts: Hoy 0 / 7d 1 / 30d 1.
   - "Más urgente": `SMOKE 4 panel` con link a `/calendario/agenda?event=<uuid>`.
   - Link "Ver todos →" → `/calendario/agenda`.

### 4.2 Empty state

1. Cancelar el evento (UI o SQL `update ... status='cancelled'`).
2. Refresh `/dashboard`.
3. Panel pasa a empty state con CTA `Crear vencimiento` → `/calendario`.

### Criterios de éxito

- ✅ Counts reflejan estado DB correctamente.
- ✅ "Más urgente" navega al evento correcto.
- ✅ Empty state CTA funciona.

### Cleanup

```sql
delete from public.calendar_events where titulo = 'SMOKE 4 panel';
```

---

## 5. Settings notificaciones

### 5.1 Render inicial

1. Sidebar → `Configuración` → tab `Notificaciones`. URL `/settings/notificaciones`.
2. Verificar 3 secciones:
   - **Canales habilitados**: row Email con toggle ON (default trigger T-031) + email del user.
   - Row Telegram: state según vinculación (probablemente unlinked si no ejecutaste step 6 todavía).
   - Row Push: disabled + tooltip "Próximamente (T-034)".
3. **Pausar notificaciones**: sin Alert si no hay mute activo.

### 5.2 Mute 7 días

1. Radio `7 días` → click `Guardar cambios`.
2. Toast "Preferencias actualizadas".
3. Refresh → Alert "Pausadas hasta DD de MMMM de YYYY" visible + radio `Hasta fecha específica` pre-seleccionado.

### 5.3 Unmute

1. Radio `No pausar` → `Guardar cambios`.
2. Alert desaparece tras refresh.

### 5.4 Sanity check DB

```sql
select channel, enabled, muted_until
from public.notification_channel_prefs
where user_id = auth.uid()
order by channel;
```

Post-unmute: email row con `enabled=true`, `muted_until=null`.

### Criterios de éxito

- ✅ Toggle email persiste.
- ✅ Mute 7d/14d/until persiste con UTC end-of-day.
- ✅ Alert "Pausadas" aparece/desaparece correctamente.

---

## 6. Vinculación Telegram

### 6.1 Generar código

1. `/settings/notificaciones` → row Telegram → click `Vincular Telegram`.
2. Dialog abre con:
   - Spinner inicial.
   - Tras ~1s: código 8 chars (alfabeto sin ambiguos `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
   - Botón `Abrir Telegram` con deep-link `https://t.me/<bot>?start=<code>`.
   - Spinner "Esperando confirmación...".

### 6.2 /start con el bot desde móvil

1. Abrir `@consultora_demo_reminders_bot` en Telegram mobile.
2. Mandar mensaje `/start <code>` (reemplazar `<code>` por el código del dialog).
3. Bot responde "✅ ¡Listo! Tu cuenta está vinculada. Vas a recibir recordatorios acá.".

### 6.3 UI actualiza

Volver al desktop → dialog cierra automáticamente (polling detectó el linked) → row Telegram pasa a `Conectado ✓ @<username>` con badge emerald.

### 6.4 Sanity check DB

```sql
select telegram_chat_id, telegram_username, linked_at, unlinked_at, blocked_count
from public.telegram_subscriptions
where user_id = auth.uid();
```

Esperado:
- `telegram_chat_id` populado (bigint).
- `telegram_username` con tu username de Telegram (puede ser null si no tenés @ público).
- `linked_at` con timestamp reciente.
- `unlinked_at` null.
- `blocked_count` 0.

### Criterios de éxito

- ✅ Dialog genera código 8-char regex `/[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}/`.
- ✅ Deep-link funciona desde mobile.
- ✅ Bot responde con confirmación.
- ✅ UI actualiza state sin reload.
- ✅ DB refleja vinculación.

---

## 7. Reminder real

**El test end-to-end más importante del Sprint 3**.

### 7.1 Crear evento custom mañana + recordatorio +1d

UI: `/calendario` → click día = today + 1 → drawer create:
- Tipo: `custom`.
- Título: `SMOKE 7 reminder real`.
- Recordatorios: `[1]` (1 día antes = mañana 09:00 ART).

Click `Crear vencimiento`.

### 7.2 Forzar `scheduled_at` inmediato

El reminder normal se enviaría mañana 09:00 ART. Para smoke inmediato, hackear `scheduled_at` via Studio:

```sql
update public.calendar_event_reminders
set scheduled_at = now() + interval '30 seconds'
where event_id = (
  select id from public.calendar_events
  where titulo = 'SMOKE 7 reminder real'
  order by created_at desc limit 1
)
returning id, scheduled_at;
```

### 7.3 Esperar 1 tick del cron (≤5 min)

El cron `process-pending-reminders` corre `*/5 * * * *`. Esperar a que el reloj pase un múltiplo de 5 min (ej: ahora son 14:32 → siguiente tick 14:35).

### 7.4 Verificar mensaje en Telegram

Bot `@consultora_demo_reminders_bot` en móvil/desktop → debe aparecer:

> **🔔 SMOKE 7 reminder real**
> Vence en 1 día (DD-MM-YYYY)
> [Ver en ConsultoraDemo](https://consultora-demo.test-ia.cloud/calendario/agenda?event=<uuid>)

### 7.5 Verificar mensaje en Email

Inbox del email del user (ej `lautaroeroveda@gmail.com`):

- **Asunto**: `[ConsultoraDemo] Vence en 1 día: SMOKE 7 reminder real`.
- HTML render con paleta indigo + CTA "Ver vencimiento en ConsultoraDemo" + footer unsubscribe linkeando a `/settings/notificaciones`.

### 7.6 Sanity check DB

```sql
-- notification_log debe tener 2 rows status='sent' por canal:
select channel, status, provider_message_id, sent_at, error_code
from public.notification_log
where reminder_id = (
  select id from public.calendar_event_reminders
  where event_id = (
    select id from public.calendar_events
    where titulo = 'SMOKE 7 reminder real'
    order by created_at desc limit 1
  )
);

-- calendar_event_reminders.status debe ser 'sent':
select id, status, sent_at, scheduled_at
from public.calendar_event_reminders
where event_id = (
  select id from public.calendar_events
  where titulo = 'SMOKE 7 reminder real' order by created_at desc limit 1
);
```

### Criterios de éxito

- ✅ Email recibido con HTML correcto + CTA funcional.
- ✅ Telegram message recibido con MarkdownV2 (titulo bold + fecha + link).
- ✅ `notification_log` con 2 rows `status='sent'`, `provider_message_id` poblado para ambos.
- ✅ `calendar_event_reminders.status='sent'` + `sent_at` con timestamp UTC.

### Casos de falla y diagnóstico

| Síntoma | Causa probable | Fix |
|---|---|---|
| Solo email llega, NO Telegram | `telegram_subscriptions` no linked / pref disabled | Re-ejecutar step 6 + verificar pref |
| Solo Telegram llega, NO email | Resend DNS issue / dominio no verified | Ver paso 1.4 + Resend dashboard |
| Ninguno llega | Secret mismatch EasyPanel ↔ Vault | Ver `cron-secret-rotation.md` + `notification_log` debería tener row `status='failed'` |
| `notification_log` vacío | Cron no procesó / endpoint 401 | `select * from net._http_response order by created desc limit 5;` — buscar `status_code` |

### Cleanup

```sql
delete from public.calendar_events where titulo = 'SMOKE 7 reminder real';
-- notification_log queda como evidencia (audit trigger inmutable T-031).
```

---

## 8. Publish informe + modal post-firma

### 8.1 Crear informe con contenido

1. Sidebar → `Informes` → `Nuevo informe`.
2. Wizard: tipo `RGRL`, título `SMOKE 8 publish modal`.
3. Click "Crear vacío" o completar metadata (sin importar para este test).
4. En `/informes/<id>/editar`: pegar contenido placeholder en textarea content (puede ser `# Test\n\nContenido smoke.`).
5. Click `Guardar cambios`.

### 8.2 Verificar toggle workflow OFF (default)

`/settings/consultora` → Card "Workflow" → Switch `Auto-crear vencimiento al publicar` debe estar **OFF**.

### 8.3 Publicar con modal

1. Volver a `/informes/<id>/editar`. Botón `Publicar` visible.
2. Click → AlertDialog "¿Publicar el informe?" → click `Publicar` (botón del dialog).
3. **Modal post-firma** aparece: `¿Querés agendar la renovación?` con form prepop:
   - Tipo evento: `RGRL anual`.
   - Título: `RGRL anual · <razon_social>` o título del informe si no hay razón social.
   - Fecha: today + 12 meses.
   - Checkbox `Crear recordatorios automáticos`: ON.
4. Click `Agendar`.

### 8.4 Toast + DB

- Toast "Vencimiento creado" con CTA `Ver` → navega a `/calendario/agenda?event=<uuid>`.
- DB:

```sql
select titulo, tipo, recurrence_months, informe_id, parent_event_id
from public.calendar_events
where titulo like '%SMOKE 8 publish%' or informe_id = (
  select id from public.informes where titulo = 'SMOKE 8 publish modal'
);
```

Esperado: 1 row `tipo='rgrl_anual'`, `recurrence_months=12`, `informe_id` matchea, `parent_event_id=null`.

### Criterios de éxito

- ✅ Modal aparece cuando toggle OFF + tipo recurrente (RGRL/relevamiento/capacitacion).
- ✅ Prepop con tipo + recurrencia + fecha correctos.
- ✅ Toast + CTA funcional.
- ✅ DB con evento vinculado al informe.

### Cleanup

```sql
delete from public.calendar_events where informe_id = (select id from public.informes where titulo = 'SMOKE 8 publish modal');
delete from public.informes where titulo = 'SMOKE 8 publish modal';
```

---

## 9. Toggle workflow

### 9.1 Activar toggle owner-only

1. `/settings/consultora` → Card "Workflow" → toggle Switch a ON.
2. Toast "Auto-creación activada".

### 9.2 Crear segundo informe + publish silent

1. Crear informe `SMOKE 9 silent`, tipo `relevamiento`, contenido placeholder.
2. `/editar` → `Publicar` → AlertDialog confirm.
3. **NO debe aparecer modal post-firma** (silent path).
4. Toast con CTA "Ver vencimiento" → navegación a `/calendario/agenda?event=<uuid>`.

### 9.3 Sanity check DB

```sql
select titulo, tipo, recurrence_months, informe_id
from public.calendar_events
where informe_id = (select id from public.informes where titulo = 'SMOKE 9 silent');
```

Esperado: 1 row `tipo='protocolo_anual'`, `recurrence_months=12`, `informe_id` matchea.

### 9.4 Reset toggle a OFF

`/settings/consultora` → toggle Switch a OFF. Toast "Auto-creación desactivada".

### Criterios de éxito

- ✅ Toggle ON: publish NO muestra modal.
- ✅ Evento se crea silent con toast CTA.
- ✅ Toggle persiste cross-session.

### Cleanup

```sql
delete from public.calendar_events where informe_id = (select id from public.informes where titulo = 'SMOKE 9 silent');
delete from public.informes where titulo = 'SMOKE 9 silent';
update public.consultoras set auto_create_event_on_sign = false where id = (select consultora_id from public.consultora_members where user_id = auth.uid() limit 1);
```

---

## 10. Unpublish informe

### 10.1 Volver a draft

1. Crear informe `SMOKE 10 unpublish` + publish (cualquier path, modal o silent).
2. `/informes/<id>` (detail view, NO editar) → click `Volver a borrador`.
3. AlertDialog confirm → click `Volver a borrador`.
4. Toast "Informe vuelto a borrador".

### 10.2 Sanity check DB

```sql
select titulo, status from public.informes where titulo = 'SMOKE 10 unpublish';
-- Esperado: status='draft'.

-- El evento vinculado debe SEGUIR existiendo (NO se borra en unpublish):
select titulo from public.calendar_events
where informe_id = (select id from public.informes where titulo = 'SMOKE 10 unpublish');
```

### Criterios de éxito

- ✅ `status='draft'` post-unpublish.
- ✅ Evento vinculado NO se borra (decisión cerrada T-036: unpublish es reversibilidad pura).

### Cleanup

```sql
delete from public.calendar_events where informe_id = (select id from public.informes where titulo = 'SMOKE 10 unpublish');
delete from public.informes where titulo = 'SMOKE 10 unpublish';
```

---

## 11. Recurrencia

### 11.1 Crear evento recurrente 6 meses

UI: `/calendario` → click cualquier día → drawer create:
- Tipo: `custom`.
- Título: `SMOKE 11 recurrencia`.
- Toggle Recurrente: ON → input `Cada N meses` = `6`.

Click `Crear vencimiento`.

### 11.2 Completar primera ocurrencia

1. Click evento → `Marcar completado` → AlertDialog confirm.
2. Toast "Vencimiento completado" con CTA `Ver siguiente vencimiento` → click CTA.
3. URL navega al mes +6 + drawer view del next event.

### 11.3 Verificar parent_event_id en chain

```sql
select id, titulo, status, fecha_vencimiento, parent_event_id, recurrence_months
from public.calendar_events
where titulo = 'SMOKE 11 recurrencia'
order by created_at;
```

Esperado: 2 rows.
- Row 1: `status='completed'`, `parent_event_id=null`.
- Row 2: `status='pending'`, `parent_event_id` = id de row 1, `fecha_vencimiento` = row1.fecha + 6 meses.

### 11.4 EventViewPanel render

En la vista del next event (paso 11.2), verificar copy "Auto-creado por recurrencia desde [link al anterior]".

### 11.5 Chain 3 niveles

Completar el next event también. Verificar:

```sql
select titulo, parent_event_id, fecha_vencimiento
from public.calendar_events
where titulo = 'SMOKE 11 recurrencia'
order by fecha_vencimiento;
```

Row 3 debe tener `parent_event_id` = id de row 2.

### Criterios de éxito

- ✅ Auto-creación del next event con `parent_event_id` correcto.
- ✅ Recurrence months preservado en chain.
- ✅ Copy "Auto-creado por recurrencia" renderea.

### Cleanup

```sql
delete from public.calendar_events where titulo = 'SMOKE 11 recurrencia';
```

---

## 12. Bot bloqueado

**Validar el flow auto-unlink + Alert UI**.

### 12.1 Simular blocked_count = 3 via admin

Studio:

```sql
update public.telegram_subscriptions
set blocked_count = 3
where user_id = auth.uid();
```

### 12.2 Verificar Alert UI

`/settings/notificaciones` → row Telegram → Alert destructive visible:

> **Tu bot fue bloqueado en Telegram. Regenerá la vinculación para volver a recibir.**

### 12.3 Reset blocked_count

```sql
update public.telegram_subscriptions
set blocked_count = 0
where user_id = auth.uid();
```

Refresh → Alert desaparece.

### Criterios de éxito

- ✅ Alert destructive visible cuando `blocked_count >= 3`.
- ✅ Alert desaparece con reset.

---

## 13. Mute temporal

### 13.1 Setup mute 7 días

`/settings/notificaciones` → radio `7 días` → `Guardar cambios`.

### 13.2 Crear reminder due

Crear evento `SMOKE 13 mute` con `scheduled_at` forzado a `now() + 30s` (idem step 7).

### 13.3 Esperar 1 tick del cron

≤5 min.

### 13.4 Verificar nada llegó

- Inbox: sin mensaje de `SMOKE 13`.
- Telegram bot: sin mensaje de `SMOKE 13`.

### 13.5 Sanity check DB

```sql
-- notification_log debe estar VACIO para este reminder (dispatcher
-- skipea silent cuando mute activo, sin log row):
select count(*)
from public.notification_log
where reminder_id = (
  select id from public.calendar_event_reminders
  where event_id = (select id from public.calendar_events where titulo = 'SMOKE 13 mute' order by created_at desc limit 1)
);

-- Pero el cron sí marcó el reminder como 'sent' (claim layer SQL T-031):
select status
from public.calendar_event_reminders
where event_id = (select id from public.calendar_events where titulo = 'SMOKE 13 mute' order by created_at desc limit 1);
```

Esperado: notification_log `count = 0`, reminder `status='sent'`.

### 13.6 Reset mute

`/settings/notificaciones` → radio `No pausar` → `Guardar cambios`.

### Criterios de éxito

- ✅ Mute bloquea ambos canales silent (sin log row).
- ✅ Reminder marcado sent del lado claim (at-most-once delivery).

### Cleanup

```sql
delete from public.calendar_events where titulo = 'SMOKE 13 mute';
```

---

## 14. Vencimientos vinculados

### 14.1 Crear informe + publish con event

1. Crear `SMOKE 14 vinculado`, tipo RGRL, contenido.
2. Publish con modal → Agendar.

### 14.2 Verificar sección en detail view

1. Navegar a `/informes/<id>` (detail view, no editar).
2. Después de la card de contenido markdown, debe aparecer sección **"Vencimientos vinculados"** con:
   - Badge status (`pending`).
   - Título del evento.
   - Fecha en español (ej "16 de may 2027").
   - Link a `/calendario/agenda?event=<uuid>`.

### 14.3 Sin eventos vinculados

1. Crear `SMOKE 14 sin vinculado`, tipo accidente (mapping null, NO crea evento).
2. Detail view: sección "Vencimientos vinculados" NO renderea (cero clutter).

### Criterios de éxito

- ✅ Sección aparece solo si hay eventos.
- ✅ Link al calendario funcional.

### Cleanup

```sql
delete from public.calendar_events where informe_id in (
  select id from public.informes where titulo like 'SMOKE 14%'
);
delete from public.informes where titulo like 'SMOKE 14%';
```

---

## 15. Permission gates

### 15.1 Crear segundo user member non-owner

```sql
-- Acción admin manual: invitar otro user a tu consultora con role='member'.
-- O via Supabase Studio:
-- 1. auth.users.insert nuevo email.
-- 2. consultora_members.insert con role='member' a tu consultora.
```

(Alternativamente, si no querés crear user nuevo, podés skippear este step y confiar en los integration tests T-024/T-028/T-036 que cubren el permission gate vía RLS.)

### 15.2 Login como member

Logout + login como el member non-owner.

### 15.3 Verificar gates

- `/settings/consultora` → Card "Workflow" → toggle Switch disabled + Alert "Workflow administrado por el owner".
- Card "Logo" → botones disabled + Alert "Solo el owner puede editar".
- `/informes/<id>` (de informe creado por owner) → botón `Publicar` disabled + Tooltip "Solo el creador o un owner pueden publicar".

### Criterios de éxito

- ✅ Member non-owner ve Alert + botones disabled donde corresponde.
- ✅ Owner sigue siendo el único que puede editar config tenant-wide.

---

## Troubleshooting tests E2E

**Si reproducís tests E2E del Sprint 3 en local y algunos fallan, NO bloquea el smoke productivo**.

Issue [#56](https://github.com/LautiRoveda/consultora-demo/issues/56) cerrado pragmáticamente en T-037 como **Windows-local-only**. Los siguientes 4 tests E2E pueden fallar en tu local pero pasan en CI Ubuntu con `retries=2`:

| Test | Causa raíz Windows-local | Fix local (NO crítico) |
|---|---|---|
| `auth-flows.spec.ts` recovery flow | ERR_NAME_NOT_RESOLVED de Chromium al callback URL | NO hay fix conocido. CI Ubuntu OK. |
| `consultora-logo.spec.ts` PDF download | Puppeteer cross-worker sin CHROMIUM_PATH | `export CHROMIUM_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"` |
| `informes-attachments.spec.ts` happy path | Idem | Idem |
| `informes-pdf-export.spec.ts` happy path | Idem | Idem |

**Validación real productiva**: este smoke runbook. Si todos los 15 pasos pasan, el sistema funciona end-to-end correcto en VPS. **NO investigar más Chromium Windows-specific sin demanda real**.

Probaste localmente:
1. Setear `CHROMIUM_PATH` resuelve 3 de 4 (los PDF-related).
2. El recovery flow falla persistente; reportar al maintainer si reproducís y subir log + ambiente Windows version + Chromium version.

---

## Resumen del runbook

| Sección | Tiempo estimado | Crítico para go-live |
|---|---|---|
| 1. Setup | 5 min | ✅ Sí (sin esto nada funciona) |
| 2. Calendario mensual | 3 min | ✅ Sí |
| 3. Calendario agenda | 3 min | ✅ Sí |
| 4. Dashboard panel | 2 min | ⚠️ Útil pero no crítico |
| 5. Settings notificaciones | 3 min | ✅ Sí |
| 6. Vinculación Telegram | 5 min | ✅ Sí (requiere mobile) |
| 7. Reminder real | 8 min | 🔴 **CRÍTICO** — flow core Sprint 3 |
| 8. Publish + modal | 4 min | ✅ Sí |
| 9. Toggle workflow | 3 min | ⚠️ Útil pero no crítico |
| 10. Unpublish | 2 min | ⚠️ Edge case |
| 11. Recurrencia | 5 min | ✅ Sí |
| 12. Bot bloqueado | 2 min | ⚠️ Edge case |
| 13. Mute temporal | 5 min | ✅ Sí |
| 14. Vencimientos vinculados | 2 min | ⚠️ Útil pero no crítico |
| 15. Permission gates | 5 min | ✅ Sí (si hay member non-owner disponible) |

**Mínimo viable** (si tiempo escaso): secciones 1 + 5 + 6 + 7 + 8 + 11 = ~30 min. Cubre el flow crítico end-to-end.
