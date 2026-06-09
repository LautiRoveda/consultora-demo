# Technical 03 · Modelo de datos

Schema completo de Postgres en Supabase. Todas las tablas, todos los índices, todas las RLS policies. Diseñado para soportar las 4 fases del producto, aunque solo las tablas de Fase 1 se pueblen al inicio.

## Convenciones generales

- **IDs:** `uuid` con `gen_random_uuid()` por default. Nunca enteros autoincrementales (multi-tenant + distribución futura).
- **Timestamps:** `timestamptz` para todo. `created_at` y `updated_at` en cada tabla. Trigger automático para `updated_at`.
- **Multi-tenancy:** cada tabla tiene `consultora_id` salvo las globales (catálogos compartidos como `epp_items` master, `task_catalog`).
- **Soft delete:** preferir `archived_at timestamptz nullable` en lugar de delete físico, salvo que sea data efímera.
- **Audit fields:** `created_by` y `updated_by uuid references auth.users(id)` en tablas con cambios significativos.
- **Naming:** snake_case en columnas, plural en tablas (`empleados`, no `empleado`).
- **JSON fields:** `jsonb` siempre (nunca `json`). Schemas Zod en código validan estructura.
- **Indexes obligatorios:** `consultora_id`, todas las FK, columnas usadas en RLS policies.

> **Nota sobre idioma (T-011, 2026-05-10):** los módulos M2 (Tenancy) y M3 (Auditoría) ya están implementados en inglés (ver migración `supabase/migrations/20260511000615_tenancy.sql`). El resto del documento (M4-M14) sigue en español por compatibilidad histórica con el diseño de T-005. **Convención forward: inglés para todos los schemas nuevos.** Cada módulo migra a inglés cuando se implementa (T-019 audit triggers de dominio, T-021 notificaciones, T-024 calendario, etc.). Ver también [ADR-0006 · Multi-tenant RLS strategy](../adr/0006-multi-tenant-rls-strategy.md).

## Esquema SQL completo

### Extensiones requeridas

```sql
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pgvector";  -- para Fase 4 (búsqueda semántica)
create extension if not exists "pg_cron";   -- jobs programados
```

### M2 · Tenancy

Schema implementado en `supabase/migrations/20260511000615_tenancy.sql` (T-011). Naming en inglés. Multi-tenant via custom claim `app_metadata.consultora_id` en JWT (poblado por Auth Hook T-016) → función SQL `current_consultora_id()`. Ver [ADR-0006](../adr/0006-multi-tenant-rls-strategy.md).

```sql
-- Tenant root.
create table public.consultoras (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$' and length(slug) between 3 and 60),
  cuit          text,                       -- nullable hasta primera facturación (T-029)
  plan          text not null default 'trial'
                check (plan in ('trial', 'pro', 'team', 'enterprise')),
  trial_hasta   timestamptz,                -- T-070: renombrado desde trial_ends_at
  retencion_datos_hasta timestamptz,        -- T-070: set al cancelar/expirar; cron futuro deletea cuando alcanza esta fecha (Ley 25.326)
  archived_at   timestamptz,                -- soft delete
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- T-070: plan_tier → plan, trial_ends_at → trial_hasta. Naming español alineado con
-- las tablas nuevas suscripciones/facturas. consultoras.plan queda como cache
-- denormalizado del tier comercial; suscripciones.plan_codigo es el SKU MP. Ver
-- ADR-0008 sección "Naming schema".
create index idx_consultoras_plan on public.consultoras(plan);
create index idx_consultoras_archived on public.consultoras(archived_at) where archived_at is null;

-- Membresía user ↔ consultora (m2m, MVP single-tenant per user pero schema lo soporta).
create table public.consultora_members (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  role          text not null check (role in ('owner', 'member')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, consultora_id)
);

create index idx_consultora_members_consultora on public.consultora_members(consultora_id);

-- Función helper: extrae el tenant id del JWT (app_metadata, inyectado por Auth Hook T-016).
-- Devuelve NULL si no hay claim — comportamiento intencional pre-T-016.
create or replace function public.current_consultora_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(coalesce(auth.jwt() -> 'app_metadata' ->> 'consultora_id', ''), '')::uuid
$$;

-- RLS (default-deny: solo SELECT explícito; mutations via service-role).
alter table public.consultoras enable row level security;
alter table public.consultora_members enable row level security;

create policy consultoras_select_own on public.consultoras
  for select using (id = public.current_consultora_id());

create policy consultoras_update_own_owner on public.consultoras
  for update using (
    id = public.current_consultora_id()
    and exists (
      select 1 from public.consultora_members
      where consultora_members.consultora_id = consultoras.id
        and consultora_members.user_id = auth.uid()
        and consultora_members.role = 'owner'
    )
  );

create policy consultora_members_select_own on public.consultora_members
  for select using (consultora_id = public.current_consultora_id());

-- Policy defensiva pre-T-016 (el user puede leer su propia membership sin custom claim).
create policy consultora_members_select_self on public.consultora_members
  for select using (user_id = auth.uid());

-- Policy defensiva pre-T-016 sobre consultoras (T-013, espejo de la anterior):
-- permite que el dashboard lea SU consultora vía JOIN consultora_members → consultoras
-- sin depender del custom claim del JWT. Combinada con consultoras_select_own via OR.
create policy consultoras_select_own_member on public.consultoras
  for select using (
    exists (
      select 1 from public.consultora_members
      where consultora_members.consultora_id = consultoras.id
        and consultora_members.user_id = auth.uid()
    )
  );
```

