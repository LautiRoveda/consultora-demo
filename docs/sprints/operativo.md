# Operativo / Plataforma (transversal)

Tickets fuera del rango formal `T-001..T-078` del roadmap (`docs/technical/10-roadmap.md`), que tocan operaciones / branding / DX y no pertenecen a un módulo de negocio específico.

## T-079 ✅ Email templates de Supabase Auth con branding ConsultoraDemo

Doc operativo en `docs/operations/email-templates.md` con los 6 HTMLs (Confirm signup + Magic Link + Reset Password + Invite User + Change Email + Reauthentication) + paleta indigo (HEX, equivalentes a tokens `globals.css`) + tipografía system stack + dimensiones (600px container) + skeleton table-based + 2 nice-to-haves heredados (preheader text con `mso-hide: all` para Outlook + `<meta name="color-scheme" content="light">` para evitar inversión en Apple Mail iOS dark mode) + tabla de variables Supabase + compat matrix + instrucciones operativas (aplicar en dashboard, test plan manual, workarounds para variables no testables sin trigger real, rollback plan, migration path a Resend).

Templates aplicables via `Supabase Dashboard → Authentication → Email Templates`. Sin código en repo, sin migrations, sin tests automáticos — verificación es smoke manual disparando flow real desde `/signup`, `/login` magic, `/recuperar-password`. Subject `Confirm Your Signup` (inglés default Supabase) cambia a `Confirmá tu cuenta en ConsultoraDemo`.

URL VPS `consultora-demo.test-ia.cloud` reemplaza todas las menciones del `consultora-demo.vercel.app` deprecado desde T-022.5. SMTP queda en default Supabase para trial — evaluar Resend custom SMTP si el rate limit (~30 emails/h por proyecto free tier) se vuelve cuello de botella.

Cierra referencia circular pre-existente en `supabase/README.md` L161-167 (decía "wording final en el PR de T-012/T-013/T-014" y los PRs decían "wording final en supabase/README.md" — ahora ambos apuntan al doc operativo).

## T-052-FU2 ✅ Cierre lite — runbook escenario 2 + monitor Better Stack

Documentado el trigger secundario del incident T-052 (EasyPanel deploy via webhook resetea `endpoint-mode` → 502 hasta SSH manual). Decisión Lautaro 20/05/2026: NO investigar empíricamente ni automatizar stopgap por baja frecuencia esperada (1-2 deploys/sprint en esta fase, sin users productivos reales). Mitigación intermedia: monitor uptime free (Better Stack + alerta Telegram) detecta 502 > 5 min sostenidos, fix manual ~30s siguiendo runbook escenario 2. Setup operativo: `docs/operations/uptime-monitoring.md`. Decisión NO-auto-fix global (T-052-FU1) sigue vigente; el monitor sólo notifica, no toca el swarm. Reactivar T-052-FU2 full (investigación empírica + stopgap automatizado) si: >3 incidents/sprint, O 1 incident con 502 > 30 min, O llegan users productivos reales con SLA implícito.

## Seguros forward / Tech debt cross-modules

- **T-NOR (Normalización denormalized `consultora_id`)**: evaluar trigger BEFORE INSERT auto-populate `consultora_id` desde parent FK aplicado a TODAS las tablas con denormalización (`epp_entrega_items`, `empleados_puestos`, `informe_attachments`, `calendar_event_reminders`). **NO crear ahora** — emerge si:
  - Bug por olvido pasar `consultora_id` en algún server action nuevo.
  - O si la verbose del Insert pattern bloquea velocidad de desarrollo.

  **Decisión**: mantener convención explícita (TypeScript la enforce). Cleanup cross-modules en bloque, no parche puntual. Convención inicial documentada en T-100 (`docs/sprints/sprint-5.md` → Convenciones cerradas).

- **T-111 · DEVEX: aislar integration tests (Supabase local efímero) + cleanup test data prod** (absorbe el ex-`T-DEVEX`). **Causa raíz**: `pnpm test:integration` corría all-at-once contra el Postgres prod-linked compartido → (a) fallas no determinísticas (RLS-claim collisions, fechas epoch por concurrencia) y (b) acumulación de ~14k consultoras de test en prod.
  - **F1 (aislamiento)**: `test:integration` ahora levanta un Supabase local efímero (`supabase start` + `db reset`) e inyecta sus keys (`scripts/test-integration-local.mjs`); cero cambios a la lógica de los tests (todo via `process.env`); `test:integration:remote` queda para debug puntual contra prod. Requiere Docker local. CI de integration (no corría) queda como follow-up.
  - **F2 (cleanup prod)**: borrado batched del test_set (identificación por EXCLUSIÓN: protegido = consultora con ≥1 member email ≠ @example.com; test = orphans con patrón + consultoras con members todos @example.com) vía función secdef con `session_replication_role='replica'` (el cascade re-inserta `audit_log` y bloquea el RESTRICT, por eso no alcanza disable-trigger). Probar PRIMERO en el local de F1 + backup/PITR antes de prod. Dry-run validado: 13.938 test / 4 protegidos (@gmail) / 1 residual ("Debug") sin clasificar.
