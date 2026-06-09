# Disaster Recovery · backup + procedimiento restore

**Ticket:** T-082 (sándwich seguridad 3/4) · re-validado en T-082-FU (post T-106/T-108/T-109/T-111).
**Cuándo correr el runbook completo:** ante incidente real (data perdida / VPS caído / account hijack).
**Tiempo estimado restore:** 10-30 min (Escenario A) → 4 horas (B) → 6 horas (C).
**Prerequisitos:** cuenta Supabase activa + acceso EasyPanel + `.env.local` con secrets reales (incl. `SUPABASE_DB_URL`) + último dump DB (`pnpm backup:db`) + último backup Storage descargado.

---

## §1. Cobertura de backups

Qué se backupea automáticamente y qué requiere acción manual:

| Componente | Backup automático | Frecuencia | Retención | Acción manual requerida |
|---|---|---|---|---|
| **DB Postgres** (Supabase) | ❌ **NO** (Free no incluye backups ni PITR — ver §2) | — | — | `pnpm backup:db` (pg_dump) mensual + subir a Drive |
| **Storage buckets** (`consultora-logos`, `informe-attachments`, `epp-firmas`, `checklist-firmas`, `checklist-adjuntos`) | ❌ NO | — | — | `pnpm backup:storage` mensual + subir a Drive |
| **Secrets EasyPanel** (~30 env vars) | ❌ NO | — | — | Export manual al rotar + password manager personal |
| **Vault Supabase** (`cron_dispatch_secret`, `cron_dispatch_base_url`) | ❌ NO | — | — | Copy/paste manual al rotar (cada 6 meses, lesson T-031) |
| **Configuración EasyPanel** (service spec, env vars set) | ❌ NO | — | — | Documentado en ADR-0007 + screenshots periódicos |
| **Código fuente** | ✅ Sí (GitHub) | Cada push | Permanente | Ninguna |

**Critical gap actual (DOBLE):** en Free Tier **ni la DB ni el Storage se backupean automáticamente**.

- **DB**: Supabase Free NO tiene backups automáticos, NO tiene PITR y NO ofrece restore desde el dashboard (la sección _Backups_ aparece vacía — confirmado en T-111 F2). El **único** respaldo de la DB es el dump manual de §2 (`pnpm backup:db`). Sin correrlo, un incidente = pérdida total de data.
- **Storage**: si un bucket se borra con service-role o la cuenta se compromete, los logos + adjuntos de informes + **las firmas legales de entregas EPP (Res SRT 299/11, bucket `epp-firmas`)** + **las firmas y fotos de inspecciones RGRL (Res SRT 463/09, buckets `checklist-firmas` y `checklist-adjuntos`)** se pierden. Por eso §3 es no-negociable mensual.

---

## §2. Backup manual de la DB (Free Tier)

> ⚠️ **Supabase Free NO tiene backups automáticos de la DB.** No hay snapshots diarios, no hay PITR y el dashboard **no** ofrece "Restore" (esa opción es Pro+; en Free la sección _Backups_ aparece vacía). Confirmado en T-111 F2 (`docs/sprints/operativo.md`). **El único respaldo de la DB es el dump manual de abajo.** En un incidente, lo que no esté en el último dump se pierde.

### Qué NO tenés en Free (no lo busques en el dashboard)

- **Backups automáticos diarios**: NO existen.
- **PITR (Point-In-Time Recovery)**: NO disponible.
- **Restore desde dashboard** (`Database → Backups → Restore`): NO disponible — la sección no lista nada que restaurar.

### Backup manual con `pnpm backup:db`

**Frecuencia recomendada:** primer lunes de cada mes, junto a `backup:storage` (ver §10).

```bash
# Desde el repo local con SUPABASE_DB_URL en .env.local (connection string del
# dashboard: Project Settings → Database → Connection string → URI):
pnpm backup:db
```

Genera un dump SQL completo (schema + data) en `backups/db/<YYYY-MM-DD-HHmmss>.sql` vía `supabase db dump`. Subir el `.sql` a Drive igual que el backup de Storage (§3).

> Nota: el motivo de T-111 para descartar `pg_dump` ("respaldaba 14k consultoras de test") **ya no aplica** — post-cleanup la DB tiene ~5 consultoras reales, así que un dump full es chico y rápido (segundos).

