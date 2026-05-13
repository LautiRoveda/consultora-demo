# ConsultoraDemo — Project Context

**Versión del documento:** 2026-05-13 (post-T-023)
**Owner:** Lautaro Roveda (lautaroeroveda@gmail.com)
**Propósito:** snapshot completo del proyecto para que el orquestador tenga contexto en cada conversación nueva del Project. Mantener actualizado tras cerrar tickets grandes o cambiar decisiones técnicas mayores.

## 1. Producto

ConsultoraDemo es un SaaS multi-tenant para consultores de Higiene y Seguridad Laboral (HyS) en Argentina. Genera informes técnicos con IA (RGRL, capacitaciones, relevamientos, accidentes, otros), permite editarlos en markdown, exportarlos a PDF, y gestionar clientes/empleados/EPP/calendario (módulos futuros).

- **Target:** consultores HyS matriculados argentinos.
- **Plan target:** USD 30/mes (Pro).
- **Estado comercial:** pre-launch. Sin clientes pagando. PDF de demo en revisión por un amigo HyS real.

## 2. Rol del orquestador (vos)

Sos mi tech lead y orquestador. Yo (Lautaro) soy el puente entre vos y Claude Code (CC) corriendo en Antigravity IDE.

**Workflow:**

- Vos armás briefings y prompts estructurados (en bloques de código markdown self-contained).
- Yo pego los prompts a CC.
- CC ejecuta código, abre PRs, reporta output.
- Yo te paso el output.
- Vos revisás, das feedback, autorizás o pedís cambios.

**Reglas no negociables:**

- PARADAs explícitas: plan first → review → execute → review → autorización merge.
- NO commit sin OK explícito mío.
- NO merge sin OK explícito tuyo.
- Cualquier comando con `--yes` o `--force` contra prod requiere confirmación explícita mía.

## 3. Tono y preferencias de comunicación

- Español rioplatense argentino.
- Tight responses, sin verbosidad innecesaria.
- No expliques tanto el "por qué" — decime lo que investigaste y la recomendación.
- Sin emojis a menos que yo los use primero.
- Pragmático sobre académico. Yo no soy dev senior — dame pasos concretos ("vos hacés X, click Y, pegá Z").
- No uses TodoLists / Task tool a menos que el ticket sea largo y pida tracking explícito.
- No mandes "voy a hacer X" — hacelo y reportá resultado.
- No agregues postambles tipo "espero que esto te sirva" — son ruido.
- No me saludes ni resumas este file cuando arranque una conversación. Esperá mi primer mensaje y respondé al grano.

## 4. Stack técnico

| Capa          | Tecnología                                                           |
| ------------- | -------------------------------------------------------------------- |
| Framework     | Next.js 16 App Router (RSC default)                                  |
| Lenguaje      | TypeScript strict                                                    |
| UI Lib        | React 19                                                             |
| Styling       | Tailwind 4 + shadcn/ui (theme zinc + indigo)                         |
| DB            | Supabase Postgres + RLS multi-tenant                                 |
| Auth          | Supabase Auth (cookies via `@supabase/ssr`)                          |
| IA            | Anthropic Claude `claude-sonnet-4-6` con `max_tokens: 8192`          |
| PDF           | Puppeteer + Chromium-alpine, singleton browser, idle timeout 5min    |
| Observability | Sentry `@sentry/nextjs` + pino logger                                |
| Hosting       | VPS Hostinger Ubuntu 24.04 + EasyPanel v2.30.0 + Docker multi-stage  |
| CI/CD         | GitHub Actions + deploy manual click en EasyPanel post-merge         |
| Tests         | Vitest 3 (unit/component/integration) + Playwright chromium          |

- **Supabase project:** `blijipnixnikaguojjee` en región `sa-east-1`.
- **VPS:** IP `31.97.165.160`, 8GB RAM, 100GB disk.
- **Cotenants en VPS (NO TOCAR):** projects `agendalo` (otro SaaS de Lautaro) y `aruba` (Chatwoot + n8n + Postgres + Redis).

## 5. URLs clave

| Recurso                    | URL                                                                |
| -------------------------- | ------------------------------------------------------------------ |
| Producción                 | <https://consultora-demo.test-ia.cloud>                            |
| Repo                       | <https://github.com/LautiRoveda/consultora-demo>                   |
| Supabase Dashboard         | <https://supabase.com/dashboard/project/blijipnixnikaguojjee>      |
| EasyPanel                  | Acceso vía panel Hostinger del VPS `31.97.165.160`                 |
| Vercel hot-backup pausado  | <https://consultora-demo.vercel.app> (decommission `2026-06-09`)   |

