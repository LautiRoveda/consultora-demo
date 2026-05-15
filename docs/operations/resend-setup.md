# Resend + cron secret · setup operativo post-merge (T-031)

> **Audiencia:** Lautaro. Procedimiento para activar el envío real de
> emails de recordatorio tras el merge de T-031.

T-031 mete toda la infraestructura (cron pg_net + dispatcher + sender Resend
+ tablas + RLS + Vault), pero **deja Vault con un placeholder** y **el service
de EasyPanel sin env vars de Resend**. El cron arranca con el merge pero
detecta el placeholder y skipea silent cada 5 min hasta que completes los
pasos abajo.

---

## Paso 1 · Cuenta Resend

1. Signup en <https://resend.com/signup>. Free tier: **100 emails/día, 3000/mes**.
2. Login → dashboard.

Si proyectamos >100 emails/día (50 consultoras pagas con varios reminders),
upgrade a Plan Pro USD 20/mes → 50k/mes. Hoy MVP free alcanza con holgura.

---

## Paso 2 · Verificar subdominio en DNS (Hostinger)

Usamos un **subdominio dedicado** (`mail.consultora-demo.test-ia.cloud`) para
preservar la reputation del dominio principal. Si en el futuro Resend marca
spam complaints, el daño se contiene al subdominio.

1. Resend dashboard → **Domains** → **Add Domain** → ingresá
   `mail.consultora-demo.test-ia.cloud`.
2. Resend muestra 3 records DNS a configurar:
   - **SPF** (TXT): `v=spf1 include:amazonses.com ~all`.
   - **DKIM** (CNAME): 3 records `<random>._domainkey...` apuntando a
     `<random>.dkim.amazonses.com`.
   - **DMARC** (TXT, opcional pero recomendado):
     `v=DMARC1; p=none; rua=mailto:lautaroeroveda@gmail.com`.
3. Hostinger panel → DNS Zone → agregar cada record en el subdominio
   `mail`.
   - **Importante**: si Hostinger no acepta TXT records > 255 chars,
     splittealos en 2 entries del mismo nombre.
4. Volver a Resend → **Verify Domain**. Tarda 5-30 min en propagar.
5. Status debe pasar a `verified`.

---

## Paso 3 · Generar API key

1. Resend dashboard → **API Keys** → **Create API Key**.
2. Nombre: `consultora-demo-prod`.
3. Permission: **Full access** (necesita enviar emails + leer dominios).
4. Copiá el key (formato `re_xxx...`). **Guardalo en password manager** —
   no vas a poder verlo después.

---

## Paso 4 · Generar cron secret

```bash
openssl rand -hex 32
```

Output ejemplo: `8f3a2b1c9d7e0f4a6b8c2d1e3f5a7b9c0d2e4f6a8b1c3d5e7f9a0b2c4d6e8f0a`.
Guardalo en password manager. Lo necesitás en 2 lugares (paso 5 y 6).

---

## Paso 5 · EasyPanel env vars

EasyPanel UI → project `agendalo` → service `consultora-demo` → **Environment**.

Agregar:

```
RESEND_API_KEY=re_xxx... (del paso 3)
RESEND_FROM_ADDRESS=reminders@mail.consultora-demo.test-ia.cloud
RESEND_REPLY_TO_ADDRESS=noreply@mail.consultora-demo.test-ia.cloud
INTERNAL_CRON_SECRET=<openssl output del paso 4>
```

> **`RESEND_REPLY_TO_ADDRESS`** es **opcional** — si no la setés, el código
> usa el default `noreply@mail.consultora-demo.test-ia.cloud`. Override si
> querés un reply-to específico (ej. `soporte@…`) sin redeploy de código.

**Save** → EasyPanel redespliega automático tras el guardado de envs.

---

## Paso 6 · Supabase Vault

Studio → SQL Editor → ejecutar (reemplazá el secret):

```sql
select public.set_cron_vault_secret(
  'cron_dispatch_secret',
  'PEGAR_AQUI_EL_MISMO_VALOR_DEL_PASO_4'
);
```

El secret de Vault **debe matchear** exactamente la env var
`INTERNAL_CRON_SECRET` que pusiste en EasyPanel. Si difieren, el cron
manda POSTs con header viejo y el endpoint los rechaza con 401.

> **Por qué `set_cron_vault_secret` y no `vault.update_secret` directo:**
> el helper SQL `public.set_cron_vault_secret(name, value)` (T-031,
> migration `20260515100457`) tiene una allowlist de 2 nombres
> (`cron_dispatch_secret` + `cron_dispatch_base_url`) y solo es callable
> via service_role. Defensa contra escritura arbitraria a Vault.

Si en el futuro cambia el dominio (staging, preview):

```sql
select public.set_cron_vault_secret(
  'cron_dispatch_base_url',
  'https://staging.consultora-demo.test-ia.cloud'
);
```

---

## Paso 7 · Verificación inicial

1. **Verificar que las 2 env vars + 2 secrets están sincronizados**:

   Studio → SQL Editor:

   ```sql
   select name, decrypted_secret
     from vault.decrypted_secrets
    where name in ('cron_dispatch_secret', 'cron_dispatch_base_url');
   ```

   `cron_dispatch_secret` debe matchear el openssl del paso 4.
   `cron_dispatch_base_url` debe ser `https://consultora-demo.test-ia.cloud`.

