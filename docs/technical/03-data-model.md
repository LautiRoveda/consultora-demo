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

## Esquema SQL completo

### Extensiones requeridas

```sql
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "pgvector";  -- para Fase 4 (búsqueda semántica)
create extension if not exists "pg_cron";   -- jobs programados
```

### M2 · Tenancy

```sql
create table consultoras (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  cuit            text not null,
  plan            text not null default 'trial',  -- trial | pro | team | enterprise
  trial_ends_at   timestamptz,
  mp_subscription_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_consultoras_plan on consultoras(plan);

create table consultora_users (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references consultoras(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  rol             text not null check (rol in ('admin', 'consultor', 'asistente')),
  invited_by      uuid references auth.users(id),
  invited_at      timestamptz,
  joined_at       timestamptz default now(),
  created_at      timestamptz not null default now(),
  unique(consultora_id, user_id)
);

create index idx_consultora_users_user on consultora_users(user_id);
create index idx_consultora_users_consultora on consultora_users(consultora_id);

-- Habilitar RLS
alter table consultoras enable row level security;
alter table consultora_users enable row level security;

-- Policy: el usuario ve solo consultoras de las que es miembro
create policy consultoras_select on consultoras for select
  using (id in (select consultora_id from consultora_users where user_id = auth.uid()));

create policy consultora_users_select on consultora_users for select
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));
```

### M3 · Auditoría

```sql
create table audit_log (
  id              bigserial primary key,
  consultora_id   uuid not null references consultoras(id),
  user_id         uuid references auth.users(id),
  accion          text not null,
  entidad_tipo   text,
  entidad_id     uuid,
  datos_json      jsonb,
  ip              inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);

create index idx_audit_consultora_created on audit_log(consultora_id, created_at desc);
create index idx_audit_entidad on audit_log(entidad_tipo, entidad_id);

-- Trigger: prohibir update y delete (append-only)
create or replace function audit_log_no_modify()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_log es append-only';
end;
$$;

create trigger audit_log_no_update
  before update on audit_log
  for each row execute function audit_log_no_modify();

create trigger audit_log_no_delete
  before delete on audit_log
  for each row execute function audit_log_no_modify();

alter table audit_log enable row level security;

create policy audit_log_select on audit_log for select
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid() and rol = 'admin'));

create policy audit_log_insert on audit_log for insert
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));
```

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

### M10 · Accidentabilidad (mínimo Fase 1)

```sql
create table incidents (
  id                  uuid primary key default gen_random_uuid(),
  consultora_id       uuid not null references consultoras(id) on delete cascade,
  establecimiento_id  uuid references establecimientos(id),
  fecha               date not null,
  tipo                text not null,  -- 'accidente' | 'casi_accidente' | 'enfermedad'
  gravedad            text not null,  -- 'leve' | 'grave' | 'mortal'
  dias_perdidos       int default 0,
  causa_raiz          text,
  empleado_id         uuid references empleados(id),
  descripcion         text not null,
  metadata            jsonb,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id)
);

create index idx_incidents_consultora_fecha on incidents(consultora_id, fecha desc);

alter table incidents enable row level security;

create policy incidents_consultora on incidents for all
  using (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()))
  with check (consultora_id in (select consultora_id from consultora_users where user_id = auth.uid()));
```

### M14 · Pagos

```sql
create table subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  consultora_id         uuid not null references consultoras(id) on delete cascade,
  plan_code             text not null,
  status                text not null,  -- 'trial' | 'active' | 'past_due' | 'cancelled'
  mp_subscription_id    text,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table invoices (
  id              uuid primary key default gen_random_uuid(),
  consultora_id   uuid not null references consultoras(id) on delete cascade,
  subscription_id uuid references subscriptions(id),
  amount_ars      numeric(12, 2),
  amount_usd      numeric(12, 2),
  status          text not null,  -- 'pending' | 'paid' | 'failed' | 'refunded'
  mp_payment_id   text,
  receipt_url     text,
  created_at      timestamptz not null default now()
);

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
