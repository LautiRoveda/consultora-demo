-- T-033 · Tabla telegram_subscriptions + RLS + audit trigger.
--
-- Patrón replicado de T-031 (notification_channel_prefs / notification_log).
-- Una row per user (UNIQUE user_id). El flow:
--   1. User pide código → row con link_code + link_code_expires_at, sin chat_id.
--   2. User envía /start <code> al bot → webhook lookup por link_code + atomic
--      UPDATE rellena telegram_chat_id + linked_at + clear link_code.
--   3. User /unlink o bloquea el bot 3 veces → unlinked_at + clear chat_id.
--
-- audit_log.consultora_id es nullable post-T-033 (ver ALTER abajo): las
-- subscriptions son per-user, no per-consultora. La FK a consultoras queda
-- intacta (on delete restrict), pero permitimos null para rows que no tengan
-- contexto multi-tenant. Documentado en CLAUDE.md.

-- =============================================================================
-- AJUSTE T-011: hacer audit_log.consultora_id nullable
-- =============================================================================
--
-- T-033 introduce audit rows sin contexto consultora (subscription per-user).
-- La FK on delete restrict sigue protegiendo la integridad cuando consultora_id
-- está presente. Para rows con consultora_id = null, no hay garantía de
-- vinculación con un tenant — es esperado en eventos per-user.

alter table public.audit_log alter column consultora_id drop not null;

comment on column public.audit_log.consultora_id is
  'Tenant origen del evento. NULL para eventos per-user sin contexto consultora '
  '(ej: telegram_subscriptions T-033). FK on delete restrict cuando NOT NULL.';


-- =============================================================================
-- TABLA telegram_subscriptions
-- =============================================================================

create table public.telegram_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users(id) on delete cascade,
  telegram_chat_id     bigint unique,
  telegram_username    text,
  link_code            text unique,
  link_code_expires_at timestamptz,
  linked_at            timestamptz,
  unlinked_at          timestamptz,
  blocked_count        int not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.telegram_subscriptions is
  'T-033 — vinculación user → bot Telegram. 1 row per user (UNIQUE user_id). '
  'link_code consumible via /start <code>. chat_id nullable hasta linked.';

comment on column public.telegram_subscriptions.telegram_chat_id is
  'Telegram chat_id del DM bot↔user. bigint porque Telegram usa enteros > 2^32.';
comment on column public.telegram_subscriptions.telegram_username is
  '@handle del user en Telegram al momento del link. Puede estar null (los users sin username público).';
comment on column public.telegram_subscriptions.link_code is
  'Código 8 chars alfabeto sin ambiguos. Se invalida tras /start o expira via link_code_expires_at.';
comment on column public.telegram_subscriptions.blocked_count is
  'Incrementa cuando Telegram retorna HTTP 403 (bot bloqueado). A los 3, auto-unlink + disable canal.';
comment on column public.telegram_subscriptions.unlinked_at is
  'NULL = linked activo o nunca linked. NOT NULL = unlinked por /unlink, action del user, o auto-unlink.';


-- Index para lookup del webhook handler en /start <code>.
-- Partial: solo rows con link_code activo (pending de claim).
create index idx_telegram_subs_pending_link on public.telegram_subscriptions(link_code)
  where link_code is not null and linked_at is null;


-- =============================================================================
-- TRIGGER set_updated_at (reusa public.set_updated_at() de T-011)
-- =============================================================================

create trigger set_updated_at_telegram_subscriptions
  before update on public.telegram_subscriptions
  for each row execute function public.set_updated_at();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
--
-- Each user ve y modifica solo lo propio. INSERT/UPDATE solo via user authed
-- O service-role (webhook handler hace lookup cross-user del link_code +
-- claim atómico via service-role).
-- DELETE: sin policy authenticated (default-deny). Admin via service-role.

alter table public.telegram_subscriptions enable row level security;

create policy tg_subs_select_own on public.telegram_subscriptions
  for select using (user_id = auth.uid());

create policy tg_subs_insert_own on public.telegram_subscriptions
  for insert with check (user_id = auth.uid());

create policy tg_subs_update_own on public.telegram_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());


-- =============================================================================
-- AUDIT TRIGGER
-- =============================================================================
--
-- Diff guard sobre business-relevant fields. NO incluir link_code en el payload
-- (seguridad: código consumible — leak via audit_log permitiría a un admin
-- ver códigos generados por users).
-- INSERT: solo audita user_id (no link_code).
-- UPDATE: audita transiciones de linked_at, unlinked_at, blocked_count, +
--         boolean derivado chat_id_is_set (NUNCA el chat_id real — es PII).
-- DELETE: sin trigger (cascade desde auth.users borra; no es business event).

create or replace function public.audit_telegram_subscriptions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (
      consultora_id, actor_user_id, action, entity_type, entity_id, after_data
    )
    values (
      null,
      v_actor,
      'telegram_subscription_created',
      'telegram_subscription',
      new.id,
      jsonb_build_object('user_id', new.user_id)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    -- Diff guard: solo audit si cambia algo business-relevant.
    if (new.linked_at, new.unlinked_at, new.blocked_count, new.telegram_chat_id)
       is distinct from (old.linked_at, old.unlinked_at, old.blocked_count, old.telegram_chat_id) then
      insert into public.audit_log (
        consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data
      )
      values (
        null,
        v_actor,
        'telegram_subscription_updated',
        'telegram_subscription',
        new.id,
        jsonb_build_object(
          'linked_at', old.linked_at,
          'unlinked_at', old.unlinked_at,
          'blocked_count', old.blocked_count,
          'chat_id_was_set', old.telegram_chat_id is not null
        ),
        jsonb_build_object(
          'linked_at', new.linked_at,
          'unlinked_at', new.unlinked_at,
          'blocked_count', new.blocked_count,
          'chat_id_is_set', new.telegram_chat_id is not null
        )
      );
    end if;
    return new;
  end if;
  return null;
end;
$$;

comment on function public.audit_telegram_subscriptions() is
  'T-033 audit trigger para telegram_subscriptions. Diff guard sobre linked_at/'
  'unlinked_at/blocked_count/chat_id. link_code NUNCA en payload (security).';

create trigger audit_telegram_subscriptions_ins
  after insert on public.telegram_subscriptions
  for each row execute function public.audit_telegram_subscriptions();

create trigger audit_telegram_subscriptions_upd
  after update on public.telegram_subscriptions
  for each row execute function public.audit_telegram_subscriptions();