**Roles:** `owner` (control total: cambiar plan, invitar/expulsar) | `member` (acceso operativo).

**`mp_subscription_id`:** NO está en T-011. Se suma vía ALTER TABLE en T-029 (Mercado Pago).

### M2.1 · RPC `create_consultora_and_owner` (T-012)

Función `security definer + search_path = ''` invocada desde la server action de signup tras `supabase.auth.signUp()`. Crea consultora (trial 7d, slug normalizado con `unaccent` + sufijo random 4 hex, retry-on-collision hasta 5 intentos) + membership `owner`, en una transacción.

```sql
public.create_consultora_and_owner(p_user_id uuid, p_name text)
  returns table (consultora_id uuid, slug text)
```

Permisos: `revoke from public, anon` + `grant execute to authenticated, service_role`. El caller pasa su propio `user_id` (que coincide con su `auth.uid()` recién creado por signUp).

Implementación completa en `supabase/migrations/20260511004933_signup_function.sql`. Tests: `src/tests/integration/signup.test.ts` (8 tests: trial 7d, owner role, slug normalization de acentos + fallback + colisión + truncate, anon denied).

### M3 · Auditoría

```sql
-- Bitácora inmutable de eventos por tenant. INSERT-only (triggers AFTER en tablas
-- del dominio desde T-019 o service-role para eventos custom).
create table public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  consultora_id uuid not null references public.consultoras(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  action        text not null,                              -- 'created' | 'updated' | 'login_succeeded' | ...
  entity_type   text,
  entity_id     uuid,
  before_data   jsonb,                                       -- snapshot pre-cambio (NULL en CREATE)
  after_data    jsonb,                                       -- snapshot post-cambio (NULL en DELETE)
  ip            inet,
  user_agent    text,
  created_at    timestamptz not null default now()
);

create index idx_audit_log_consultora_created on public.audit_log(consultora_id, created_at desc);
create index idx_audit_log_entity on public.audit_log(entity_type, entity_id) where entity_type is not null;

-- Trigger inmutable: rechaza UPDATE y DELETE (incluso desde service-role).
create or replace function public.audit_log_immutable()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'audit_log es inmutable: % no permitido', tg_op;
end;
$$;

create trigger audit_log_no_update before update on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.audit_log_immutable();

alter table public.audit_log enable row level security;

-- SELECT: todos los miembros de una consultora ven su propio audit_log.
-- (En T-005 era solo admin; T-011 lo abre porque el principio "auditoría como
-- transparencia interna" pesa más que el de "compartimentación por rol" en MVP.)
create policy audit_log_select_own on public.audit_log
  for select using (consultora_id = public.current_consultora_id());

-- INTENCIONAL: sin policy de INSERT. INSERT solo via service-role o triggers AFTER
-- en tablas del dominio (T-019). Default-deny para clientes authenticated/anon.
```

