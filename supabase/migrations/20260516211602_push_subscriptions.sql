-- T-034 · Tabla push_subscriptions + RLS + audit trigger.
--
-- Patrón replicado de T-033 (telegram_subscriptions) — per-user, no per-tenant,
-- audit_log.consultora_id null. Diferencias:
--   * UNIQUE compuesto (user_id, endpoint): un user puede tener N subscriptions
--     (multi-device — Chrome desktop + Chrome Android + etc).
--   * NO link_code: el flow es directo del browser (pushManager.subscribe) sin
--     intermediario async (a diferencia del flow Telegram bot).
--   * NO unlinked_at: borramos el row directo (DELETE) en lugar de soft-unlink.
--     El user puede re-subscribe creando un row nuevo con endpoint distinto.
--   * NO blocked_count: en push no hay equivalente al "user bloqueó el bot".
--     410 Gone del Push Service → cleanup automático del row (sender side).
--
-- audit_log.consultora_id ya es nullable desde T-033 — no requiere nuevo ALTER.


-- =============================================================================
-- TABLA push_subscriptions
-- =============================================================================

create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  endpoint        text not null,
  p256dh_key      text not null,
  auth_key        text not null,
  user_agent      text,
  last_seen_at    timestamptz default now(),
  created_at      timestamptz not null default now(),
  unique (user_id, endpoint)
);

comment on table public.push_subscriptions is
  'T-034 — subscriptions del Web Push API per user/device. UNIQUE (user_id, endpoint) '
  'permite multi-device. Cleanup automático sender-side ante HTTP 410/404.';

comment on column public.push_subscriptions.endpoint is
  'URL del Push Service (FCM/Mozilla autopush/Edge) único por device+browser. '
  'Tratar como secret de routing — NO incluir en audit_log payload.';
comment on column public.push_subscriptions.p256dh_key is
  'Clave pública ECDH P-256 del browser para encripción del payload. base64url. NO en audit_log.';
comment on column public.push_subscriptions.auth_key is
  'Auth secret del browser para encripción del payload. base64url. NO en audit_log.';
comment on column public.push_subscriptions.user_agent is
  'User-Agent del request al subscribe — diagnóstico (qué browser/device). Best-effort.';
comment on column public.push_subscriptions.last_seen_at is
  'Updated por el sender en cada send exitoso. Base para cleanup de stale subs (FU1).';


-- Index para lookup del dispatcher (SELECT por user_id en cada reminder send).
create index idx_push_subs_user on public.push_subscriptions(user_id);


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
--
-- Each user ve y modifica solo lo propio.
-- SELECT/INSERT/DELETE policy authenticated; UPDATE default-deny (service-role
-- del sender hace UPDATE last_seen_at; el client nunca UPDATE-a un row, solo
-- DELETE + re-INSERT si quiere actualizar).

alter table public.push_subscriptions enable row level security;

create policy push_subs_select_own on public.push_subscriptions
  for select using (user_id = auth.uid());

create policy push_subs_insert_own on public.push_subscriptions
  for insert with check (user_id = auth.uid());

create policy push_subs_delete_own on public.push_subscriptions
  for delete using (user_id = auth.uid());


-- =============================================================================
-- AUDIT TRIGGER
-- =============================================================================
--
-- Solo INSERT + DELETE. last_seen_at es operacional (no business-relevant) → sin
-- trigger UPDATE. Payload NUNCA incluye endpoint/p256dh/auth (PII + secret de
-- routing). Solo user_id + boolean derivado de user_agent presente.

create or replace function public.audit_push_subscriptions()
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
      'push_subscription_created',
      'push_subscription',
      new.id,
      jsonb_build_object(
        'user_id', new.user_id,
        'has_user_agent', new.user_agent is not null
      )
    );
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_log (
      consultora_id, actor_user_id, action, entity_type, entity_id, before_data
    )
    values (
      null,
      v_actor,
      'push_subscription_deleted',
      'push_subscription',
      old.id,
      jsonb_build_object(
        'user_id', old.user_id,
        'has_user_agent', old.user_agent is not null
      )
    );
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_push_subscriptions() is
  'T-034 audit trigger para push_subscriptions. INSERT/DELETE only — last_seen_at '
  'operacional sin diff. Payload NUNCA incluye endpoint/p256dh/auth (PII + secret).';

create trigger audit_push_subscriptions_ins
  after insert on public.push_subscriptions
  for each row execute function public.audit_push_subscriptions();

create trigger audit_push_subscriptions_del
  after delete on public.push_subscriptions
  for each row execute function public.audit_push_subscriptions();
