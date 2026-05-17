# Setup operativo Web Push (T-034)

Runbook para configurar el canal Web Push post-merge. Responsabilidad de Lautaro.

## Resumen

T-034 implementa el tercer canal de notificación (Email Resend T-031 + Telegram bot T-033 + **Web Push T-034**). El user activa notificaciones desde `/settings/notificaciones` clickeando "Activar", el browser muestra el dialog nativo de permiso, y a partir de ahí recibe notifications push del Push Service (FCM en Chrome/Edge, Mozilla autopush en Firefox).

**Compat matrix (DA-02 del discovery)**: Chrome desktop + Firefox desktop + Edge desktop + Chrome Android. **NO soportado**: Safari (cualquier plataforma — requiere PWA installable, Fase 3) y iOS (idem).

## 1. Generar VAPID keys (UNA VEZ — nunca regenerar productivo)

VAPID = "Voluntary Application Server Identification". Par de claves criptográficas:
- **Public**: identifica al server al Push Service. Inlinada al bundle cliente.
- **Private**: firma JWT para autenticar requests al Push Service. Server-only.

```bash
npx web-push generate-vapid-keys
```

Output:

```
Public Key:
BNc1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_0123456789abcdef-_

Private Key:
abcdefghijklmnopqrstuvwxyz1234567890_-
```

**⚠️ NUNCA regenerar las keys productivas.** Si lo hacés:
- Todas las subscriptions existentes quedan inválidas (el Push Service asocia la public key al endpoint al subscribe).
- Los users tendrán que re-activar Push desde `/settings/notificaciones`.
- Si solo se rota la private key sin regenerar, los sends fallarán con `401 Unauthorized` del Push Service.

Solo regenerar si hay compromiso confirmado de la private key (leak en logs, push de secrets, etc).

## 2. Configurar env vars en EasyPanel

Service `consultora-demo` → Environment → agregar:

```env
VAPID_PRIVATE_KEY=<private key del paso 1>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key del paso 1>
VAPID_SUBJECT=mailto:noreply@mail.consultora-demo.test-ia.cloud
```

`VAPID_SUBJECT` debe empezar con `mailto:` o `https://` (requerido por la web-push spec). El default sensato es el mailto del subdominio Resend.