**Diferencias respecto a T-005:**

- `id` es UUID (era `bigserial`) — consistencia con el resto del schema, soporta distribución.
- `actor_user_id` (era `user_id`) con `on delete set null` — preserva el log si el user se borra.
- `before_data` + `after_data` (era `datos_json` único) — diff semántico explícito.
- `action`, `entity_type`, `entity_id` en inglés (era `accion`, `entidad_tipo`, `entidad_id`).
- SELECT policy abierta a todos los miembros (era solo admin).
- Sin policy de INSERT (era con check) — INSERT solo via service-role / triggers, default-deny.

### M2.2 · RLS helpers (T-015)

A partir de T-015, las policies usan **helpers SQL reusables** en lugar de duplicar subqueries inline. 4 funciones `stable security definer set search_path = ''` con `grant execute to authenticated, service_role`:

| Helper | Returns | Equivale a |
|---|---|---|
| `is_member_of_consultora(id)` | `boolean` | `exists (select 1 from consultora_members where user_id = auth.uid() and consultora_id = id)` |
| `is_owner_of_consultora(id)` | `boolean` | idem + `and role = 'owner'` |
| `role_on_consultora(id)` | `text` (`owner`/`member`/`null`) | rol de auth.uid() en la consultora |
| `my_consultora_ids()` | `setof uuid` | consultoras donde auth.uid() es member |

**Regla forward (T-015):** las policies NUEVAS de tablas del dominio (T-019+ clientes, empleados, informes, EPP, ...) deben usar los helpers, NO subqueries inline. Las policies pre-T-015 (`consultoras_update_own_owner` T-011, `consultoras_select_own_member` T-013) ya fueron refactorizadas en `20260511131522_rls_use_helpers.sql` — comportamiento semánticamente idéntico, solo legibilidad.

Las policies basadas en `current_consultora_id()` (T-011) NO usan los helpers porque comparan contra el custom claim del JWT, no contra membership directa. Cómo conviven con los helpers:

- **SELECT (permissive):** Postgres combina policies SELECT con OR. `consultoras_select_own` (via claim) **OR** `consultoras_select_own_member` (via helper) → user ve la consultora si CUALQUIERA matchea. Pre-T-016 solo matchea la del helper; post-T-016 matchean ambas (defense-in-depth inocuo).
- **UPDATE (restrictivo):** `consultoras_update_own_owner` combina las DOS condiciones con AND en su `USING`: `id = current_consultora_id() AND is_owner_of_consultora(id)`. El user debe tener el claim correcto Y ser owner — fail-closed pre-T-016 (sin claim → 0 rows actualizables).

Migration: `supabase/migrations/20260511130757_rls_helpers.sql` define los helpers · `20260511131522_rls_use_helpers.sql` refactoriza las policies pre-existentes · ver `supabase/README.md` para ejemplos de uso.

### M4 · Notificaciones

