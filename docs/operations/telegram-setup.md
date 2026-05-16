# Telegram Bot + webhook · setup operativo post-merge (T-033)

> **Audiencia:** Lautaro. Procedimiento para activar el canal Telegram tras el
> merge de T-033.

T-033 mete toda la infraestructura del canal Telegram (bot client + webhook +
sender + UI + RLS + tablas), pero **el bot debe crearse en Telegram via
BotFather** y **el webhook debe registrarse después del deploy**. Mientras
tanto, los users ven el row de Telegram en `/settings/notificaciones` pero
intentar vincular falla (el deep-link `t.me/<bot>` apunta a un bot
no-configurado).

---

## Paso 1 · Crear el bot con BotFather

1. Abrí Telegram → buscá `@BotFather` → click "Start".
2. Enviá `/newbot`.
3. BotFather pregunta el nombre del bot. Sugerido: `ConsultoraDemo`.
4. BotFather pregunta el username. Debe terminar en `_bot`. Sugerido:
   `consultora_demo_bot` o `consultorademo_alerts_bot` (si el primero está
   ocupado).
5. BotFather responde con:
   - **Token** del bot: formato `<id>:<35-char-hash>`. Ej: `8123456789:AAH...`.
   - **Link directo**: `t.me/<username>`.

**Guardá el token en un lugar seguro** — necesitás cargarlo en EasyPanel
en el Paso 3.

### Configuración opcional del bot (recomendada):

Desde la conversación con BotFather:

- `/setdescription` → "ConsultoraDemo te avisa por acá cuando un vencimiento
  está próximo. Vinculá tu cuenta desde la app: consultora-demo.test-ia.cloud"
- `/setabouttext` → "Notificaciones de vencimientos HyS"
- `/setuserpic` → subí el logo de ConsultoraDemo (PNG 512x512).
- `/setjoingroups` → **Disable** (el bot es 1:1, no para grupos).
- `/setprivacy` → **Enabled** (el bot solo lee mensajes que comienzan con `/`).
- `/setcommands` → setear lista de comandos:

```
start - Vincular cuenta con código generado en la app
unlink - Desvincular cuenta del bot
```

---

## Paso 2 · Generar `TELEGRAM_WEBHOOK_SECRET`

Es el shared secret entre Telegram y el endpoint `/api/webhooks/telegram`.
Telegram lo manda como header `X-Telegram-Bot-Api-Secret-Token` en cada POST,
y el endpoint lo valida contra `env.TELEGRAM_WEBHOOK_SECRET`.

Generá un secret seguro:

```bash
openssl rand -hex 32
```

Salida ejemplo: `a7b9c3...` (64 caracteres hex). Guardalo.

---

## Paso 3 · Cargar env vars en EasyPanel