El schema vive además en git (`supabase/migrations/`), así que un restore puede reconstruir el schema desde las migraciones + cargar solo la data del dump si hiciera falta (ver §5).

### Cuándo upgradear a Pro ($25/mo)

Free alcanza hoy (Lautaro solo + pocos users test), pero el backup manual depende de no olvidarlo. Considerar Pro cuando:

1. **Primer cliente pagando** — el SLA implícito sube; un dump mensual manual es frágil ante un incidente entre dumps.
2. **100+ users productivos** — el volumen de data perdida entre dumps cubre el costo del upgrade x10.
3. **Regulatory compliance** — cuando un cliente exija retention/PITR.

Beneficios Pro (lo que Free NO tiene — detalle completo en §9):
- **Backups automáticos diarios** + 14 días de retention.
- **PITR**: restore a CUALQUIER momento dentro de los últimos 7 días.
- **Daily backups descargables** (DB dump en SQL desde el dashboard).
- **Soporte 24h prioritario**.

---

## §3. Backup manual Storage buckets

### Procedimiento mensual

**Frecuencia recomendada:** primer lunes de cada mes (~10 min de operación).

```bash
# Desde el repo local con .env.local apuntando a Supabase productivo:
pnpm backup:storage
```

Output esperado:

```
🗂️  Backup Storage Supabase → /path/to/backups/storage/2026-06-01-091500

📦 Bucket: consultora-logos
   3 archivos encontrados.
   [1/3] consultora-logos/abc.../logo-1747.png (12.3 KB)
   [2/3] consultora-logos/def.../logo-1748.jpg (8.7 KB)
   [3/3] consultora-logos/ghi.../logo-1749.webp (15.1 KB)

📦 Bucket: informe-attachments
   18 archivos encontrados.
   [1/18] informe-attachments/abc.../def.../foto.jpg (487.3 KB)
   ...

📦 Bucket: epp-firmas
   7 archivos encontrados.
   [1/7] epp-firmas/abc.../entrega-1.png (42.1 KB)
   ...

✅ Backup completo: 28 archivos, 12.78 MB total.
   Carpeta: /path/to/backups/storage/2026-06-01-091500

📤 Próximo paso: subir el folder a Google Drive / disco externo / backup remoto.
```

### Subir el dump a destino seguro

**Opción A — Google Drive personal (recomendado MVP):**

1. Comprimir el folder generado: `tar -czf backup-storage-YYYY-MM-DD.tar.gz backups/storage/YYYY-MM-DD-HHMMSS/`
2. Subir el `.tar.gz` a tu Google Drive personal en carpeta `consultora-demo/backups-storage/`.
3. Free tier: 15 GB. Suficiente para ~50 meses de backups asumiendo 100 MB/mes promedio.

**Opción B — Disco externo:**

Copiar el folder a USB stick / NAS dedicado. Considerar si tenés > 1GB/mes y querés evitar Drive.

**Opción C — Cloud storage remoto** (Backblaze B2 / S3 / Wasabi):

Diferido a follow-up T-082-FU2 cuando llegue 1er cliente pagando. Costo ~$0.005/GB/mes en Backblaze.

### Rotación de backups

Mantener mínimo:
- Últimos **6 backups mensuales** (= 6 meses cobertura).
- 1 backup anual (último de cada año) para histórico.

Borrar los intermedios después de los 6 meses si Drive se llena.

---

## §4. Backup de secrets/env vars

**NO automatizar** — son strings sensibles, automatizar el backup amplía surface attack si el script se compromete.

### Lista de secrets críticos (al rotar uno, hacer snapshot)

**EasyPanel** (`Service consultora-demo → Environment`):

