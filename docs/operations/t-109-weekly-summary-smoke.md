# Runbook — Deploy + Smoke T-109 (resumen semanal EPP por email)

**Qué es:** un cron que cada lunes 09:00 ART le manda al dueño de cada consultora
un email con su resumen EPP (entregas firmadas de los últimos 7 días + vencimientos
próximos). Este runbook deja el endpoint en producción y valida que la cadena
`pg_cron → process_epp_weekly_summary() → pg_net → /api/cron/weekly-summary`
dispara bien.

**Cuándo correrlo:** después de cada deploy que toque el cron, o para diagnosticar
si el resumen del lunes no llegó.

Detalle del patrón en [`docs/adr/0009-digest-notification-pattern.md`](../adr/0009-digest-notification-pattern.md).

---

## Antes de arrancar: la migración YA está aplicada

La parte de base de datos (la tabla `notification_digest_log`, la función
`process_epp_weekly_summary()` y la programación del cron) **ya está en prod** (se
pusheó con `supabase db push` en su momento). El deploy de EasyPanel **NO re-corre
migraciones** — solo actualiza el código del endpoint `/api/cron/weekly-summary`.
No hay riesgo de que el deploy toque el schema.

Verificación opcional (Supabase → SQL Editor) — las dos columnas con valor (no
`null`) confirman que la migración está aplicada:

```sql
select to_regclass('public.notification_digest_log')          as tabla,
       to_regprocedure('public.process_epp_weekly_summary()') as funcion;
```

---

## Paso 1 — Sincronizar los secrets (ANTES del deploy)

**Por qué importa:** el cron le pega al endpoint mandando un header secreto
(`X-Internal-Cron-Secret`) que saca del **Vault** (`cron_dispatch_secret`). El
endpoint compara ese header contra la variable de entorno de **EasyPanel**
(`INTERNAL_CRON_SECRET`). **Si los dos valores no son idénticos, el endpoint
responde 401 y el resumen no se manda nunca.** El secret vive en dos lugares y
deben ser iguales.

**1a.** En Supabase → **SQL Editor**, corré esto (no muestra el secreto, solo su
largo y una "huella"):

```sql
select name,
       length(decrypted_secret)                       as largo,
       left(md5(decrypted_secret), 8)                 as huella,
       (decrypted_secret like 'REPLACE_ME%')          as es_placeholder,
       case when name = 'cron_dispatch_base_url'
            then decrypted_secret else '(oculto)' end as valor
from vault.decrypted_secrets
where name in ('cron_dispatch_secret', 'cron_dispatch_base_url')
order by name;
```

**Esperado:**

- `cron_dispatch_secret` → `largo = 64`, `es_placeholder = false`.
- `cron_dispatch_base_url` → `valor = https://consultora-demo.test-ia.cloud`, `es_placeholder = false`.

Si alguno dice `es_placeholder = true` o el largo del secret no es 64 → **frená**:
hay que setear el secreto real en el Vault primero (no sigas).

**1b.** Asegurate de que EasyPanel tenga **el mismo** valor que el Vault. Lo más a
prueba de errores (sobre todo si rotaste el Vault hace poco): tomá el valor del
Vault como fuente de verdad y copialo a EasyPanel.

1. En el SQL Editor: `select decrypted_secret from vault.decrypted_secrets where name = 'cron_dispatch_secret';`
   → copiá el resultado. **(No lo pegues en un chat ni en un ticket — solo en EasyPanel.)**
2. En **EasyPanel → servicio `consultora-demo` → pestaña Environment (variables de
   entorno) → `INTERNAL_CRON_SECRET`** → pegá ese valor exacto → **Guardar**.

Si estás 100% seguro de que ya son iguales y no rotaste nada, podés saltear 1b.
Ante la duda, re-sincronizá: no rompe nada.

---

## Paso 2 — Deploy

En **EasyPanel → servicio `consultora-demo` → botón "Implementar"** (sobre `main`).
Esperá a que termine y el servicio quede en verde / healthy. Esto publica el código
nuevo del endpoint y toma la variable de entorno que guardaste en 1b. No corre
migraciones.

---

## Paso 3 — Smoke: validar la cadena `pg_cron → pg_net → route`

Todo en Supabase → **SQL Editor**, en orden:

**3.1 — Secrets OK** → ya verificado en el Paso 1 (≠ placeholder y sincronizados).

**3.2 — Disparar la función a mano** (simula el tick del lunes):

```sql
select process_epp_weekly_summary();
```

Devuelve vacío / `null` — es normal. Lo importante es lo que pasa atrás.

**3.3 — Esperá ~30 segundos** y mirá la respuesta HTTP del POST que hizo la función:

```sql
select status_code, created
from net._http_response
order by created desc
limit 1;
```

**Esperado: `status_code = 200`.** Si ves 200, la cadena funciona.

Si NO ves 200:

- **401** → los secrets no matchean → volvé al **Paso 1b** (sincronizar) y repetí desde 3.2.
- **404** → el `cron_dispatch_base_url` o la ruta están mal → revisá el `valor` en 1a
  (debe ser `https://consultora-demo.test-ia.cloud`).
- **No aparece fila nueva** → la función no llegó a hacer el POST (placeholder en
  Vault) → revisá 1a.

**3.4 — (Opcional) ver si se registró algún envío:**

```sql
select consultora_id, tipo, periodo_iso, channel, sent_at, resend_email_id
from public.notification_digest_log
order by created_at desc
limit 10;
```

### No te asustes si hay 0 emails / 0 filas

Con prod limpio, las consultoras reales pueden **no tener actividad EPP** en la
ventana de 7 días, así que el endpoint hace **skip silencioso**: no manda email y
**no inserta fila** en `notification_digest_log`. **Eso es correcto.** El smoke
valida que la cadena **DISPARA bien (status 200)**, no que llegue un mail.
→ **0 emails + 200 = éxito.**

Si querés ver un email real de punta a punta: creá una **entrega EPP firmada
reciente** en una consultora real y volvé a correr 3.2.

---

## Paso 4 — Confirmar el cron programado

```sql
select jobname, schedule, active
from cron.job
where jobname = 'process-epp-weekly-summary';
```

**Esperado:** una fila, `schedule = '0 12 * * 1'` (lunes 12:00 UTC = **09:00 ART**),
`active = true`.

---

## Resumen de "está OK"

- Deploy verde en EasyPanel.
- `net._http_response` → **200**.
- `cron.job` → la fila activa con `0 12 * * 1`.
- 0 emails es esperado con prod sin actividad EPP — el envío real se va a dar el
  primer lunes que alguna consultora tenga movimiento EPP.