**Validación pre-deploy**: el schema Zod en [`src/env.ts`](../../src/env.ts) verifica:
- `VAPID_PRIVATE_KEY` min 40 chars.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` min 80 chars.
- `VAPID_SUBJECT` regex `^(mailto:|https://)`.

Si alguna falta o no matchea, el build de Docker en EasyPanel falla con `Invalid environment variables — ver logs arriba`.

## 3. Redeploy del service

Auto Deploy de EasyPanel ya está habilitado desde T-022.5-FU3 — push a `main` con merge dispara redeploy automático via webhook GitHub. Si necesitás redeploy manual: EasyPanel UI → service `consultora-demo` → "Implementar".

## 4. Smoke productivo (6 pasos)

URL productiva: <https://consultora-demo.test-ia.cloud>

### Paso 1 · Verificar pre-condiciones

```bash
# Service alive
curl -I https://consultora-demo.test-ia.cloud

# Service worker accesible
curl -I https://consultora-demo.test-ia.cloud/sw.js
# Esperado: 200 OK + Content-Type: application/javascript
```

### Paso 2 · Login + ir a Settings/Notificaciones

1. Abrir <https://consultora-demo.test-ia.cloud/login> en Chrome/Firefox/Edge desktop o Chrome Android.
2. Login con cuenta productiva.
3. Sidebar → "Configuración" → tab "Notificaciones".

### Paso 3 · Activar Push

1. En la row "Push web" → click botón "Activar".
2. Browser muestra dialog nativo "Permitir notificaciones?" → click "Permitir".
3. UI debería actualizar el row a:
   - Badge verde "Activadas en este dispositivo"
   - Botón "Desactivar en este dispositivo"
4. Toast "Notificaciones del navegador activadas."

### Paso 4 · Verificar DB

En Supabase Studio → SQL Editor:

```sql
select
  ps.id,
  ps.endpoint,
  ps.user_agent,
  ps.created_at,
  ps.last_seen_at,
  ncp.enabled as pref_enabled
from public.push_subscriptions ps
left join public.notification_channel_prefs ncp
  on ncp.user_id = ps.user_id and ncp.channel = 'push'
where ps.user_id = '<tu_user_id>';
```

Esperado:
- 1 row con `endpoint` que empiece con `https://fcm.googleapis.com/fcm/send/` (Chrome/Edge) o `https://updates.push.services.mozilla.com/wpush/` (Firefox).
- `user_agent` con string del browser actual.
- `pref_enabled = true`.

### Paso 5 · Smoke reminder real end-to-end

```sql
-- Crear evento custom hoy + reminder offset=0 con scheduled_at inmediato.
with event as (
  insert into public.calendar_events (
    consultora_id, tipo, titulo, fecha_vencimiento, created_by,
    reminder_offsets_days
  )
  values (
    (select consultora_id from public.consultora_members where user_id = '<tu_user_id>' limit 1),
    'custom',
    'SMOKE PUSH T-034',
    current_date,
    '<tu_user_id>',
    array[0]
  )
  returning id, consultora_id
)
insert into public.calendar_event_reminders (event_id, consultora_id, offset_days, scheduled_at)
select event.id, event.consultora_id, 0, now() + interval '30 seconds'
from event;
```

Esperar el próximo tick del cron pg_cron (máximo 5 minutos desde el `scheduled_at`).

**Esperado**:
- **Notification nativa del browser** aparece con título `ConsultoraDemo · Vencimiento` y body `HOY vence: SMOKE PUSH T-034`.
- Click en la notification → abre `https://consultora-demo.test-ia.cloud/calendario/agenda?event=<id>`.
- DB:
  ```sql
  select status, channel, provider_message_id, sent_at
  from public.notification_log
  where reminder_id = '<reminder_id>';
  ```
  Esperado: row con `channel='push' status='sent' provider_message_id` con formato `push:1/1` (1 device, 1 success).
- `push_subscriptions.last_seen_at` updated al timestamp del send.

### Paso 6 · Smoke multi-device (opcional)

1. En otro browser/device, login con mismo user.
2. Activar push también.
3. Crear evento smoke nuevo.
4. **Esperado**: notification llega a AMBOS browsers/devices.
5. DB: 2 rows en `push_subscriptions` (mismo `user_id`, distintos `endpoint`).

## Troubleshooting

### Symptom: `Notification.requestPermission` no muestra dialog

**Causa común**: el origin ya fue marcado como denied previamente (incluso en sesión anterior). El browser NO vuelve a mostrar el dialog si está denegado — el user tiene que reactivar manualmente.

**Fix**: Settings del browser → buscar `consultora-demo.test-ia.cloud` → permitir notifications → recargar.

### Symptom: subscribe falla con `InvalidStateError: Subscription must be created with the same public key as it was previously created with`

**Causa**: la public key en EasyPanel cambió respecto a la que se usó en un subscribe previo.

**Fix**: NO regenerar VAPID keys productivas. Si ya pasó, los users afectados deben:
1. DELETE manual de su row en `push_subscriptions`.
2. Re-activar Push desde Settings → genera sub nueva con la public key actual.

### Symptom: notification_log con `error_code: 'PUSH_NO_SUBSCRIPTIONS'`

**Causa**: el dispatcher detectó que el user NO tiene rows en `push_subscriptions`. Esto es normal si el user nunca activó push o las desactivó todas.

**Fix**: el user debe ir a Settings → activar.

### Symptom: notification_log con `error_code: 'PUSH_ALL_EXPIRED'`

**Causa**: todas las subs del user retornaron HTTP 410 Gone del Push Service. Esto ocurre cuando:
- El user revocó permisos manualmente desde browser settings.
- El user borró la cache del browser (algunos browsers invalidan subs al limpiar storage).
- La subscription pasó más de N tiempo sin uso (FCM ~30d, Mozilla ~360d).

**Fix**: el sender hace cleanup automático (DELETE row + auto-disable pref). El user puede re-activar desde Settings.

### Symptom: notification_log con `error_code: 'PUSH_ALL_FAILED'`

**Causa**: error 5xx del Push Service o 413 payload too large.

**Fix**: si recurrente, chequear logs del sender (`logger.warn` con statusCode) — puede ser outage del provider.

### Symptom: el SW no recibe el push (no aparece notification)

**Diagnóstico**:
1. Chrome DevTools → Application → Service Workers → verificar que `sw.js` esté activo con scope `/`.
2. Chrome DevTools → Application → Service Workers → click "Push" para simular un push manual con payload custom.
3. Si simulación funciona → el problema está en el flow server-side (verificar `notification_log` row con status `sent` y `provider_message_id`).
4. Si simulación NO funciona → el SW tiene bug, verificar [`public/sw.js`](../../public/sw.js).

## Rotación de VAPID keys (raro)

Solo si hay compromiso de la private key:

1. Generar par nuevo: `npx web-push generate-vapid-keys`.
2. **Notificar a usuarios** que tendrán que re-activar Push (post-rotación todas las subs quedan inválidas).
3. EasyPanel → reemplazar `VAPID_PRIVATE_KEY` y `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
4. Redeploy del service.
5. (Opcional pero recomendado) DELETE bulk de `public.push_subscriptions` para forzar cleanup inmediato:
   ```sql
   delete from public.push_subscriptions;
   ```
6. Verificar smoke productivo end-to-end.

**Costo de la rotación**: ~5 min de downtime UX del canal (users perciben "se desactivaron las notifications, hay que re-activar"). Mucho menor al riesgo de leak no rotado.

## Compat matrix actualizada

| Browser/OS | Soportado | Nota |
|---|---|---|
| Chrome Desktop (Windows/macOS/Linux) | ✅ | Endpoint FCM |
| Firefox Desktop | ✅ | Endpoint Mozilla autopush |
| Edge Desktop | ✅ | Endpoint FCM (chromium) |
| Chrome Android | ✅ | Endpoint FCM |
| Firefox Android | ⚠️ Limitado | Push notifications funcionan pero requiere browser open |
| Safari Desktop (macOS) | ❌ | Necesita Web Push for macOS Safari API (T-034-FU futuro) |
| Safari iOS / iPadOS | ❌ | Requiere PWA installable (Fase 3) |
| Chrome iOS / Firefox iOS | ❌ | iOS solo permite WebKit; mismo bloqueo que Safari |

Feature detect en [`src/app/(app)/settings/notificaciones/PushChannelRow.tsx`](../../src/app/(app)/settings/notificaciones/PushChannelRow.tsx) captura todos los casos no soportados → muestra Alert "Navegador incompatible" + sugiere browsers OK.

## ⚠️ Lesson learned (T-034 smoke productivo) · placeholder check Vault vulnerable a typos

**Síntoma observado durante smoke T-034 pre-Lautaro confirm**: el cron tick procesaba reminders pero `notification_log` quedaba vacío. Inspeccionar `net._http_response` mostraba `error_msg='Couldn't connect to server'` o `status_code=401` para los POSTs disparados por `process_pending_reminders`.

**Causa raíz**: el secret de Vault `cron_dispatch_secret` tenía typo: `REPLACE_ME_POST_DEPLOy` (con `y` minúscula al final), que **NO matcheaba ni con el placeholder check ni con `INTERNAL_CRON_SECRET` de EasyPanel**.

El check del helper SQL `process_pending_reminders()` hace:

```sql
if v_secret = 'REPLACE_ME_POST_DEPLOY' then
  raise notice 'cron_dispatch_secret todavía es placeholder, saltando tick';
  return;
end if;
```

El `=` exact match con `'REPLACE_ME_POST_DEPLOY'` (Y mayúscula) **no captura** la variante con `y` minúscula → el guard returnea normal → el cron continúa intentando dispatch → falla 401 silenciosa.

**Mitigación inmediata**: regenerar `cron_dispatch_secret` fresh con `openssl rand -hex 32` + pegarlo idéntico en EasyPanel `INTERNAL_CRON_SECRET` (procedimiento principal de `cron-secret-rotation.md`).

**Fix recomendado para próxima migration que toque `set_cron_vault_secret_helper.sql`**: reemplazar el check de equality con uno robusto a typos:

```sql
-- Opción A: regex (matchea cualquier variante REPLACE_ME*)
if v_secret like 'REPLACE_ME%' then ...

-- Opción B: length check (un valor `openssl rand -hex 32` siempre es 64 chars)
if length(v_secret) != 64 then ...
```

Documentado también en [cron-secret-rotation.md](cron-secret-rotation.md) lessons learned.

## Referencias

- Plan T-034: contexto, decisiones cerradas, estructura del módulo.
- Discovery § 3.7 (push_subscriptions schema) + § 6.3 (Web Push specs operativos): [`docs/discovery/07-calendario-notificaciones.md`](../discovery/07-calendario-notificaciones.md).
- T-031 dispatcher infrastructure: [`docs/operations/resend-setup.md`](resend-setup.md), [`docs/operations/cron-secret-rotation.md`](cron-secret-rotation.md).
- T-033 patrón canal Telegram: [`docs/operations/telegram-setup.md`](telegram-setup.md).
- web-push library docs: <https://github.com/web-push-libs/web-push>.
- Push API spec: <https://www.w3.org/TR/push-api/>.