| Env var | Crítico | Cuándo rotar |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | No (público) | Nunca, salvo migración proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No (público) | Si se regenera JWT secret en Supabase |
| `NEXT_PUBLIC_SITE_URL` | No (público) | Si cambia el dominio público del sitio (robots/sitemap, T-009) |
| `SUPABASE_SERVICE_ROLE_KEY` | **CRÍTICO** | Cada 12 meses o tras leak |
| `ANTHROPIC_API_KEY` | **CRÍTICO** | Cada 12 meses o tras leak |
| `ANTHROPIC_EPP_SUGGEST_MODEL` | Bajo (no secreto) | Si cambiás el modelo del sugeridor EPP (default Haiku 4.5, T-106) |
| `ANTHROPIC_CHAT_MODEL` | Bajo (no secreto) | Si cambiás el modelo del asistente IA de EPP (default Haiku 4.5, T-117) |
| `RESEND_API_KEY` | Alto | Cada 12 meses o tras leak |
| `RESEND_FROM_ADDRESS` | Bajo | Si cambia dominio email |
| `RESEND_REPLY_TO_ADDRESS` | Bajo | Si cambia política reply-to |
| `TELEGRAM_BOT_TOKEN` | **CRÍTICO** | Cada 12 meses o tras leak |
| `TELEGRAM_BOT_USERNAME` | Bajo | Nunca, salvo rename bot |
| `TELEGRAM_WEBHOOK_SECRET` | Alto | Cada 12 meses |
| `INTERNAL_CRON_SECRET` | **CRÍTICO** | Cada 6 meses (lesson T-031 — debe matchear Vault; lo reusa el cron de resumen semanal T-109) |
| `VAPID_PRIVATE_KEY` | **CRÍTICO** | NUNCA (invalida todas las subs push existentes) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Bajo (público) | Junto con private key si rotás |
| `VAPID_SUBJECT` | Bajo | Si cambia email contacto |
| `MP_ACCESS_TOKEN` | **CRÍTICO** | Cada 12 meses o tras leak (token Mercado Pago Subscriptions, T-071) |
| `MP_WEBHOOK_SECRET` | Alto | Cada 12 meses (HMAC del webhook MP `/api/webhooks/mercadopago`) |
| `ARS_PRICE_MONTHLY` | Bajo (no secreto) | Cuando ajustás el precio del plan (centavos ARS, T-070/T-108) |
| `BILLING_GATE_DISABLED` | Bajo (no secreto) | **Debe ser `false` en prod** — un `true` deja la app sin trial gate (T-073) |
| `UPSTASH_REDIS_REST_URL` | Alto | Si cambia proyecto Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Alto | Cada 12 meses |
| `SENTRY_AUTH_TOKEN` | Alto | Cada 12 meses (build-time, upload de source maps) |
| `SENTRY_ORG` | Bajo | Casi nunca (org slug Sentry; build-time) |
| `SENTRY_PROJECT` | Bajo | Casi nunca (project slug Sentry; build-time) |
| `NEXT_PUBLIC_SENTRY_DSN` (público) | Bajo | Nunca, salvo nuevo proyecto Sentry |

**Vault Supabase** (`Project → Vault`):

- `cron_dispatch_secret` (= debe matchear `INTERNAL_CRON_SECRET` de EasyPanel)
- `cron_dispatch_base_url` (= `https://consultora-demo.test-ia.cloud`)

> **Fuente de verdad de env vars:** `src/env.ts` (schema Zod, valida al boot). Al agregar una env var nueva ahí, sumala también a esta tabla. T-109 (resumen semanal) NO agregó secret nuevo: reusa `INTERNAL_CRON_SECRET`. Quedan fuera de esta tabla las de infra/build que no son secrets ni config de negocio: `NODE_ENV`, `PORT`, `INTERNAL_BASE_URL`, `LOG_LEVEL`, `CHROMIUM_PATH`, `GIT_SHA`.

### Procedimiento de backup manual

Al rotar CUALQUIER secret crítico:

1. Generar nuevo valor (`openssl rand -hex 32` para secrets, regenerar en provider para API keys).
2. **Guardar el viejo valor con timestamp en tu password manager personal** (1Password / Bitwarden / Proton Pass) bajo entry `consultora-demo-secrets-history/<env_var_name>/YYYY-MM-DD`.
3. Actualizar en EasyPanel UI + (si aplica) en Vault Supabase **inmediatamente, sin intermediarios** (lesson T-031: copy/paste entre 2 UIs introduce typos invisibles).
4. Redeploy desde EasyPanel.
5. Smoke test del feature afectado.

Razón del backup del viejo valor: si el rollback es necesario en las próximas 24h, recuperar es 1 min vs 4 horas de troubleshooting.

---

## §5. Restore — Escenario A: data perdida o DB corrupta

**Cuándo aplicar:** un user borró por accidente data importante (un informe firmado, una consultora entera), o detectaste corrupción en una tabla específica.

**Tiempo estimado:** 10-30 min (restore full) → +30-60 min (restore selectivo).