2. **Verificar cron job activo**:

   ```sql
   select jobid, schedule, command, active
     from cron.job
    where jobname = 'process-pending-reminders';
   ```

   Debe estar activo con schedule `*/5 * * * *`.

3. **Smoke productivo end-to-end**:

   a. Logueate en `https://consultora-demo.test-ia.cloud` con tu user
      principal (`lautaroeroveda@gmail.com`).

   b. Andá a `/calendario` → click en hoy → crear evento:
      - Tipo: `custom`.
      - Título: `SMOKE T-031 — vencimiento de prueba`.
      - Recordatorios: `[0]` (recordatorio el día del vencimiento).

   c. Esperá ≤5 min. El cron ejecuta cada 5 min.

   d. Verificá tu bandeja de entrada:
      - Asunto: `[ConsultoraDemo] HOY vence: SMOKE T-031 — vencimiento de prueba`.
      - Reply-To: `noreply@mail.consultora-demo.test-ia.cloud` (o lo que
        hayas seteado en `RESEND_REPLY_TO_ADDRESS`).
      - Footer con link a `/settings/notificaciones` (todavía 404 hasta T-035).

   e. Studio → SQL Editor:

      ```sql
      select channel, status, provider_message_id, error_code, sent_at
        from public.notification_log
       order by sent_at desc
       limit 5;
      ```

      Primera fila debe ser `email | sent | rsd_<id> | null | <hace ≤5 min>`.

   f. Verificá que el reminder quedó `sent`:

      ```sql
      select cer.id, cer.status, cer.sent_at, ce.titulo
        from public.calendar_event_reminders cer
        join public.calendar_events ce on ce.id = cer.event_id
       where ce.titulo like '%SMOKE T-031%'
       order by cer.scheduled_at desc;
      ```

4. **Smoke skip cancelled**:

   a. Crear segundo evento `SMOKE T-031 CANCELLED`, fecha hoy, recordatorios `[0]`.
   b. INMEDIATAMENTE cancelarlo (desde la UI o vía Studio
      `update calendar_events set status='cancelled' where titulo like '%CANCELLED%'`).
   c. Esperá 5 min.
   d. Verificá `notification_log`:
      - `channel='email' status='skipped' error_code='EVENT_NOT_PENDING'`.
   e. **NO debe haber llegado email** a tu bandeja.

---

## Troubleshooting

### El cron corre pero no llega nada

```sql
select * from public.notification_log
 order by sent_at desc limit 10;
```

- **`error_code='RESEND_VALIDATION_ERROR'`**: dominio no verificado en Resend
  o `RESEND_FROM_ADDRESS` no matchea el dominio verificado.
- **`error_code='RESEND_EXCEPTION'`**: API key inválida o Resend down.
- **`status='skipped' error_code='NO_RECIPIENT_EMAIL'`**: el user del evento
  no tiene email en auth.users (raro).
- **`status='skipped' error_code='EVENT_NOT_PENDING'`**: el evento se
  canceló o completó entre claim y dispatch.
- **Tabla vacía después de >5 min**: probablemente Vault no está
  configurado. Verificá paso 6. Postgres logs deben tener
  `process_pending_reminders: cron_dispatch_secret no configurado, skip tick`.

### Cron no corre

```sql
select * from cron.job_run_details
 where jobid = (select jobid from cron.job where jobname = 'process-pending-reminders')
 order by start_time desc limit 5;
```

- **Status `failed`**: ver `return_message` y `error_message`.
- **Sin runs recientes**: el cron está pausado. Activar:

  ```sql
  update cron.job set active = true
   where jobname = 'process-pending-reminders';
  ```

### Email llega pero va a spam

- Verificá DKIM + SPF + DMARC en <https://mxtoolbox.com/EmailHeaders.aspx>
  pegando el header completo del email.
- DKIM unaligned: configurá DMARC con `p=quarantine` después de 2 semanas
  de monitoring con `p=none`.
- Si Gmail flagea: agregalo a contactos (workaround MVP), o pedir users
  que marquen "no spam".

---

## Rate limits MVP

- **Resend free**: 100 emails/día, 3000/mes. Suficiente para 5-10 consultoras
  trial con 1-2 vencimientos/semana.
- **Cron limit**: 100 reminders/tick × 12 ticks/h = 28k/día capa DB.
  Resend es el cuello de botella antes que el cron.
- Si pasamos 100/día consistente: upgrade a Resend Pro USD 20/mes.

Follow-up cuando llegue: digest diario único por consultor (`T-031-FU2`)
para evitar spam Gmail si una consultora tiene 200 reminders concurrentes.

---

## Rollback (situación de emergencia)

Si el cron empieza a mandar emails inválidos masivamente:

1. **Pausar cron** (Studio):
   ```sql
   update cron.job set active = false
    where jobname = 'process-pending-reminders';
   ```
2. **Invalidar secret** (rompe envíos pero no impacta lógica del calendario):
   ```sql
   select public.set_cron_vault_secret('cron_dispatch_secret', 'REPLACE_ME_POST_DEPLOY');
   ```
3. Investigá `notification_log` y `cron.job_run_details`.
4. Cuando esté solucionado, re-setear secret + activar cron (pasos 4 + 6
   de arriba).
