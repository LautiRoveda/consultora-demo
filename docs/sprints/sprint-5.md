# Sprint 5 — EPP (Elementos de Protección Personal)

**Status:** 🚧 EN CURSO (1 ticket en review · T-100 schema base)

| Ticket | Status | Descripción |
|--------|--------|-------------|
| T-100 | 🚧 | Migration EPP schema (7 tablas + audit + RLS + trigger post-entrega) |
| T-101 | ⏳ | Server actions CRUD + UI catálogo (categorías/items/puestos) + seed inicial |
| T-102 | ⏳ | UI Entregas + form + invocación post-entrega trigger |
| T-103 | ⏳ | UI Empleado ↔ Puestos (M:N) |
| T-104 | ⏳ | Planilla Res SRT 299/11 PDF + firma digital canvas |
| T-105 | ⏳ | Eventos calendario auto-EPP (validar/completar trigger T-100) |
| T-106 | ⏳ | Padrón empleado + IA sugerencia EPP por puesto |

## Motivación del sprint

EPP es el **pilar #2 del producto** según análisis competitivo (sin EPP "es Word con IA"). Bloqueante pre-launch.

Fuente directa: [docs/feedback/2026-05-23-cliente-higienista-interna-construccion.md](../feedback/2026-05-23-cliente-higienista-interna-construccion.md) — 40m 54s de feedback de cliente higienista construcción, pidió explícitamente:

1. Trazabilidad EPP por empleado individual (no solo por cliente).
2. Recordatorio automático 6 meses (Res SRT 299/11).
3. Diferenciación descartable (guantes nitrilo, antiparras transparentes) vs registrable (casco, borcegos, arnés).
4. Arnés con **número de serie obligatorio** en cada entrega.
5. Inmutabilidad de entregas firmadas (evidencia legal Res 299/11).
6. Búsqueda eficiente — los higienistas hoy revuelven 50-80k planillas físicas en archivos del cliente.

## Decisiones cerradas (pre-T-100)

1. **Schema con 7 tablas** + 2 enums: `epp_categorias`, `epp_items`, `puestos`, `empleados_puestos` (M:N), `epp_entregas`, `epp_entrega_items`, `epp_planificaciones`.
2. **`epp_items.es_descartable boolean`**: descartables NO generan planificación 6m (guantes nitrilo, antiparras transparentes, barbijo N95).
3. **`epp_items.requiere_numero_serie boolean`**: arnés + línea vida requieren `numero_serie` en cada entrega. Validado por BEFORE INSERT trigger (no constraint trigger — el repo no tiene precedente).
4. **`epp_entrega_items.motivo_entrega` enum**: `inicial | renovacion | reposicion_rotura | reposicion_perdida | rotacion`.
5. **`epp_entrega_items.vida_util_meses_override`** nullable: override puntual del default del item (ej: arnés intensivo 6m vs liviano 12m según condiciones).
6. **`gen_epp_planificaciones_y_calendar_for(uuid)` función pública** (NO trigger AFTER INSERT): T-102 server action invoca explícitamente después de poblar `epp_entrega_items`. Razón: si fuera trigger AFTER INSERT en `epp_entregas`, correría con 0 items en la tabla hija (orden de INSERT inverso).
7. **Reusa `calendar_events.tipo='epp_entrega'`** existente (T-027): tipo ya soportado, `reminder_offsets_days=[14,3,0]` ya definido como default EPP en discovery. NO se altera el CHECK constraint.
8. **RLS inmutabilidad legal**: `epp_entregas` + `epp_entrega_items` sin UPDATE/DELETE policy. Correcciones se hacen via nueva entrega con motivo `reposicion_*`.
9. **Soft-delete via `archived_at`** SOLO en catálogos (`epp_categorias`, `epp_items`, `puestos`). Entregas + items + planificaciones NO se borran (legal).
10. **Forward-compat**: `empleados.puesto` text legacy se mantiene. `empleados_puestos` M:N es enrichment opcional para T-103+ (alimenta IA sugerencia EPP por puesto T-106).
11. **`consultora_id` denormalizado** en `epp_entrega_items` + `empleados_puestos` para RLS fast-path sin join al parent (mismo trade-off que T-024 attachments + T-027 `calendar_event_reminders`).
12. **Corrección post-review seguridad**: `gen_epp_planificaciones_y_calendar_for(uuid)` es `security definer` (bypassa RLS) → grant SOLO a `service_role`, revoke de `authenticated/anon/public`. T-102 invoca via `createServiceRoleClient()` desde server action. Sin esto, un user podría invocar con `entrega_id` de otra consultora y generar planificaciones cross-tenant.

## T-100 🚧 Migration EPP schema base

Primer ticket del sprint — schema-only, sienta el patrón para T-101 (CRUD + UI) y T-102 (entregas). Sin server actions, sin UI, sin seed.