**Precondición:** tenés un **dump manual reciente** (`pnpm backup:db`, §2). ⚠️ En Free **no hay restore por dashboard ni PITR** — el restore te lleva al estado del **último dump**, no a un punto arbitrario. Lo creado entre el último dump y el incidente se pierde.

### Restore full (DB entera al estado del dump)

1. **No tocar nada en producción** hasta confirmar el plan. Comunicar el incidente: "investigando, restore en curso".
2. Identificar el último dump pre-incidente en `backups/db/` (o bajarlo de Drive). El timestamp del nombre es la hora de corte.
3. **WARNING**: cargar un dump completo es **destructivo** — reescribe la DB. Toda la data posterior al dump se pierde.
4. Cargar el dump con `psql` apuntando a la connection string productiva:
   ```bash
   psql "$SUPABASE_DB_URL" -f backups/db/<YYYY-MM-DD-HHmmss>.sql
   ```
   (Si la DB quedó en estado inconsistente, primero resetear el schema — `pnpm db:reset` contra la instancia destino — o cargar solo la data; ver Troubleshooting.)
5. Smoke test post-restore:
   - Login en producción.
   - Verificar que la data perdida volvió.
   - Verificar que features críticas funcionan (crear informe, generar PDF, vincular cliente).
6. **Storage NO se restaura con esto** — ver §6 si el incidente afectó imágenes / PDFs / firmas EPP.
7. Comunicar el cierre: "restore completo, data al estado YYYY-MM-DD HH:MM UTC (último dump), X horas de data perdidas".

### Restore selectivo (recuperar rows puntuales sin reescribir la DB)

Cuando el restore full es overkill (ej: recuperar 1 informe borrado sin perder el resto de la data posterior):

1. Levantar una **instancia temporal** con el dump: Supabase local (`pnpm db:start` + cargar el `.sql`) o un proyecto Supabase nuevo (Free permite hasta 2 por org).
2. Conectar con admin client a la instancia temporal y **exportar las rows específicas** que necesitás recuperar.
3. **Aplicar las rows en producción.** Re-insertar filas perdidas en tablas normales es directo; pero si tocás tablas **append-only** (`audit_log`, `notification_log`, `billing_notifications_log`) con un `DELETE`/`UPDATE`, el trigger de inmutabilidad lo bloquea → ver **§5.1**.
4. Borrar la instancia temporal.

Tiempo extra: +30-60 min.

### §5.1 Restore selectivo sobre tablas append-only (triggers de inmutabilidad)

Tres tablas son **append-only por trigger** (`BEFORE UPDATE/DELETE` → `RAISE EXCEPTION`). El INSERT de filas recuperadas está permitido; lo que se bloquea es **borrar o modificar** rows (ej: limpiar entradas corruptas, o un cleanup masivo tipo T-111). El error tiene la forma `audit_log es inmutable: DELETE no permitido`:

| Tabla | Triggers | Qué bloquea |
|---|---|---|
| `audit_log` | `audit_log_no_update` / `_no_delete` | UPDATE **y** DELETE (todo) |
| `notification_log` | `notification_log_no_update` / `_no_delete` | UPDATE **y** DELETE (todo) |
| `billing_notifications_log` | `billing_notifications_log_no_update` / `_no_delete` | DELETE siempre; UPDATE solo permite la transición `resend_email_id` NULL→non-NULL |

**Procedimiento** (mismo molde validado en T-111 F2/F2b): deshabilitar los triggers de usuario dentro de un bloque transaccional, hacer el `DELETE`/`UPDATE` del restore, re-habilitarlos — **todo en la misma transacción** para que ninguna ventana quede sin la protección de inmutabilidad:

```sql
do $$
begin
  alter table public.audit_log                 disable trigger user;
  alter table public.notification_log          disable trigger user;
  alter table public.billing_notifications_log disable trigger user;

  -- ... DELETE / UPDATE selectivo del restore acá ...

  alter table public.audit_log                 enable trigger user;
  alter table public.notification_log          enable trigger user;
  alter table public.billing_notifications_log enable trigger user;
end $$;
```

**Gotchas (aprendidos en T-111):**