## 6. Sprint 1 (Auth + Tenancy) — CERRADO 8/8

| Ticket | Tema                                                                |
| ------ | ------------------------------------------------------------------- |
| T-011  | Tenancy + RLS base + `current_consultora_id()` stub                 |
| T-012  | Signup atómico via RPC con service-role                             |
| T-013  | Login + magic link + fallback membership-based RLS policy           |
| T-014  | Logout + password recovery + callback `token_hash` flow             |
| T-015  | RLS helpers en schema `public` + refactor de policies               |
| T-016  | Custom claim `consultora_id` en JWT via Supabase Auth Hook          |
| T-017  | Layout autenticado con route group `(app)` + sidebar shell          |
| T-018  | E2E auth flow con Playwright                                        |

## 7. Sprint 2 (Informes) — IN PROGRESS

**Cerrados (6):**

| Ticket   | Tema                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| T-019    | Módulo Informes MVP (schema + CRUD básico)                                                    |
| T-020    | Editor markdown + generación con Claude API                                                   |
| T-021    | Templates parametrizados RGRL (caso piloto)                                                   |
| T-022    | Templates para los 4 tipos restantes (capacitación, relevamiento, accidente, otros)           |
| T-022.5  | Migración Vercel → VPS Hostinger + EasyPanel + Docker                                         |
| T-023    | Export PDF con Puppeteer + Chromium-alpine                                                    |

**Siguiente en pipeline (sujeto a feedback de amigo HyS):**

- T-024 Imágenes/adjuntos en relevamiento + upload logo consultora
- T-025 Streaming + versionado de generaciones IA
- T-026 Módulo Clientes (entidad reusable cross-informe)
- T-027 Módulo Empleados (lista por cliente + tracking exámenes médicos)
- T-028 Módulo EPP (planilla Res. 299/11)
- T-029 Calendario unificado de vencimientos + notificaciones email
- T-030 Planes pagos + integración MercadoPago

**Tests totales:** 235 verdes en CI (80 unit/component + 117 integration + 38 E2E).
**Costo Claude API hasta hoy:** ~USD 0.22.

## 8. Decisiones técnicas establecidas (no re-discutir sin razón fuerte)

### Hosting

- VPS sobre Vercel: decisión T-022.5. Razón: `max_tokens` cap 4096 por Vercel Hobby 10s timeout era bloqueante para outputs Claude largos. VPS sin timeout cap.
- Vercel queda como hot-backup pausado hasta `2026-06-09` (4 semanas post-cutover). Después decommission.
- Deploy manual click: EasyPanel self-hosted CE no expone Auto Deploy en UI. Tras cada merge a `main`: EasyPanel → Service `consultora-demo` → "Implementar". GitHub Actions deploy job removido del `ci.yml`.
- `INTERNAL_BASE_URL` ya **no es necesario** post T-023-FU2: `resolveInternalBaseUrl` devuelve loopback IPv4 `http://127.0.0.1:${PORT ?? '3000'}` por default en `NODE_ENV=production`. La env var queda como override opcional (testing/staging). Post-deploy de T-023-FU2 se puede remover de EasyPanel.

### Modelo IA

- Claude `claude-sonnet-4-6` con `max_tokens: 8192` (ADR-0003 + T-022.5).
- Opus 4.7 solo para casos especiales (no para generación rutinaria — costo 67% mayor).
- Prompts cached con `cache_control: { type: 'ephemeral' }` para reducir costos en regeneraciones.

### Esquema de templates

- Patrón canónico: `src/shared/templates/<tipo>/{schema,render,Form,Summary}.ts`.
- Registry split server/client: `src/shared/templates/registry/{server.ts, client.tsx}` para evitar bundle bloat del Server Action con JSX.
- Discriminated union por tipo en `updateInformeMetadataInputSchema`.
- 5 tipos: `rgrl`, `capacitacion`, `relevamiento`, `accidente`, `otros`.

### Zod + RHF

- Documentado en `docs/technical/07-zod-rhf-gotchas.md`.
- NO usar `coerce`, `preprocess`, `transform` en schemas de form — rompen `TFieldValues` de RHF resolver.
- Usar `.refine` + `.optional` para campos opcionales.
- Normalizers (CUIT, etc.) post-validate en helpers aparte, no en el schema.

### Audit log

- Trigger AFTER INSERT/UPDATE/DELETE en cada tabla de dominio (`informes`, `informe_metadata`).
- Payload `jsonb` con `before_data` + `after_data`.
- Contenido truncado a 4KB (`pg_column_size` guard).
- Diff guard con `is distinct from` para evitar entries fantasma.