```sql
create table notification_templates (
  id              uuid primary key default gen_random_uuid(),
  event_type     text not null,  -- 'epp_vencimiento_30dias', 'informe_renovacion', etc.
  channel         text not null,  -- 'email' | 'push' | 'telegram' | 'sms'
  subject_template text,
  body_template   text not null,
  created_at      timestamptz not null default now(),
  unique(event_type, channel)
);

create table notification_preferences (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  event_type     text not null,
  channels        text[] not null default array['email']::text[],
  unique(user_id, event_type)
);

create table notifications_queue (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references consultoras(id) on delete cascade,
  user_id         uuid not null references auth.users(id),
  event_type     text not null,
  channel         text not null,
  payload_json    jsonb not null,
  scheduled_at    timestamptz not null default now(),
  sent_at         timestamptz,
  status          text not null default 'pending',  -- pending | sent | failed
  error           text,
  created_at      timestamptz not null default now()
);

create index idx_notifications_pending on notifications_queue(scheduled_at) where status = 'pending';
create index idx_notifications_user on notifications_queue(user_id, created_at desc);

create table telegram_links (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  telegram_chat_id bigint not null unique,
  link_code       text,
  linked_at       timestamptz default now()
);

alter table notification_preferences enable row level security;
alter table notifications_queue enable row level security;
alter table telegram_links enable row level security;

create policy notif_prefs_own on notification_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notif_queue_own on notifications_queue for select
  using (user_id = auth.uid());

create policy telegram_own on telegram_links for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### M5 · Calendario

```sql
create table calendar_events (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references consultoras(id) on delete cascade,
  tipo            text not null,  -- 'epp_renovacion', 'informe_renovacion', 'calibracion', 'capacitacion', 'custom'
  entidad_origen_modulo text,    -- 'epp', 'informes', etc.
  entidad_origen_id uuid,
  titulo          text not null,
  descripcion     text,
  fecha_vencimiento date not null,
  fecha_alerta    date not null,  -- cuándo notificar
  estado          text not null default 'pendiente',  -- pendiente | atendido | completado | cancelado
  completed_at    timestamptz,
  completed_by    uuid references auth.users(id),
  metadata        jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_cal_consultora_pendiente on calendar_events(consultora_id, fecha_vencimiento) where estado = 'pendiente';
create index idx_cal_alerta on calendar_events(fecha_alerta) where estado = 'pendiente';
create index idx_cal_origen on calendar_events(entidad_origen_modulo, entidad_origen_id);

alter table calendar_events enable row level security;

create policy cal_events_consultora on calendar_events for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));
```

### Clientes y establecimientos

```sql
create table clientes (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references consultoras(id) on delete cascade,
  razon_social   text not null,
  cuit            text not null,
  contacto_nombre text,
  contacto_email  text,
  contacto_tel    text,
  industria       text,
  art             text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create index idx_clientes_consultora on clientes(consultora_id) where archived_at is null;

create table establecimientos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references clientes(id) on delete cascade,
  consultora_id     uuid not null references consultoras(id),  -- denormalizado para RLS
  nombre            text not null,
  domicilio         text,
  provincia         text,
  decreto_aplicable text,  -- '351/79' | '911/96' | '617/97'
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_estab_cliente on establecimientos(cliente_id) where archived_at is null;
create index idx_estab_consultora on establecimientos(consultora_id);

alter table clientes enable row level security;
alter table establecimientos enable row level security;

create policy clientes_consultora on clientes for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));

create policy estab_consultora on establecimientos for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));
```

### M6 · Informes

```sql
create table norm_templates (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null,  -- 'srt_85_12', 'srt_84_12', 'rgrl_463_09', etc.
  nombre            text not null,
  version           text not null,  -- '1.0', '2.0'
  vigencia_desde    date not null,
  vigencia_hasta    date,  -- null = vigente
  prompt_template   text not null,
  marco_normativo   text,
  metadata          jsonb,
  created_at        timestamptz not null default now(),
  unique(codigo, version)
);

create index idx_norm_codigo_vigente on norm_templates(codigo) where vigencia_hasta is null;

create table informes (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references consultoras(id) on delete cascade,
  cliente_id          uuid references clientes(id),
  establecimiento_id  uuid references establecimientos(id),
  tipo                text not null,  -- 'ruido' | 'iluminacion' | 'pat' | 'rgrl' | 'cargafuego'
  norm_template_id    uuid not null references norm_templates(id),
  fecha_medicion      date not null,
  datos_input_json    jsonb not null,
  prompt_usado        text not null,
  contenido_html      text,
  pdf_url             text,
  profesional_id      uuid references auth.users(id),
  estado              text not null default 'borrador',  -- borrador | firmado | presentado
  firmado_at          timestamptz,
  ai_input_tokens     int,
  ai_output_tokens    int,
  ai_cached_tokens    int,
  ai_model            text,
  ai_cost_usd         numeric(10, 5),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

create index idx_informes_consultora_created on informes(consultora_id, created_at desc);
create index idx_informes_cliente on informes(cliente_id) where cliente_id is not null;
create index idx_informes_tipo_estado on informes(tipo, estado);

alter table informes enable row level security;
alter table norm_templates enable row level security;

create policy informes_consultora on informes for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));

create policy norm_templates_read on norm_templates for select using (true);  -- catálogo público
```

### M7 · EPP

```sql
create table epp_items (
  id                uuid primary key default gen_random_uuid(),
  codigo            text unique not null,
  nombre            text not null,
  marca             text,
  talles_disponibles text[],
  vida_util_meses   int default 6,
  norma_iram        text,
  metadata          jsonb,
  created_at        timestamptz not null default now()
);