- **`session_replication_role = 'replica'` NO sirve en Supabase.** El rol `postgres` no es superuser → tira `42501 insufficient privilege`. Hay que usar `ALTER TABLE ... DISABLE TRIGGER USER` explícito, tabla por tabla.
- **`disable trigger user`** apaga solo los triggers de usuario; los internos de FK (`RI_ConstraintTrigger`) siguen activos, así que las foreign keys mantienen la integridad referencial durante el restore.
- **`billing_notifications_log` no es 100% inmutable**: su trigger permite el UPDATE `resend_email_id` NULL→non-NULL (claim→confirmed). Para un restore que toque otras columnas igual hay que deshabilitarlo.
- **`notification_digest_log` (T-109) NO tiene trigger** — es append-only solo por un UNIQUE constraint (idempotencia del resumen semanal). No necesita `disable trigger`, pero un re-insert puede chocar la UNIQUE key; usar `on conflict do nothing` o limpiar la fila previa.
- Para borrados masivos hijo→padre (cleanup tipo T-111 F2, no restore puntual): además del `disable trigger user`, respetar el **orden topológico de las FK** (las FK intra-dominio son `RESTRICT`; el cascade no alcanza).

---

## §6. Restore — Escenario B: VPS caído (EasyPanel / Hostinger)

**Cuándo aplicar:** Hostinger discontinuó el VPS, EasyPanel se corrompió irrecuperable, o decidiste migrar a otro provider.

**Tiempo estimado:** 2-4 horas con runbook bien hecho.

**Precondición:** DB Supabase intacta + backup Storage local reciente + secrets backupeados en password manager.

### Pasos

1. **Provisionar VPS nuevo:**
   - Hostinger KVM2 ($8.99/mo): 8 GB RAM + 50 GB SSD + Ubuntu 24.04. Igual specs que actual (ADR-0007).
   - Alternativa migración: DigitalOcean / Linode / Vultr con specs equivalentes.
   - Tiempo: 5-10 min.

2. **Instalar Docker + EasyPanel** (siguiendo ADR-0007 sección "Setup EasyPanel"):
   - Tiempo: 15-30 min.

3. **Configurar DNS:**
   - Apuntar `consultora-demo.test-ia.cloud` (A record) al IP del VPS nuevo.
   - Esperar propagación DNS (1-30 min).

4. **Crear Service en EasyPanel:**
   - Image source: GitHub repo `LautiRoveda/consultora-demo`.
   - Branch: `main`.
   - Build context: `/` (root).
   - Dockerfile: `Dockerfile` (multi-stage Node 22 alpine).
   - Auto Deploy: habilitar webhook GitHub.
   - Domain: `consultora-demo.test-ia.cloud` con TLS Let's Encrypt.

5. **Restaurar env vars** (~25 strings) desde tu password manager:
   - Copy/paste cada env var a EasyPanel UI.
   - **NO copiar de pantalla compartida ni de mensajes** (typos invisibles, lesson T-031).
   - Verificar que `INTERNAL_CRON_SECRET` matchee `cron_dispatch_secret` en Vault Supabase.