Login a EasyPanel del VPS (<https://easypanel.test-ia.cloud>) → Project
`agendalo` → Service `consultora-demo` → **Environment** tab → **Edit**.

Sumar las 3 variables:

```
TELEGRAM_BOT_TOKEN=<token de BotFather, formato <id>:<hash>>
TELEGRAM_BOT_USERNAME=<username SIN @, ej consultora_demo_bot>
TELEGRAM_WEBHOOK_SECRET=<output de openssl rand -hex 32>
```

**Save**. EasyPanel rebuildea la imagen Docker tomando estas vars como
ARG/ENV en el stage builder (T-031 hotfix #72 pattern).

> Si EasyPanel tiene Auto Deploy habilitado (T-022.5-FU3), el deploy se
> dispara automático tras el save. Si no, click manual "Implementar"
> tras `git push origin main` del PR mergeado.

---

## Paso 4 · Verificar deploy + endpoints

Esperá ~3-5 min a que el container terminé de buildear + bootear.

Smoke endpoints:

```bash
# 1. Health check del bot (validación del token).
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
# Debe devolver: {"ok":true,"result":{"id":...,"is_bot":true,"username":"..."}}

# 2. Endpoint webhook responde 401 sin secret (defensive auth).
curl -i https://consultora-demo.test-ia.cloud/api/webhooks/telegram \
  -X POST -H "Content-Type: application/json" \
  -d '{"update_id":1,"message":{"message_id":1,"date":0,"chat":{"id":1,"type":"private"}}}'
# Debe devolver: HTTP 401 Unauthorized

# 3. Endpoint webhook responde 200 silent con shape inválido (Zod fail).
curl -i https://consultora-demo.test-ia.cloud/api/webhooks/telegram \
  -X POST -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: <TELEGRAM_WEBHOOK_SECRET>" \
  -d '{"invalid":"payload"}'
# Debe devolver: HTTP 200 OK con {"ok":true}
```

Si algún check falla, ver logs de EasyPanel del service.

---

## Paso 5 · Registrar el webhook

Telegram necesita saber a qué URL enviar los updates. **Solo después del
deploy** (paso 4 OK):

```bash
curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://consultora-demo.test-ia.cloud/api/webhooks/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
  }'
```

Respuesta esperada:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

Verificar:
```bash
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

Debe devolver algo como:
```json
{
  "ok": true,
  "result": {
    "url": "https://consultora-demo.test-ia.cloud/api/webhooks/telegram",
    "has_custom_certificate": false,
    "pending_update_count": 0,
    "last_error_date": null,
    "max_connections": 40,
    "ip_address": "..."
  }
}
```

Si `last_error_date` aparece o `pending_update_count > 0`, mirar
`last_error_message` y los logs del service en EasyPanel.

---

## Paso 6 · Smoke productivo end-to-end

1. **Login** en `https://consultora-demo.test-ia.cloud/login`.
2. **Settings** → **Notificaciones**.
3. Row Telegram debe mostrar Badge "No conectado" + botón "Vincular Telegram".
4. Click **Vincular Telegram** → modal abre + muestra código 8 chars.
5. Click **Abrir Telegram** → Telegram app abre con el bot pre-llenado.
6. Click **Iniciar** o enviar `/start <código>`. El bot responde "✅ Listo!".
7. Modal cierra solo ~3-6 seg después → row pasa a "Conectado ✓ @<tu_username>".
8. **DB sanity** (Supabase Studio):
   ```sql
   select user_id, telegram_chat_id, telegram_username, linked_at, blocked_count
   from public.telegram_subscriptions
   where user_id = '<tu user id>';
   ```
   Debe mostrar row con `linked_at` populado + `link_code` null.

### Smoke reminder real (opcional):

1. Crear evento `SMOKE T-033` con offset days = 1 + recurrence_months = null.
2. En Studio:
   ```sql
   update public.calendar_event_reminders
     set scheduled_at = now() + interval '30 seconds'
     where event_id = '<id del evento smoke>';
   ```
3. Esperar ~5 min al próximo tick del cron (`*/5 * * * *`).
4. Recibís mensaje en Telegram con el título + fecha + deep-link al calendario.
5. **DB sanity**:
   ```sql
   select channel, status, provider_message_id, error_code, error_detail
   from public.notification_log
   where reminder_id = '<id del reminder>';
   ```
   Debe mostrar row con `channel='telegram', status='sent', provider_message_id`
   con el message_id que Telegram retornó.

### Smoke bot bloqueado (opcional, manual):

1. En Telegram: tocá el avatar del bot → **Bloquear** (3 dots → Block).
2. Forzar 3 reminders consecutivos (3 eventos smoke con scheduled_at + 30s
   spread, mismo flow del smoke anterior).
3. Tras el 3er fallo, **DB**:
   ```sql
   select blocked_count, unlinked_at, telegram_chat_id from public.telegram_subscriptions
   where user_id = '<tu user id>';
   ```
   Debe mostrar `blocked_count=3, unlinked_at != null, telegram_chat_id null`.
4. UI: row debe mostrar Alert destructive "Tu bot fue bloqueado en Telegram.
   Regenerá vinculación para volver a recibir."

---

## Rotación del `TELEGRAM_WEBHOOK_SECRET`

Si el secret se filtra:

1. Generar nuevo: `openssl rand -hex 32`.
2. EasyPanel → env var `TELEGRAM_WEBHOOK_SECRET` → reemplazar → Save (redeploy).
3. Re-registrar el webhook con el nuevo secret (Paso 5).
4. Durante la ventana entre paso 2 y paso 3, los updates de Telegram fallan
   con 401 → Telegram reintenta cada algunos minutos por hasta 24h.

---

## Rotación del `TELEGRAM_BOT_TOKEN`

Si el token se filtra (más crítico — un atacante podría mandar mensajes a
todos los users linkeados):

1. BotFather → `/token` → seleccioná tu bot → "Revoke current token".
2. Guardá el nuevo token.
3. EasyPanel → env var `TELEGRAM_BOT_TOKEN` → reemplazar → Save (redeploy).
4. Re-registrar webhook (Paso 5) con el secret existente.
5. Los chat_ids existentes **siguen válidos** — los users no necesitan
   re-vincular.

---

## Troubleshooting

### El bot no responde al `/start <code>`

1. Verificar `getWebhookInfo` — si hay `last_error_message`, investigar.
2. Probar localmente:
   ```bash
   curl -X POST https://consultora-demo.test-ia.cloud/api/webhooks/telegram \
     -H "Content-Type: application/json" \
     -H "X-Telegram-Bot-Api-Secret-Token: <secret>" \
     -d '{"update_id":99,"message":{"message_id":1,"date":0,"chat":{"id":<your-id>,"type":"private"},"from":{"id":<your-id>,"is_bot":false,"first_name":"Lautaro"},"text":"/start ABCDEFGH"}}'
   ```
   Si responde 200 OK pero el bot no manda mensaje, el `bot.sendMessage`
   está fallando — chequear que `TELEGRAM_BOT_TOKEN` es válido.

### Los reminders no llegan al bot

1. Verificar que el user tiene `notification_channel_prefs (channel='telegram', enabled=true)`.
2. Verificar que `telegram_subscriptions (user_id=<id>)` tiene `linked_at != null` Y `unlinked_at IS NULL` Y `telegram_chat_id != null`.
3. Logs de EasyPanel → buscar "telegram sender" en el último cron tick.
4. `notification_log` debería tener row con `channel='telegram', error_code` indicando la causa.

### "Telegram fully verified" toma más tiempo de lo esperado

A diferencia de Resend, el bot de Telegram funciona INMEDIATAMENTE después
de `setWebhook` — no hay DNS verification ni propagación. Si `getMe` y
`getWebhookInfo` devuelven `ok: true`, está listo.

### ⚠️ Lesson learned T-033 smoke productivo · secret mismatch EasyPanel ↔ Vault

**Síntoma**: el cron tick procesa reminders (`process_pending_reminders()` cada
5 min marca `status='sent'` en `calendar_event_reminders`), pero
`notification_log` queda vacío. Inspeccionar `net._http_response` (extension
`pg_net`) muestra `status_code = 401` al endpoint `/api/calendar/dispatch-reminder`.

**Causa raíz**: el secret `INTERNAL_CRON_SECRET` cargado en EasyPanel
(env var del service) no es idéntico al que está en Supabase Vault como
`cron_dispatch_secret`. La función SQL `process_pending_reminders()` lee
de Vault y lo pasa como header `X-Internal-Cron-Secret` al POST; el route
handler compara contra `env.INTERNAL_CRON_SECRET` (EasyPanel). Mismatch
→ 401 silent del lado server → log row nunca se inserta (el endpoint
returna antes del dispatch).

Fuentes de drift típicas al copiar secrets entre 2 UIs (Vault Studio +
EasyPanel env vars):
- Espacios invisibles al inicio/final del valor pegado.
- Truncado por límite de caracteres de la UI si el secret es muy largo.
- Re-encoding silente (UTF-8 → ASCII) si el secret tiene caracteres no
  imprimibles.

**Fix**: NO copiar secrets entre UIs. Generar fresh + pegar inmediato en
ambos lados sin intermediarios:

```bash
openssl rand -hex 32
# Copiar el output UNA VEZ y pegarlo:
# 1. En EasyPanel → Service consultora-demo → Env vars → INTERNAL_CRON_SECRET
# 2. En Supabase Studio → Vault → cron_dispatch_secret (vía RPC set_cron_vault_secret)
```

**Verificación**: tras pegar, hacer `select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_secret'` en SQL Editor + comparar string-a-string contra
el valor de EasyPanel. Trigger un cron tick manual con
`select process_pending_reminders();` y mirar `net._http_response` —
debe devolver `status_code = 200`.

Aplica también para `TELEGRAM_WEBHOOK_SECRET` (cargado solo en EasyPanel)
si se rota — Telegram debe recibir el nuevo valor via `setWebhook`
inmediatamente después del cambio en EasyPanel (mismo principio: 1
generación → 2 destinos paralelos, sin intermediarios).
