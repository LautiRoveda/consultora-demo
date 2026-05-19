# Disaster Recovery · backup + procedimiento restore

**Ticket:** T-082 (sándwich seguridad 3/4).
**Cuándo correr el runbook completo:** ante incidente real (data perdida / VPS caído / account hijack).
**Tiempo estimado restore:** 5 min (Escenario A) → 4 horas (B) → 6 horas (C).
**Prerequisitos:** cuenta Supabase activa + acceso EasyPanel + `.env.local` con secrets reales + último backup Storage descargado.

---

## §1. Cobertura de backups

Qué se backupea automáticamente y qué requiere acción manual:

| Componente | Backup automático | Frecuencia | Retención | Acción manual requerida |
|---|---|---|---|---|
| **DB Postgres** (Supabase) | ✅ Sí | Diario | 7 días (Free Tier) | Ninguna — verificar visible en dashboard mensualmente |
| **Storage buckets** (`consultora-logos`, `informe-attachments`) | ❌ NO | — | — | `pnpm backup:storage` mensual + subir a Drive |
| **Secrets EasyPanel** (~25 env vars) | ❌ NO | — | — | Export manual al rotar + password manager personal |
| **Vault Supabase** (`cron_dispatch_secret`, `cron_dispatch_base_url`) | ❌ NO | — | — | Copy/paste manual al rotar (cada 6 meses, lesson T-031) |
| **Configuración EasyPanel** (service spec, env vars set) | ❌ NO | — | — | Documentado en ADR-0007 + screenshots periódicos |
| **Código fuente** | ✅ Sí (GitHub) | Cada push | Permanente | Ninguna |

**Critical gap actual:** Storage NO se backupea en ningún tier de Supabase. Si la cuenta se compromete o un bucket se borra accidentalmente con service-role, los logos + adjuntos de informes (incluyendo firmas en imágenes) se pierden. Por eso §3 es no-negociable mensual.

---

## §2. Backup automático Supabase (DB)

### Verificar que está activo

1. Dashboard Supabase → proyecto `consultora-demo` → **Database** → **Backups**.
2. Debe listar 7 backups (uno por día) con timestamp + tamaño.
3. Si la lista está vacía o desactualizada: el proyecto está pausado o hay un issue de billing — revisar status en `https://status.supabase.com`.

### Límites del Free Tier

- **Retention**: 7 días (después se sobrescriben).
- **PITR (Point-In-Time Recovery)**: NO disponible.
- **Manual download**: NO disponible (solo restore in-place desde dashboard).
- **Frecuencia**: 1 vez por día (~03:00 UTC, ventana no garantizada).

### Cuándo upgradear a Pro ($25/mo)

Triggers para considerar el upgrade:

1. **Primer cliente pagando** — el SLA implícito sube; 7d retention es poco si un incidente se descubre con delay.
2. **100+ users productivos** — volumen de data perdida en un incidente cubre el costo del upgrade x10.
3. **Regulatory compliance** — cuando un cliente exija data retention > 14d.

Beneficios Pro:
- **14 días retention** (vs 7).
- **PITR**: restore a CUALQUIER momento dentro de los últimos 7 días (vs solo a snapshots diarios).
- **Daily manual backups descargables** (DB dump en SQL).
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

✅ Backup completo: 21 archivos, 12.45 MB total.
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
| `SUPABASE_SERVICE_ROLE_KEY` | **CRÍTICO** | Cada 12 meses o tras leak |
| `ANTHROPIC_API_KEY` | **CRÍTICO** | Cada 12 meses o tras leak |
| `RESEND_API_KEY` | Alto | Cada 12 meses o tras leak |
| `RESEND_FROM_ADDRESS` | Bajo | Si cambia dominio email |
| `RESEND_REPLY_TO_ADDRESS` | Bajo | Si cambia política reply-to |
| `TELEGRAM_BOT_TOKEN` | **CRÍTICO** | Cada 12 meses o tras leak |
| `TELEGRAM_BOT_USERNAME` | Bajo | Nunca, salvo rename bot |
| `TELEGRAM_WEBHOOK_SECRET` | Alto | Cada 12 meses |
| `INTERNAL_CRON_SECRET` | **CRÍTICO** | Cada 6 meses (lesson T-031 — debe matchear Vault) |
| `VAPID_PRIVATE_KEY` | **CRÍTICO** | NUNCA (invalida todas las subs push existentes) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Bajo (público) | Junto con private key si rotás |
| `VAPID_SUBJECT` | Bajo | Si cambia email contacto |
| `UPSTASH_REDIS_REST_URL` | Alto | Si cambia proyecto Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Alto | Cada 12 meses |
| `SENTRY_AUTH_TOKEN` | Alto | Cada 12 meses |
| `SENTRY_DSN` (público) | Bajo | Nunca, salvo nuevo proyecto Sentry |

**Vault Supabase** (`Project → Vault`):

- `cron_dispatch_secret` (= debe matchear `INTERNAL_CRON_SECRET` de EasyPanel)
- `cron_dispatch_base_url` (= `https://consultora-demo.test-ia.cloud`)

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

**Tiempo estimado:** 5-15 min.

**Precondición:** el incidente ocurrió hace **< 7 días** (Free Tier retention).