6. **Deploy inicial:**
   - Click "Implementar" en EasyPanel.
   - Esperar build (~3-5 min).
   - Verificar logs por errores de build (env vars faltantes son las más comunes — lesson T-031 hotfix #72).

7. **Smoke test productivo:**
   - `curl https://consultora-demo.test-ia.cloud/api/health` → 200 OK.
   - Login + crear informe + generar PDF.
   - Verificar cron de notificaciones (esperar 1 tick, ~5min).

8. **Restore Storage** si los archivos se perdieron en la migración (improbable — Supabase Storage es independiente del VPS):
   - Si DB tiene rows en `informe_attachments` pero los buckets están vacíos → restaurar desde el último backup local.
   - Subir cada archivo del dump usando service-role + `supabase.storage.from(...).upload(...)`.
   - Tiempo: 30-60 min depending del volumen.

9. **Decommission VPS viejo** (si aplica):
   - Solo después de 7 días de operación estable del VPS nuevo.
   - Pausa + snapshot + cancel.

### Si el dominio se pierde

Si `consultora-demo.test-ia.cloud` no es recuperable (registrar expirado, hijack DNS), comunicar a usuarios via Telegram/email (el cron sigue funcionando vía Supabase) la URL nueva temporal hasta resolver el dominio.

---

## §7. Restore — Escenario C: account hijack Supabase (worst case)

**Cuándo aplicar:** alguien obtuvo acceso a tu cuenta Supabase (phishing, leak credencial, etc) y modificó/borró data, rotó secrets, o exfiltró el contenido.

**Tiempo estimado:** 4-6 horas.

**Precondición:** soporte Supabase responde rápido + tenés un **DB dump manual reciente** (`pnpm backup:db`, §2 — en Free es tu ÚNICO respaldo de la DB).

### Pasos

1. **Contactar soporte Supabase INMEDIATAMENTE:**
   - Email: `support@supabase.io`.
   - Subject: `SECURITY INCIDENT — account hijack — project consultora-demo`.
   - Solicitar:
     - Logs de access al dashboard últimas 72h.
     - Suspensión temporal del proyecto comprometido (NO delete — conserva los backups).
     - Provisión de proyecto nuevo en la misma org.

2. **Mientras esperás respuesta** (1-12h):
   - Rotar TODOS los secrets en EasyPanel (asume que `SUPABASE_SERVICE_ROLE_KEY` está comprometido):
     - `ANTHROPIC_API_KEY` (regenerar en Anthropic console).
     - `RESEND_API_KEY` (regenerar en Resend dashboard).
     - `TELEGRAM_BOT_TOKEN` (regenerar via @BotFather `/revoke`).
     - `INTERNAL_CRON_SECRET` (`openssl rand -hex 32`).
     - `UPSTASH_REDIS_REST_TOKEN` (regenerar en Upstash).
     - `SENTRY_AUTH_TOKEN` (regenerar en Sentry).
     - `VAPID_PRIVATE_KEY` — **NO rotar** (invalida todas las subs push de users legítimos; el secret no permite acceso a DB).
   - Mantener el service viejo down (apagar en EasyPanel) para evitar trafico al proyecto comprometido.

3. **Una vez Supabase aprovisiona proyecto nuevo:**
   - Restaurar la DB desde tu último **dump manual** (`pnpm backup:db`), cargándolo con `psql` al proyecto nuevo (ver §5).
   - Si NO hay dump utilizable (nunca corriste `backup:db`, o el último es viejo): pérdida total de data — onboarding manual desde cero con users existentes. (En Free no hay backup del lado de Supabase que soporte pueda restaurar.)

4. **Reconfigurar el ecosistema:**
   - Generar nuevo `SUPABASE_SERVICE_ROLE_KEY` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` del proyecto nuevo.
   - Actualizar env vars en EasyPanel.
   - Re-cargar Vault con `cron_dispatch_secret` matcheando nuevo `INTERNAL_CRON_SECRET`.
   - Re-configurar webhook Telegram apuntando a la URL productiva:
     ```bash
     curl -F "url=https://consultora-demo.test-ia.cloud/api/webhooks/telegram" \
          -F "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
          "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook"
     ```
   - Re-verificar dominio Resend (DNS records SPF+DKIM+DMARC siguen apuntando bien).
   - Re-deploy desde EasyPanel.

5. **Invalidar sesiones de users existentes:**
   - Los JWT viejos firmados con el JWT secret antiguo dejan de ser válidos cuando se rota el secret en Supabase.
   - Comunicar a users: "Por seguridad, necesitamos que vuelvas a iniciar sesión. Si tu cuenta tiene 2FA, no es necesario re-habilitarlo."

6. **Habilitar 2FA en tu cuenta Supabase POST-restore:**
   - Imprescindible para evitar repetición.
   - Considerar password manager con TOTP integrado.

7. **Smoke test exhaustivo:**
   - Todos los flows críticos: signup → crear consultora → invitar member → crear informe → generar IA → publish → notificación cron → unsubscribe.

8. **Post-mortem:**
   - Documentar timeline del incidente.
   - Identificar vector (¿phishing? ¿password reuse? ¿leak credencial?).
   - Comunicar a clientes (si los hubiera) sobre data potencialmente comprometida (compliance GDPR-like Ley 25.326 AR).

---

## §8. Test cuatrimestral de restore

**Frecuencia:** cada 4 meses (~marzo, julio, noviembre).

**Tiempo:** 1-2 horas.

**Objetivo:** validar que los backups efectivamente sirven para restaurar — no solo que existen.

### Checklist

1. **Verificar que tenés un dump de DB reciente** (5 min):
   - Correr `pnpm backup:db` y verificar que el `.sql` no esté vacío (debe tener `CREATE TABLE` / `COPY` / `INSERT`).
   - (En Free no hay backup del lado de Supabase que verificar — el dump manual ES el backup.)

2. **Correr backup Storage manual** (10 min):
   - `pnpm backup:storage`.
   - Verificar output sin errores + tamaño coherente con el mes anterior (3 buckets).

3. **Smoke restore en instancia de prueba** (60-90 min):
   - Levantar Supabase local (`pnpm db:start`) o un proyecto Supabase nuevo temporal (Free permite hasta 2 por org).
   - Cargar el último dump: `psql "<conn-temporal>" -f backups/db/<…>.sql`.
   - Verificar que las tablas críticas tienen data (`consultoras`, `informes`, `calendar_events`).
   - Apuntar un branch local del repo a la instancia temporal (`.env.local.test`).
   - Login + leer un informe + verificar PDF.
   - Borrar la instancia temporal post-test.

4. **Smoke download Storage** (15 min):
   - Descargar un archivo del último dump (`tar -xzf backup-storage-YYYY-MM.tar.gz`).
   - Verificar que el archivo es íntegro (magic bytes correctos, no truncado, no corrupto).

5. **Registrar el test** en `docs/operations/dr-test-log.md` (crear si no existe):
   ```markdown
   ## 2026-09-15 — Test DR Q3
   - Backup DB manual (`pnpm backup:db`): ✅ dump 1.2 MB, CREATE TABLE + COPY presentes.
   - Backup Storage manual (`pnpm backup:storage`): ✅ 24 archivos, 18.3 MB (3 buckets).
   - Restore smoke en instancia temporal: ✅ data íntegra.
   - Issues detectados: ninguno.
   ```

**Si nunca testeás el restore, no tenés backup — tenés esperanza.**

---

## §9. Cuándo upgradear a Supabase Pro

**Free Tier es suficiente hoy** (Lautaro solo + ~2-5 users test). Considerar Pro cuando:

| Trigger | Razón |
|---|---|
| Primer cliente pagando $30/mo | SLA implícito sube — un incidente que cueste $30 de churn es justificación |
| 100+ users productivos | Volumen de data perdida justifica el costo $25/mo x10 |
| Regulatory compliance | Cliente exige retention > 14d o PITR específico |
| Volumen Storage > 500 MB | Free Tier permite 1GB total; Pro sube a 100 GB |
| Concurrent connections > 60 | Free Tier cap a 60 conexiones DB, Pro a 200 |

**Beneficios concretos Pro $25/mo:**

- **DB backups**: backups automáticos diarios + 14 días de retention + PITR a cualquier momento en 7d. **En Free no existe ninguno de los tres** — hoy el único respaldo de DB es `pnpm backup:db` manual (§2).
- **Daily backups descargables** en SQL dump desde el dashboard (rescate sin depender del script manual).
- **Storage**: 100 GB incluidos (vs 1 GB).
- **DB compute**: 0.5 vCPU + 1 GB RAM (vs Shared compute Free).
- **Support**: 24h prioritario vs community-only.
- **No pausa automática** (Free Tier pausa proyectos inactivos > 7 días).

---

## §10. Checklist mensual operativo (10 min)

**Frecuencia:** primer lunes del mes.

```
[ ] 1. Correr `pnpm backup:db` desde repo local (Free NO tiene backup automático — este dump es el ÚNICO respaldo de la DB).
[ ] 2. Correr `pnpm backup:storage` desde repo local (3 buckets).
[ ] 3. Verificar output de ambos: sin errores + tamaños coherentes con el mes anterior.
[ ] 4. Comprimir los folders: tar -czf backup-YYYY-MM-DD.tar.gz backups/db/YYYY-MM-DD-HHMMSS.sql backups/storage/YYYY-MM-DD-HHMMSS/
[ ] 5. Subir el .tar.gz a Google Drive personal → carpeta consultora-demo/backups/.
[ ] 6. Borrar los folders locales (`rm -rf backups/`) — el repo .gitignore lo cubre pero no acumular disk space.
[ ] 7. Revisar Sentry últimas 30 días por errores recurrentes que podrían indicar data corruption silenciosa.
[ ] 8. Si es marzo/julio/noviembre: agendar el test cuatrimestral (ver §8).
```

---

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| `pnpm backup:storage` falla con `permission denied for bucket X` | `SUPABASE_SERVICE_ROLE_KEY` rotada y `.env.local` no actualizado | Copiar service-role key del dashboard Supabase a `.env.local`, retry |
| Script descarga 0 archivos | Buckets vacíos en producción O service-role key apunta a proyecto wrong | Verificar `NEXT_PUBLIC_SUPABASE_URL` en `.env.local` matchea el productivo |
| `pnpm backup:storage` cuelga indefinidamente | Network timeout o rate limit Supabase | Reintentar en off-peak hours (madrugada Argentina = mediodía UTC) |
| `pnpm backup:db` falla por `SUPABASE_DB_URL` faltante | No está la connection string en `.env.local` | Copiar la URI de Project Settings → Database → Connection string a `.env.local` |
| Buscás backups en el dashboard Supabase y no hay ninguno | **Esperado en Free** — Free no tiene backups automáticos | El único backup de DB es `pnpm backup:db` (§2); no hay nada que restaurar desde el dashboard |
| Restore con `psql` falla con `relation already exists` | Cargás un dump full sobre un schema existente | Resetear el schema de la instancia destino antes (`pnpm db:reset`), o cargar solo la data; ver §5 |
| `tar` falla con `file too large` | Total > 8GB (límite tar BSD default) | Usar `tar` GNU (`gtar` en macOS) o split en múltiples archivos |
| Drive personal lleno | Acumulación > 6 meses | Borrar backups intermedios (mantener solo 6 últimos mensuales + 1 anual) |

---

## Decisiones operativas

### Por qué backup Storage manual y no automatizado

1. **Free Tier no tiene cron managed** — automatizarlo requiere infra adicional (GitHub Action + workflow secret).
2. **Volumen bajo MVP** — 10 min/mes es trivial vs surface attack de un script con service-role key en CI.
3. **Backup remoto manual a Drive es defense-in-depth** — si el VPS + Supabase + Drive caen simultáneamente, el incidente es global y nuestro backup no es el problema.

Diferido a follow-up T-082-FU1 cuando se justifique (1er cliente pagando + olvido recurrente).

### Por qué NO incluir secrets en script de backup

Surface attack mayor — un script con acceso a EasyPanel API + Vault API expandido permite movimiento lateral si se compromete. Password manager personal (1Password / Bitwarden) ya es backup adecuado para 25 strings.

### Por qué 3 escenarios y no más

Cubren 95% de incidentes reales. Escenarios adicionales (ej. data leak sin hijack, DDOS, regulatory takedown) requieren respuesta legal/compliance fuera de scope técnico de este runbook.

### Por qué test cuatrimestral y no mensual

El test de restore real es heavy (provisionar proyecto temporal + smoke validation). Mensual sería overhead sin valor. Cuatrimestral cubre 3 ventanas de stress al año, suficiente para detectar drift en el procedimiento.

---

## Follow-ups abiertos

- **T-082-FU1** `tech-debt` (low priority): automatizar backup Storage con GitHub Action cron. Disparador: módulo operativo + Lautaro olvidó correr 2 meses seguidos.
- **T-082-FU2** `feature` (medium priority): integrar backup remoto a Backblaze B2 (~$0.005/GB/mes) o S3-compat. Disparador: 1er cliente pagando + volumen Storage > 1GB.
- **T-082-FU3** `feature` (low priority): provisionar proyecto Supabase staging para test cuatrimestral de restore real. Disparador: upgrade a Supabase Pro (Free Tier permite hasta 2 proyectos pero stress real requiere uno dedicado).
- **T-082-FU4** `feature` (low priority): script de export selectivo (tabla por tabla) para restore granular sin sobrescribir DB completa. Disparador: 1er incidente donde el restore in-place sea overkill.
- **T-082-FU5** ✅ `feature`: doc-as-code anti-drift — test-meta `src/tests/unit/dr-config-coverage.test.ts` (alias `pnpm verify:dr-config`) que valida contra el repo que `.gitignore` cubre `/backups/`, `package.json` tiene `backup:db`/`backup:storage`, los scripts referencian sus env vars correctas, los buckets de §1/§3 matchean `STORAGE_BUCKETS`, y la tabla §4 ↔ las keys de `src/env.ts` (bidireccional, con allowlist documentada de excepciones build-time/dev-only). Corre en CI vía la unit suite — rompe si el runbook se desincroniza.