create table empleados (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references consultoras(id) on delete cascade,
  establecimiento_id  uuid not null references establecimientos(id),
  nombre              text not null,
  dni                 text,
  cuil                text,
  puesto              text,
  talles_json         jsonb,  -- { camisa: 'L', pantalon: '44', calzado: '42' }
  foto_url            text,
  fecha_ingreso       date,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_empleados_estab on empleados(establecimiento_id) where archived_at is null;
create index idx_empleados_consultora on empleados(consultora_id);
create unique index idx_empleados_dni_consultora on empleados(consultora_id, dni) where dni is not null and archived_at is null;

create table epp_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references consultoras(id) on delete cascade,
  empleado_id         uuid not null references empleados(id),
  fecha_entrega       date not null default current_date,
  items_json          jsonb not null,  -- [{ epp_item_id, marca, talle, lote, cantidad }, ...]
  firma_url           text,  -- imagen PNG en storage
  foto_entrega_url    text,
  gps_lat             numeric,
  gps_lng             numeric,
  proxima_entrega_calc date generated always as (fecha_entrega + interval '6 months') stored,
  notas               text,
  registered_by       uuid references auth.users(id),
  created_at          timestamptz not null default now()
);

create index idx_epp_del_empleado on epp_deliveries(empleado_id, fecha_entrega desc);
create index idx_epp_del_consultora on epp_deliveries(consultora_id, fecha_entrega desc);
create index idx_epp_del_proxima on epp_deliveries(proxima_entrega_calc) where proxima_entrega_calc >= current_date;

alter table empleados enable row level security;
alter table epp_deliveries enable row level security;
alter table epp_items enable row level security;

create policy empleados_consultora on empleados for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));

create policy epp_del_consultora on epp_deliveries for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));

create policy epp_items_read on epp_items for select using (true);  -- catálogo público
```

### M8 · Checklists

```sql
create table checklist_templates (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references consultoras(id) on delete cascade,
  nombre          text not null,
  descripcion     text,
  items_json      jsonb not null,  -- [{ id, pregunta, criterio_aprobacion, requerido }]
  tipo_tarea     text,
  tipo_equipo    text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id)
);

create index idx_checklist_tpl_consultora on checklist_templates(consultora_id) where archived_at is null;

create table checklist_executions (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references consultoras(id) on delete cascade,
  template_id     uuid not null references checklist_templates(id),
  ejecutado_por   uuid references auth.users(id),
  contexto_json   jsonb,  -- ej: { establecimiento_id, fecha, ubicacion }
  respuestas_json jsonb not null,  -- [{ item_id, valor, observacion }]
  firmado_at      timestamptz,
  gps_lat         numeric,
  gps_lng         numeric,
  created_at      timestamptz not null default now()
);

create index idx_check_exec_consultora on checklist_executions(consultora_id, created_at desc);
create index idx_check_exec_template on checklist_executions(template_id);

alter table checklist_templates enable row level security;
alter table checklist_executions enable row level security;

create policy chk_tpl_consultora on checklist_templates for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));

create policy chk_exec_consultora on checklist_executions for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));
```

### M10 · Accidentabilidad — libro de incidentes (T-062 ✅)

Implementado en T-062 (UI T-063 + pulido T-063-FU1, en prod). Schema en español;
**append-only por RLS**: corrección = registro nuevo que supersede vía `corrige_id`,
anulación = tombstone (`anulacion=true`), vigencia DERIVADA por la vista
`incidentes_vigentes`. `enfermedad` queda fuera (lógica legal propia → ticket aparte).
Fuente de verdad: `supabase/migrations/20260602000001_t062_incidentes.sql`.

```sql
create type public.tipo_incidente     as enum ('casi_accidente', 'accidente');
create type public.gravedad_incidente as enum ('leve', 'grave', 'mortal');