**Archivo único**: `supabase/migrations/20260523000001_t100_epp_schema.sql`.

**Estructura** (orden del archivo): A enums (2) · B tablas (7 en orden FK) · C triggers `set_updated_at` (5) · D BEFORE INSERT trigger validación `numero_serie` · E función pública `gen_epp_planificaciones_y_calendar_for(uuid)` · F audit triggers (7 funciones + 21 triggers) · G RLS enable + policies.

**Patrones reutilizados** (no reinventar):

- RLS helpers T-015 ([rls_helpers.sql](../../supabase/migrations/20260511130757_rls_helpers.sql)): `is_member_of_consultora(consultora_id)` en TODAS las policies.
- Audit trigger pattern T-047 ([clientes.sql:106-210](../../supabase/migrations/20260517235110_clientes.sql)): función `audit_<tabla>()` `security definer set search_path = ''` + 3 triggers `after_insert/update/delete` + guard `is distinct from`.
- `set_updated_at()` global T-011 ([tenancy.sql:132-142](../../supabase/migrations/20260511000615_tenancy.sql)).
- `calendar_events.tipo='epp_entrega'` T-027 ([calendar_events.sql:40-41](../../supabase/migrations/20260514125515_calendar_events.sql)).
- Enum pattern T-070 ([t070_pagos_schema.sql:112-127](../../supabase/migrations/20260520000001_t070_pagos_schema.sql)).
- `created_by uuid references auth.users(id) on delete set null` (convención unificada del repo, NO `_user_id`).

**T-102 acoplamiento (importante)**: la server action de cierre de entrega debe instanciar `createServiceRoleClient()` (admin client, sin RLS) y llamar `rpc('gen_epp_planificaciones_y_calendar_for', { p_entrega_id })` post-INSERT de items. Si se invoca desde un cliente `authenticated`, falla con `42501 permission denied`. Patrón consistente con webhook MP (T-071) + cron handlers (T-031/T-074).

**Tests integration** mínimos (`src/tests/integration/epp-schema.test.ts` en T-100 follow-up):
1. RLS cross-tenant: member consultora A NO ve `epp_items` de consultora B.
2. `gen_epp_planificaciones_y_calendar_for` con item NO descartable → crea `epp_planificaciones` + `calendar_events` (tipo=`epp_entrega`, `reminder_offsets_days=[14,3,0]`).
3. Item descartable → NO genera planificación.
4. `epp_entrega_items` con `item.requiere_numero_serie=true` SIN `numero_serie` → falla con errcode `23514`.
5. `empleados_puestos` PK violation al insertar mismo `(empleado_id, puesto_id)` 2×.
6. `vida_util_meses_override=12` → `frecuencia_meses=12` en planificación generada.

**Riesgos conocidos**:

- **Audit log durante CASCADE consultora→epp_***: igual que T-047 test 15 documentó, el audit trigger AFTER DELETE escribe a `audit_log` apuntando a la consultora siendo eliminada, lo cual bloquea el DELETE original por `audit_log_consultora_id_fkey ON DELETE RESTRICT` (T-011). Invariante global del schema. NO bloquea T-100 — solo afecta cleanup admin de consultoras (requiere limpiar audit_log primero).
- **Trigger function vs trigger automático**: el approach explícito (función pública invocable) coloca responsabilidad en T-102 para llamar la función después del INSERT de items. Si T-102 olvida invocarla, las planificaciones no se generan y el calendario queda vacío. Mitigación: test E2E en T-102 que verifica la generación.

## T-101..T-106 ⏳ Scope OUT de T-100

- **T-101** Catálogo: server actions CRUD + queries (`epp_categorias`, `epp_items`, `puestos`) + UI `/epp/catalogo` + UI `/puestos` + seed inicial 15 items default al primer acceso (hook signup o lazy init). ~3-4d.
- **T-102** Entregas: form crear entrega con multi-item picker + canvas firma + invocación `gen_epp_planificaciones_y_calendar_for` via `createServiceRoleClient()`. ~5-7d.
- **T-103** Empleado ↔ Puestos: UI multi-select en detail empleado para asignar puestos del catálogo. ~1-2d.
- **T-104** Planilla Res SRT 299/11 PDF: template + Puppeteer + firma digital embebida + bucket `epp-firmas` storage. ~4-5d.
- **T-105** Calendario auto-EPP: validar que `tipo='epp_entrega'` se renderiza correctamente en `/calendario` con `metadata.empleado_id` + `metadata.epp_item_id` linkeados. ~2-3d.
- **T-106** Padrón + IA sugerencia: query "qué EPP recomiendo a empleado X con puesto Y" → Claude Sonnet 4.6 con context de `puestos.riesgos_asociados` + catálogo + entregas previas + normativa AR. ~3-4d.
