-- T-126 · Persistencia del chat del asistente IA (conversaciones + mensajes).
--
-- PORQUE: el asistente (T-117 / T-117-FU3 / T-125) es STATELESS — el historial vive
-- en useState del cliente y se re-manda entero en cada POST; al recargar se pierde.
-- Chat = data UX PRIVADA POR USUARIO (no compartida en el tenant como
-- clientes/incidentes). NO es dominio HyS de compliance -> SIN audit triggers,
-- soft-delete via archived_at.
--
-- DECISIONES (RFC T-126):
-- - Privacidad per-user: las policies exigen user_id = auth.uid() ADEMAS de
--   is_member_of_consultora(consultora_id). consultora_id se mantiene para el
--   fast-path RLS (JWT claim T-016) y la coherencia Ring A (T-121).
-- - Persistencia client-driven (Option C): un server action escribe estas tablas
--   con el supabase RLS-aware del usuario; el route/orquestador del stream NO se
--   tocan. El cliente persiste exactamente lo que muestra (turno user + assistant
--   juntos) -> coherencia DB<->UI.
-- - Composite FK (T-121): chat_conversaciones gana unique(id, consultora_id);
--   chat_mensajes referencia (conversacion_id, consultora_id) -> coherencia
--   estructural de tenant a nivel DB.
-- - Orden via `seq` identity GLOBAL: los 2 mensajes de un turno comparten now()
--   (mismo statement), asi que created_at no los ordena; seq es el unico tiebreaker
--   monotonico. Las queries ordenan por seq, nunca por created_at.
-- - Mensajes append-only (SELECT + INSERT, sin UPDATE/DELETE), patron incidentes
--   (T-062). El "borrar" de una conversacion es soft-delete (archived_at) via la
--   policy UPDATE de chat_conversaciones; hard-delete solo por cascade de consultora.
--
-- RLS: helpers T-015 (is_member_of_consultora). NO subqueries inline a
-- consultora_members.

-- =============================================================================
-- A. TABLA chat_conversaciones
-- =============================================================================

create table public.chat_conversaciones (
  id            uuid primary key default gen_random_uuid(),
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- titulo derivado del primer mensaje del usuario truncado (sin model call).
  titulo        text not null check (length(trim(titulo)) between 1 and 120),
  created_at    timestamptz not null default now(),
  -- bumpeado en cada turno por el action -> el sidebar ordena por actividad.
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz,
  -- Necesario para el FK compuesto de chat_mensajes (Ring A, T-121).
  constraint chat_conversaciones_id_consultora_id_key unique (id, consultora_id)
);

comment on table public.chat_conversaciones is
  'T-126: conversacion del asistente IA, PRIVADA por user (RLS user_id=auth.uid()). '
  'titulo = primer mensaje del user truncado (sin model call). updated_at bumpeado '
  'por turno (sidebar ordena por actividad). Soft-delete via archived_at. Sin audit.';

-- Lista del sidebar: conversaciones activas del user, por actividad reciente.
create index idx_chat_conversaciones_lista
  on public.chat_conversaciones (consultora_id, user_id, updated_at desc)
  where archived_at is null;

-- updated_at automatico en cada UPDATE (trigger compartido, tenancy.sql).
create trigger set_updated_at_chat_conversaciones
  before update on public.chat_conversaciones
  for each row execute function public.set_updated_at();

-- =============================================================================
-- B. TABLA chat_mensajes (append-only via RLS)
-- =============================================================================

create table public.chat_mensajes (
  id              uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null,
  consultora_id   uuid not null,
  -- user_id = dueño de la conversacion (privacidad RLS directa sin subquery).
  user_id         uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  -- user capeado a 2000 en el borde Zod del action; assistant ~<=4k por
  -- EPP_CHAT_MAX_TOKENS=1024. 8000 da headroom defensivo a nivel DB.
  content         text not null check (length(content) between 1 and 8000),
  created_at      timestamptz not null default now(),
  -- Orden monotonico global: los 2 msgs de un turno comparten now() -> created_at
  -- no los ordena. Las queries ordenan por seq.
  seq             bigint generated always as identity,
  constraint chat_mensajes_conversacion_fkey
    foreign key (conversacion_id, consultora_id)
    references public.chat_conversaciones (id, consultora_id)
    on delete cascade
);

comment on table public.chat_mensajes is
  'T-126: mensajes del chat (append-only via RLS: SELECT + INSERT, sin '
  'UPDATE/DELETE). seq = orden monotonico global (created_at no alcanza: 2 msgs por '
  'turno comparten now()). FK compuesto -> coherencia de tenant (Ring A, T-121). '
  'Se borran solo por cascade de la conversacion.';

create index idx_chat_mensajes_conversacion_seq
  on public.chat_mensajes (conversacion_id, seq);

-- =============================================================================
-- C. RLS (helpers T-015 — privadas por user: is_member_of_consultora + user_id)
-- =============================================================================

alter table public.chat_conversaciones enable row level security;
alter table public.chat_mensajes enable row level security;

create policy chat_conversaciones_select_own on public.chat_conversaciones
  for select using (
    public.is_member_of_consultora(consultora_id) and user_id = auth.uid()
  );
create policy chat_conversaciones_insert_own on public.chat_conversaciones
  for insert with check (
    public.is_member_of_consultora(consultora_id) and user_id = auth.uid()
  );
-- UPDATE necesaria para bump de updated_at + soft-delete (archived_at). Sin DELETE
-- policy: hard-delete solo por cascade de consultora (default-deny authenticated).
create policy chat_conversaciones_update_own on public.chat_conversaciones
  for update
  using (public.is_member_of_consultora(consultora_id) and user_id = auth.uid())
  with check (public.is_member_of_consultora(consultora_id) and user_id = auth.uid());

comment on policy chat_conversaciones_select_own on public.chat_conversaciones is
  'T-126: el chat es privado del user que lo creo (no compartido en el tenant).';

create policy chat_mensajes_select_own on public.chat_mensajes
  for select using (
    public.is_member_of_consultora(consultora_id) and user_id = auth.uid()
  );
-- INSERT exige que la conversacion sea del propio user (defensa extra al FK de
-- tenant): impide inyectar mensajes en una conversacion ajena del mismo tenant.
create policy chat_mensajes_insert_own on public.chat_mensajes
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and user_id = auth.uid()
    and exists (
      select 1 from public.chat_conversaciones c
      where c.id = conversacion_id and c.user_id = auth.uid()
    )
  );

comment on policy chat_mensajes_insert_own on public.chat_mensajes is
  'T-126: append-only. Solo el dueño de la conversacion inserta mensajes en ella. '
  'Sin policy UPDATE/DELETE para authenticated (inmutabilidad efectiva).';

-- =============================================================================
-- D. GRANTS
-- =============================================================================

grant select, insert, update on public.chat_conversaciones to authenticated;
grant select, insert on public.chat_mensajes to authenticated;
grant all on public.chat_conversaciones to service_role;
grant all on public.chat_mensajes to service_role;
