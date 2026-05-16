# Rotar cron secret (T-031)

> **Audiencia:** Lautaro. Procedimiento para rotar
> `INTERNAL_CRON_SECRET` periódicamente o tras sospecha de compromiso.

El secret compartido entre `pg_cron` (Vault) y el endpoint
`POST /api/calendar/dispatch-reminder` (env var) autentica el origen de
los POSTs. Si se filtra, un atacante puede disparar notificaciones
arbitrarias contra cualquier `reminder_id` válido.

**Cuándo rotar:**
- Periódicamente cada 6 meses (recomendado).
- Tras dejar el equipo un miembro con acceso a EasyPanel o Supabase Studio.
- Tras sospecha de compromiso (logs raros, traffic anómalo al endpoint).

---

## Procedimiento

**Crítico**: el orden importa. Hay una ventana de minutos donde Vault y la
env var pueden estar desincronizados y los POSTs del cron tiran 401 hasta
que ambos coinciden.

### 1. Generar nuevo secret

```bash
openssl rand -hex 32
```

Guardalo en password manager.

### 2. Actualizar Vault primero

Studio → SQL Editor:

```sql
select public.set_cron_vault_secret(
  'cron_dispatch_secret',
  '<nuevo openssl>'
);
```

**Efecto inmediato**: el cron empieza a mandar el nuevo header en la próxima
ejecución (hasta 5 min de espera).

### 3. Actualizar EasyPanel env var

EasyPanel UI → project `agendalo` → service `consultora-demo` →
Environment → editar `INTERNAL_CRON_SECRET` → pegá `<nuevo openssl>` → Save.

EasyPanel redespliega automático tras Save (~1-2 min para que el container
nuevo esté up).

### 4. Verificar sincronización

Esperá 5-7 min y consultá `notification_log`:

```sql
select status, error_code, count(*)
  from public.notification_log
 where sent_at > now() - interval '15 minutes'
 group by status, error_code;
```

- **Si status=sent es el mayoritario**: ✅ sync OK.
- **Si error_code=UNAUTHORIZED predomina**: env var no se actualizó o el
  redeploy no terminó. Verificá `EasyPanel logs` y reintentá paso 3.

---

## Rollback de emergencia

Si por alguna razón el endpoint productivo se rompe y queda rechazando 401
durante una emergencia, podés **pausar el cron temporalmente**:

```sql
update cron.job set active = false
 where jobname = 'process-pending-reminders';
```

Los reminders quedan `pending` (no se procesan), no hay pérdida de datos.
Cuando resolves el problema, re-activar:

```sql
update cron.job set active = true
 where jobname = 'process-pending-reminders';
```

El cron reanudará en la próxima marca de `*/5 * * * *`.

---

## Defensa adicional

`set_cron_vault_secret` (definido en migration
`20260515100457_set_cron_vault_secret_helper.sql`) tiene una allowlist de 2
nombres:

```sql
if secret_name not in ('cron_dispatch_secret', 'cron_dispatch_base_url') then
  raise exception 'set_cron_vault_secret: solo se permiten cron_dispatch_secret o cron_dispatch_base_url';
end if;
```

Esto previene que un service_role key comprometido pueda escribir secrets
arbitrarios a Vault desde este helper. (Un atacante con service_role
podría modificar `vault.secrets` directo, pero el helper cierra ese vector
específico).

---

## ⚠️ Lesson learned (T-033 smoke productivo) · secret mismatch silente

**Síntoma observado durante smoke T-033**: el cron tick procesaba reminders
correctamente (`process_pending_reminders()` marcaba `status='sent'` en
`calendar_event_reminders`) pero `notification_log` quedaba **vacío**.
Inspeccionar `net._http_response` (de `pg_net`) mostraba
`status_code = 401` para cada POST que `process_pending_reminders` disparaba.

**Causa raíz**: el secret de Vault (`cron_dispatch_secret`) y el de
EasyPanel (`INTERNAL_CRON_SECRET`) eran **casi** idénticos pero no exactos.
Origen del drift: copy-paste manual entre las 2 UIs introdujo un espacio
invisible al final del valor pegado en EasyPanel. El match `===` del route
handler fallaba silentemente → 401 → endpoint return antes del dispatch
→ ninguna fila a `notification_log`.

**Fuentes de drift típicas** al rotar copiando entre 2 UIs:
- Espacios invisibles al inicio/final del valor pegado (Vault Studio o
  EasyPanel insertan a veces newlines al copiar del clipboard).
- Truncado por límite de caracteres si la UI tiene maxlength menor al
  secret.
- Re-encoding silente (UTF-8 → ASCII) si el secret tiene chars no
  imprimibles (no es nuestro caso con `openssl rand -hex` pero sí si
  alguien usa base64 con `+/=`).

**Regla de oro para rotación**: NO usar el clipboard como intermediario
para "espejear" entre las 2 UIs. **Una sola generación → pegar inmediato
en los 2 destinos paralelos sin re-leer entre medio**:

```bash
# 1. Generar UNA VEZ. Output queda en pantalla.
openssl rand -hex 32

# 2. Pegarlo INMEDIATO en Vault (Studio SQL Editor):
#    select public.set_cron_vault_secret('cron_dispatch_secret', '<paste>');

# 3. Pegarlo INMEDIATO en EasyPanel env var INTERNAL_CRON_SECRET → Save.

# 4. NO volver a copiar de una UI a otra para "verificar". Si dudás,
#    regenerar fresh y repetir.
```

**Verificación post-rotación** (sobre el paso 4 del procedimiento principal):
además de chequear `notification_log` con status=sent, verificá explícitamente
el match string-a-string vía SQL:

```sql
select decrypted_secret from vault.decrypted_secrets
 where name = 'cron_dispatch_secret';
```

Comparar el output con el valor de EasyPanel UI. Si difieren aunque sea
en 1 char invisible → regenerar + repetir.

Aplica el mismo principio a otros secrets compartidos entre 2 sistemas:
- `TELEGRAM_WEBHOOK_SECRET` (EasyPanel env var ↔ valor pasado a Telegram
  via `setWebhook` curl al rotar — sincronizar inmediato sino Telegram
  reintenta cada minuto con el secret viejo).
- Futuros: webhook secrets de Resend, MercadoPago, etc.