create table public.incidentes (
  id                uuid primary key default gen_random_uuid(),
  consultora_id     uuid not null references consultoras(id) on delete cascade,
  cliente_id        uuid references clientes(id)  on delete restrict,  -- "dónde ocurrió" (nullable)
  empleado_id       uuid references empleados(id) on delete restrict,  -- víctima (nullable)
  tipo              public.tipo_incidente not null,
  fecha             date not null,
  hora              time,
  lugar_especifico  text check (lugar_especifico is null or length(trim(lugar_especifico)) between 3 and 200),
  descripcion       text not null check (length(trim(descripcion)) between 10 and 4000),
  causa_raiz        text check (causa_raiz is null or length(trim(causa_raiz)) between 1 and 4000),
  accion_inmediata  text check (accion_inmediata is null or length(trim(accion_inmediata)) between 1 and 2000),
  gravedad          public.gravedad_incidente,
  dias_perdidos     int check (dias_perdidos is null or dias_perdidos between 0 and 3650),
  informe_id        uuid references informes(id)   on delete set null, -- link opcional al informe IA (T-075)
  corrige_id        uuid references incidentes(id) on delete set null, -- supersede al registro referenciado
  anulacion         boolean not null default false,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  -- coherencia tipo<->gravedad: accidente exige gravedad; casi_accidente no lleva lesión
  constraint incidentes_gravedad_por_tipo check (
    (tipo = 'accidente' and gravedad is not null)
    or (tipo = 'casi_accidente' and gravedad is null and (dias_perdidos is null or dias_perdidos = 0))
  ),
  constraint incidentes_anulacion_requiere_corrige check (anulacion = false or corrige_id is not null)
);

-- Cadena lineal de correcciones: un registro se corrige/anula a lo sumo una vez.
create unique index uq_incidentes_corrige on incidentes(corrige_id) where corrige_id is not null;
create index idx_incidentes_consultora_fecha on incidentes(consultora_id, fecha desc);

-- Append-only por RLS: SELECT + INSERT con helpers T-015, SIN policy UPDATE/DELETE.
alter table public.incidentes enable row level security;

create policy incidentes_select_own on incidentes for select
  using (public.is_member_of_consultora(consultora_id));

create policy incidentes_insert_own on incidentes for insert
  with check (public.is_member_of_consultora(consultora_id) and created_by = auth.uid());

-- Audit AFTER insert/update/delete -> audit_log (created | corrected | annulled), sin abortar.

-- Vista de vigentes (head de cada cadena): no anulado y nadie lo supersede.
create view public.incidentes_vigentes with (security_invoker = true) as
  select i.* from public.incidentes i
  where i.anulacion = false
    and not exists (select 1 from public.incidentes s where s.corrige_id = i.id);
```

### M14 · Pagos

Implementado en T-070 — schema en español, integración Mercado Pago Subscriptions API.
Ver `supabase/migrations/20260520000001_t070_pagos_schema.sql` + [ADR-0008](../adr/0008-pagos-mercadopago-subscriptions.md).

```sql
-- Enums T-070 — naming español, plan_codigo extensible para SKUs futuros (pro_anual, team_mensual, ...).
create type public.plan_codigo as enum ('pro_mensual');
create type public.estado_suscripcion as enum ('trial', 'activa', 'morosa', 'cancelada', 'expirada');
create type public.estado_factura as enum ('pendiente', 'pagada', 'fallida', 'reembolsada');

