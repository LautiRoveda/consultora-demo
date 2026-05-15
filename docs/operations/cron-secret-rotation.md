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