### Pasos

1. **No tocar nada en producción** hasta confirmar el plan. Comunicar el incidente: "investigando, restore en curso".
2. Dashboard Supabase → proyecto `consultora-demo` → **Database** → **Backups**.
3. Identificar el último backup ANTES del incidente (cada backup tiene timestamp UTC).
4. Click "Restore" en el backup elegido.
5. **WARNING**: el restore es **destructivo** — sobreescribe la DB actual completa. Toda la data posterior al backup se pierde.
6. Confirmar restore. Tarda ~5-10 min (depende del tamaño).
7. Smoke test post-restore:
   - Login en producción.
   - Verificar que la data perdida volvió.
   - Verificar que features críticas funcionan (crear informe, generar PDF, vincular cliente).
8. **Storage NO se restaura** — verificar §6 si el incidente afectó imágenes/PDFs adjuntos.
9. Comunicar el cierre: "restore completo, data al estado YYYY-MM-DD HH:MM UTC, X horas de data perdidas".

### Si necesitás granularidad mayor

Free Tier no permite restore selectivo de tablas/rows. Workaround:

1. Provisionar un proyecto Supabase nuevo (Free Tier soporta hasta 2 proyectos por org).
2. Restaurar el backup ahí (no en producción).
3. Conectar con admin client al proyecto temporal.
4. Exportar las rows específicas que necesitás recuperar.
5. INSERT manual en producción.
6. Borrar el proyecto temporal.

Tiempo extra: +30-60 min.

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

**Precondición:** soporte Supabase responde rápido + tenés DB dump manual reciente (no garantizado en Free Tier).

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
   - Restaurar DB desde backup automático (el último pre-incidente).
   - Si NO hay backup utilizable (Free Tier solo tiene 7 días, atacante puede haber esperado más): pérdida total de data — onboarding manual desde cero con users existentes.

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

1. **Verificar backup automático Supabase visible** (5 min):
   - Dashboard → Backups → lista no vacía + último < 24h.

2. **Correr backup Storage manual** (10 min):
   - `pnpm backup:storage`.
   - Verificar output sin errores + tamaño coherente con el mes anterior.

3. **Smoke restore en proyecto de prueba** (60-90 min, opcional Free Tier):
   - Provisionar proyecto Supabase nuevo temporal (Free Tier permite hasta 2 por org).
   - Restaurar el backup más reciente.
   - Verificar que las tablas críticas tienen data (`consultoras`, `informes`, `calendar_events`).
   - Apuntar un branch local del repo al proyecto temporal (`.env.local.test`).
   - Login + leer un informe + verificar PDF.
   - Borrar el proyecto temporal post-test.

4. **Smoke download Storage** (15 min):
   - Descargar un archivo del último dump (`tar -xzf backup-storage-YYYY-MM.tar.gz`).
   - Verificar que el archivo es íntegro (magic bytes correctos, no truncado, no corrupto).

5. **Registrar el test** en `docs/operations/dr-test-log.md` (crear si no existe):
   ```markdown
   ## 2026-09-15 — Test DR Q3
   - Backup automático Supabase: ✅ visible, último 2026-09-14 03:12 UTC.
   - Backup Storage manual: ✅ 24 archivos, 18.3 MB.
   - Restore smoke en proyecto temporal: ✅ data íntegra.
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

- **DB backups**: 14 días retention (vs 7) + PITR a cualquier momento en 7d.
- **Daily backups descargables** en SQL dump (rescate independiente del dashboard).
- **Storage**: 100 GB incluidos (vs 1 GB).
- **DB compute**: 0.5 vCPU + 1 GB RAM (vs Shared compute Free).
- **Support**: 24h prioritario vs community-only.
- **No pausa automática** (Free Tier pausa proyectos inactivos > 7 días).

---

## §10. Checklist mensual operativo (10 min)

**Frecuencia:** primer lunes del mes.

```
[ ] 1. Dashboard Supabase → Backups → verificar lista no vacía + último < 48h.
[ ] 2. Correr `pnpm backup:storage` desde repo local.
[ ] 3. Verificar output: sin errores + tamaño total coherente con mes anterior.
[ ] 4. Comprimir el folder: tar -czf backup-storage-YYYY-MM-DD.tar.gz backups/storage/YYYY-MM-DD-HHMMSS/
[ ] 5. Subir el .tar.gz a Google Drive personal → carpeta consultora-demo/backups-storage/.
[ ] 6. Borrar el folder local (`rm -rf backups/storage/YYYY-MM-DD-HHMMSS`) — el repo .gitignore lo cubre pero no acumular disk space.
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
| Dashboard Supabase no muestra backups | Proyecto pausado por inactividad (Free Tier > 7d) | Acceder al dashboard al menos 1x/semana, o upgradear a Pro |
| Backup restore fails con `relation already exists` | DB en estado inconsistente post-incidente | Contactar soporte Supabase — solo ellos pueden hacer restore desde su side |
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
- **T-082-FU5** `feature` (low priority): doc-as-code para evitar drift entre `disaster-recovery.md` y la realidad — script `pnpm verify:dr-config` que valida que `.gitignore` cubre `backups/`, `package.json` tiene `backup:storage`, env vars match Vault, etc.