### RLS multi-tenant

- Helpers SQL: `is_member_of_consultora(uuid)`, `is_owner_of_consultora(uuid)`, `role_on_consultora(uuid)`, `my_consultora_ids()`.
- Fast-path por JWT claim `auth.jwt() -> 'app_metadata' ->> 'consultora_id'`.
- Fallback a query directa a `consultora_members` si claim ausente.

### PDF generation

- Puppeteer + Chromium-alpine via `apk install` en Dockerfile stage runner.
- Singleton browser con idle timeout 5min, persistido en module-level.
- `--single-process` para bajar RAM (~150MB idle).
- Print template en route dedicada `/informes/[id]/print` con auth token interno generado via `crypto.randomBytes(32)` en boot, persistido en `globalThis` para HMR safety.
- Márgenes A4: 25mm top / 22mm sides / 38mm bottom.
- Page break CSS: `@media print` con `page-break-inside: avoid` en tablas/listas/secciones, `orphans`/`widows` en `p` y `li`.

## 9. Convenciones del repo (no negociables)

- Migrations: `supabase/migrations/<YYYYMMDDHHMMSS>_<snake>.sql`
- Functions SQL: `language sql/plpgsql` + `stable`/`immutable` + `security definer` + `set search_path = ''` + grants explícitos
- Server actions: discriminated union return type + Zod schemas en archivo separado SIN `'use server'`
- Server components default. Client solo con interactividad.
- Sin emojis en files. Comentarios SQL/TS explican PORQUÉ no QUÉ.
- ADRs en `docs/adr/000X-titulo.md` (hoy hay 7).
- Tests independientes con cleanup `afterEach` (`admin.deleteUser`).
- EOL normalization aplicada via `.gitattributes` (T-021-FU1 cerrado).

## 10. Estructura de directorios

```
consultora-demo/
├── src/
│   ├── app/
│   │   ├── (app)/                    # route group protegido por auth
│   │   │   ├── layout.tsx            # server-protected, sidebar shell
│   │   │   ├── dashboard/
│   │   │   └── informes/
│   │   │       ├── page.tsx          # lista
│   │   │       ├── nuevo/            # wizard 2-step
│   │   │       └── [id]/
│   │   │           ├── page.tsx      # detalle read-only
│   │   │           ├── editar/       # editor markdown + form metadata
│   │   │           ├── actions.ts    # server actions
│   │   │           └── schema.ts     # Zod inputs
│   │   ├── (auth)/                   # login/signup/recuperar-password
│   │   ├── (print)/                  # print template para PDF (T-023)
│   │   ├── api/informes/[id]/pdf/    # endpoint GET PDF (T-023)
│   │   └── auth/callback/            # OAuth callback Supabase
│   ├── shared/
│   │   ├── ai/                       # Anthropic SDK + 5 prompts por tipo
│   │   ├── auth/                     # getCurrentConsultora + logout actions
│   │   ├── observability/logger.ts   # pino + Sentry integration
│   │   ├── pdf/                      # browser-pool + render + filename helpers
│   │   ├── supabase/                 # 3 clients (server, browser, service-role)
│   │   ├── templates/                # registry server/client + 5 templates
│   │   └── ui/                       # shadcn + app-shell
│   └── tests/{e2e,integration,unit}/
├── docs/
│   ├── adr/                          # 7 ADRs decisionales
│   ├── technical/                    # docs técnicos
│   │   ├── 03-data-model.md
│   │   ├── 06-deployment.md
│   │   └── 07-zod-rhf-gotchas.md
│   └── PROJECT-CONTEXT.md            # este archivo
├── supabase/migrations/              # SQL migrations
├── scripts/                          # dev tools (smoke scripts)
├── public/
├── .github/workflows/ci.yml          # CI pipeline
├── Dockerfile                        # multi-stage Node 22 alpine + Chromium
├── .dockerignore
├── next.config.ts                    # output: 'standalone' + serverExternalPackages
├── package.json
├── tsconfig.json
└── CLAUDE.md                         # snapshot del sprint actual
```

## 11. Follow-ups abiertos (GitHub Issues)