create table public.suscripciones (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references public.consultoras(id) on delete cascade,
  plan_codigo         public.plan_codigo not null,
  estado              public.estado_suscripcion not null default 'trial',
  mp_subscription_id  text unique,                      -- preapproval_id de MP; NULL durante trial
  periodo_inicio      timestamptz not null,
  periodo_fin         timestamptz not null,
  cancelar_en         timestamptz,                       -- user pidió cancel, activa hasta esta fecha
  cancelada_en        timestamptz,                       -- MP confirmó cancelación
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- UNIQUE parcial: una sola suscripción "viva" por consultora; canceladas/expiradas conviven históricas.
create unique index uniq_suscripciones_consultora_activa
  on public.suscripciones (consultora_id)
  where estado in ('trial', 'activa', 'morosa');

create table public.facturas (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references public.consultoras(id) on delete cascade,
  suscripcion_id  uuid not null references public.suscripciones(id) on delete restrict,
  monto_centavos  integer not null check (monto_centavos > 0),
  moneda          text not null default 'ARS' check (moneda in ('ARS', 'USD')),
  estado          public.estado_factura not null default 'pendiente',
  mp_payment_id   text unique not null,                  -- UNIQUE = idempotencia webhooks
  recibo_url      text,
  pagada_en       timestamptz,
  razon_falla     text,                                   -- status_detail de MP en eventos failed
  created_at      timestamptz not null default now()
);

-- RLS default-deny: SELECT para members via is_member_of_consultora(); mutaciones solo service_role.
alter table public.suscripciones enable row level security;
alter table public.facturas enable row level security;

create policy "members_select_suscripciones" on public.suscripciones
  for select to authenticated
  using (public.is_member_of_consultora(consultora_id));

create policy "members_select_facturas" on public.facturas
  for select to authenticated
  using (public.is_member_of_consultora(consultora_id));

-- Audit triggers AFTER INSERT/UPDATE/DELETE con diff guard — patrón T-047 audit_clientes.
-- audit_suscripciones() guarda sobre 7 fields mutables; audit_facturas() sobre 4.
```

create table ai_usage_log (
  id              bigserial primary key,
  consultora_id   uuid not null references consultoras(id) on delete cascade,
  user_id         uuid references auth.users(id),
  module          text not null,  -- 'informes' | 'epp_suggestions' | etc.
  model           text not null,
  input_tokens    int not null,
  output_tokens   int not null,
  cached_tokens   int default 0,
  cost_usd        numeric(10, 6) not null,
  duration_ms     int,
  created_at      timestamptz not null default now()
);

create index idx_ai_usage_consultora_date on ai_usage_log(consultora_id, created_at desc);
create index idx_ai_usage_consultora_month on ai_usage_log(consultora_id, date_trunc('month', created_at));

alter table subscriptions enable row level security;
alter table invoices enable row level security;
alter table ai_usage_log enable row level security;

create policy subs_consultora on subscriptions for select
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));

create policy invoices_consultora on invoices for select
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));

create policy ai_usage_consultora on ai_usage_log for select
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid() and rol = 'admin'));
```

### Asistente IA · chat (T-126)

Persistencia del chat del asistente IA. Implementado en T-126 — fuente de verdad:
`supabase/migrations/20260606000001_t126_chat_persistence.sql`. Particularidades vs el resto del
schema: **RLS per-user** (no tenant-shared — dos members de la misma consultora NO se ven los chats
entre sí), **FK compuesta Ring A** (T-121), `seq` identity como tiebreaker de orden, **soft-delete**
(`archived_at`), **sin audit trigger** (dato UX-privado, no dominio de compliance HyS), mensajes
**append-only** (sin policies UPDATE/DELETE → solo INSERT + borrado por cascade de la conversación).

```sql
create table public.chat_conversaciones (
  id            uuid primary key default gen_random_uuid(),
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  titulo        text not null check (length(trim(titulo)) between 1 and 120),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,                          -- soft delete (archivar desde el historial)
  unique (id, consultora_id)                          -- destino del FK compuesto (Ring A, T-121)
);

create table public.chat_mensajes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null,
  consultora_id   uuid not null,
  user_id         uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (length(content) between 1 and 8000),
  created_at      timestamptz not null default now(),
  seq             bigint generated always as identity, -- tiebreaker: user+assistant comparten created_at
  -- FK COMPUESTA Ring A (T-121): garantiza que consultora_id del mensaje == el de su conversación.
  foreign key (conversacion_id, consultora_id)
    references public.chat_conversaciones (id, consultora_id) on delete cascade
);

alter table public.chat_conversaciones enable row level security;
alter table public.chat_mensajes        enable row level security;

-- RLS PER-USER en ambas: el dueño del chat es el user, no la consultora.
create policy chat_conversaciones_select_own on public.chat_conversaciones for select
  using (public.is_member_of_consultora(consultora_id) and user_id = auth.uid());
create policy chat_conversaciones_insert_own on public.chat_conversaciones for insert
  with check (public.is_member_of_consultora(consultora_id) and user_id = auth.uid());
create policy chat_conversaciones_update_own on public.chat_conversaciones for update
  using (public.is_member_of_consultora(consultora_id) and user_id = auth.uid())
  with check (public.is_member_of_consultora(consultora_id) and user_id = auth.uid());
-- sin DELETE policy: hard-delete solo via cascade de la consultora.

create policy chat_mensajes_select_own on public.chat_mensajes for select
  using (public.is_member_of_consultora(consultora_id) and user_id = auth.uid());
create policy chat_mensajes_insert_own on public.chat_mensajes for insert
  with check (
    public.is_member_of_consultora(consultora_id) and user_id = auth.uid()
    and exists (select 1 from public.chat_conversaciones c
                where c.id = conversacion_id and c.user_id = auth.uid())
  );
-- sin UPDATE/DELETE: mensajes append-only (inmutabilidad efectiva por ausencia de policy).
```

**Persistencia client-driven (Option C):** la route de streaming (`POST /api/asistente`) NO escribe
en estas tablas — el cliente persiste el turno que mostró vía la server action `persistChatTurnAction`
(`src/app/(app)/asistente/actions.ts`); el orquestador/route quedan intactos. Detalle del flujo en
la entrada de T-126 en `docs/sprints/operativo.md`.

### Tablas de fases siguientes (placeholders)

Estas tablas se incluyen vacías desde el principio para que la base las soporte sin migración disruptiva cuando llegue su fase. Ver detalle completo en sus migraciones específicas.

- **`task_catalog` y `task_recommendations`** (M9 · Catálogo de Tareas, Fase 3)
- **`work_permits`** (M11 · Permisos de Trabajo, Fase 3)
- **`documents`** con campo `embedding vector(1536)` (M12 · Documentos, Fase 4)
- **`training_materials` y `training_sessions`** (M13 · Capacitaciones, Fase 4)

## Triggers compartidos

```sql
-- Trigger para updated_at automático
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Aplicar a todas las tablas con updated_at
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public'
    and tablename in ('consultoras', 'clientes', 'establecimientos', 'empleados',
                      'informes', 'checklist_templates', 'subscriptions',
                      'calendar_events')
  loop
    execute format('drop trigger if exists set_updated_at on %I', t);
    execute format('create trigger set_updated_at before update on %I for each row execute function set_updated_at()', t);
  end loop;
end $$;
```

## Helpers para RLS performance

```sql
-- Función security definer para obtener consultoras del usuario
create or replace function user_consultoras()
returns setof uuid language sql security definer as $$
  select consultora_id from consultora_users where user_id = auth.uid();
$$;

-- Función security definer para verificar rol
create or replace function user_has_rol(consultora uuid, rol_needed text)
returns boolean language sql security definer as $$
  select exists (
    select 1 from consultora_users
    where consultora_id = consultora
    and user_id = auth.uid()
    and rol = rol_needed
  );
$$;
```

Estas funciones evitan que cada policy ejecute el join en cada query, mejorando performance significativamente.

## Migraciones versionadas

Todas las migraciones viven en `supabase/migrations/` con nombre `YYYYMMDDHHMMSS_descripcion.sql`. Se aplican en orden por Supabase CLI. Nunca se modifica una migración aplicada — para cambios se crea una nueva.

Estructura sugerida del directorio:

```
supabase/
├── migrations/
│   ├── 20260101000000_extensions.sql
│   ├── 20260101000100_tenancy.sql
│   ├── 20260101000200_audit.sql
│   ├── 20260101000300_notifications.sql
│   ├── 20260101000400_calendar.sql
│   ├── 20260101000500_clientes_establecimientos.sql
│   ├── 20260101000600_informes_y_norms.sql
│   ├── 20260101000700_epp.sql
│   ├── 20260101000800_checklists.sql
│   ├── 20260101000900_incidents.sql
│   ├── 20260101001000_pagos_y_ai_usage.sql
│   ├── 20260101001100_triggers_compartidos.sql
│   └── 20260101001200_seed_norm_templates.sql
├── seed.sql                 ← datos de desarrollo
└── config.toml
```

## Tipos generados automáticamente

Después de cada migración, Supabase CLI genera tipos TypeScript que reflejan el schema:

```bash
pnpm supabase gen types typescript --linked > src/shared/supabase/types.ts
```

Esto se corre en CI cuando hay cambios en migrations. El archivo `types.ts` queda en repo. Cualquier desync entre código y schema rompe en compilación.