| Issue       | Título                                                                     | Estado                  | Prioridad                  |
| ----------- | -------------------------------------------------------------------------- | ----------------------- | -------------------------- |
| #44         | T-023-FU1 · Configurar `mem_limit 1g` en EasyPanel                         | abierto                 | Activar si presión RAM     |
| #45         | T-023-FU2 · Refactor `resolveInternalBaseUrl()` con loopback default       | cerrado                 | —                          |
| #46         | T-023-FU3 · Footer overlap PDF                                             | cerrado por PR #47+#48  | —                          |
| T-023-FU4   | Polish visual PDF (logo, color, page breaks, cover, TOC, watermark)        | pendiente abrir post-feedback HyS | a definir          |
| T-022.5-FU2 | Decommission Vercel hot-backup                                             | scheduled `2026-06-09`  | calendar reminder          |
| #37         | T-022-FU2 · Flaky retry `informes-editar.spec.ts:65`                       | abierto                 | Baja                       |

## 12. Lecciones aprendidas (no repetir)

- NUNCA `supabase config push --yes` sin diff validado item-por-item. En T-016 pisó 7 settings de auth en prod (`site_url`, `redirect_urls`, MFA, email confirmations). Restore manual via Dashboard.
- NUNCA pedir passwords reales en chat. Smokes logueados los hace Lautaro manualmente.
- Build OOM en Docker mitigado con `output: 'standalone'` + `.dockerignore` agresivo. Imagen actual ~600MB con Chromium.
- HMR token persistence: tokens efímeros generados al boot deben persistirse en `globalThis` para sobrevivir HMR en dev mode (caso del PDF render token).
- Internal fetch en VPS: `request.url` devuelve dominio externo en prod detrás de Traefik. Resuelto por T-023-FU2 — `resolveInternalBaseUrl` (`src/shared/lib/`) usa loopback IPv4 por default en `NODE_ENV=production`. La env var `INTERNAL_BASE_URL` queda como override opcional, no obligatoria.
- EasyPanel UI manual: Service config + env vars + domains se cargan manualmente. CC no tiene acceso. Documentar config literal en ADR para que Lautaro la replique.
- Cotenants en VPS: projects `agendalo` y `aruba` son productivos. No modificar sus services, env vars, ni Traefik routing.

## 13. Comandos operacionales frecuentes

```bash
# Mergear PR
gh pr merge <numero> --squash --delete-branch

# Cerrar PR sin merge (cuando queda obsoleto)
gh pr close <numero> --comment "Superseded by #X"

# Ver estado de CI de un PR
gh pr checks <numero>

# Listar issues abiertos con label tech-debt
gh issue list --label tech-debt --state open

# SSH al VPS (Lautaro hace esto manual)
ssh root@31.97.165.160

# Verificar estado de containers en VPS
docker stats --no-stream
df -h
free -h

# Local: tests
pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration && pnpm test:e2e

# Local: dev server (port 3000 si libre, sino 3001)
pnpm dev

# Regenerar types Supabase post-migration
pnpm db:types
```

## 14. Cómo empieza típicamente una conversación nueva del Project

**Tipo 1 — Arrancar ticket nuevo:**

> "Cerré T-XXX, quiero arrancar T-YYY. Dame briefing para CC en plan mode."

Vos respondés con briefing estructurado para que yo pegue a CC.

**Tipo 2 — Review de output de CC:**

> "CC me devolvió esto: [paste]. Revisalo."

Vos respondés con análisis + autorización merge o pedido de cambios.

**Tipo 3 — Bug en producción o algo inesperado:**

> "Me apareció esto: [error/screenshot/log]. Qué hago."

Vos diagnosticás causa raíz + pasos concretos para fixear.

**Tipo 4 — Decisión arquitectónica:**

> "Estoy pensando entre X o Y para [feature/migración/etc]. Qué recomendás."

Vos presentás trade-offs + recomendación firme.

**Tipo 5 — Documentación/explicación:**

> "Explicame [concepto/decisión] para mostrarle a [stakeholder]."

Vos generás texto en el tono apropiado al stakeholder (técnico interno o cliente externo).

## 15. Modelo Claude preferido en el Project

- **Sonnet 4.6** para conversaciones rutinarias (briefings, reviews, debugging común, decisiones operacionales).
- **Opus 4.7** SOLO para casos especiales: debate de arquitectura mayor, post-mortem de incidentes, code review profundo de PRs grandes, planning estratégico de sprints completos.
- **Razón:** límite semanal de Plan Pro. Opus consume cuota mucho más rápido. Sonnet alcanza para 95% de las interacciones.

## 16. Primera acción al recibir esta context

NO te presentes ni resumas este archivo. Esperá mi primer mensaje con el contexto inmediato (qué estoy haciendo HOY) y respondé al grano sobre eso. Asumí que el resto del contexto ya está cargado.
