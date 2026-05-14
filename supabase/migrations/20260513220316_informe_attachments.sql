-- T-024 · Adjuntos por informe (imagenes y archivos).
--
-- Tabla 1:N con `informes` para soportar imagenes (con caption + reorder)
-- y archivos no-imagen (PDF/DOC/XLS) que se anexan al informe. Las imagenes
-- se renderean como seccion "Anexos visuales" en el PDF; los archivos
-- aparecen solo como tabla de referencia descargable (filename + tipo +
-- tamaño + nota "descargar desde la app").
--
-- consultora_id denormalizado deliberadamente:
-- - RLS policies SELECT simples (sin EXISTS-subquery vs informes).
-- - Index dedicado para queries cross-informe (audit, cleanup jobs).
-- - Tradeoff aceptado: si un informe se mueve de consultora (cosa que no
--   pasa en MVP single-tenant per user, T-016), habria que actualizar
--   esta columna tambien. Documentado para futuro.
--
-- storage_path UNIQUE: garantiza que cada attachment apunta a un objeto
-- distinto en `storage.objects` (no compartir blobs entre rows).
--
-- position SIN unique (informe_id, position): el reorder hace bulk update
-- y la unique forzaria 2 statements (swap temporal). Confiamos en server
-- action para mantener positions unicos.
--
-- RLS:
-- - SELECT: cualquier member de la consultora ve los attachments.
-- - INSERT: creator del informe O owner de la consultora; uploaded_by debe
--   ser auth.uid() (no usurpar identidad).
-- - UPDATE: idem INSERT (para caption + reorder).
-- - DELETE: idem (a diferencia de informes, aca SI hay policy DELETE — el
--   user borra attachments individuales desde UI).
--
-- Audit trigger: patron forward T-019/T-021. Loguea filename + kind +
-- mime + size + caption + position. NUNCA el binario. Diff guard sobre
-- (filename, caption, position) — el resto es inmutable post-insert.
--
-- Cascade storage objects:
-- ON DELETE CASCADE en la FK borra la row; el binario en storage.objects
-- NO se borra automaticamente (Postgres no puede invocar Storage API).
-- Server action de delete attachment hace ambos (Storage primero, luego
-- row). T-024-FU1: cron admin de cleanup huerfanos.


-- =============================================================================
-- TABLA
-- =============================================================================

create table public.informe_attachments (
  id            uuid primary key default gen_random_uuid(),
  informe_id    uuid not null references public.informes(id) on delete cascade,
  consultora_id uuid not null references public.consultoras(id) on delete cascade,
  kind          text not null check (kind in ('image', 'file')),
  storage_path  text not null unique,
  filename      text not null check (length(trim(filename)) between 1 and 255),
  mime_type     text not null,
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  caption       text check (caption is null or length(caption) <= 500),
  position      integer not null default 0,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_informe_attachments_informe_position
  on public.informe_attachments(informe_id, position);

create index idx_informe_attachments_consultora
  on public.informe_attachments(consultora_id);

comment on table public.informe_attachments is
  'T-024: adjuntos por informe (imagenes con caption + reorder, archivos no-imagen). consultora_id denormalizado para RLS simples + queries cross-informe.';

comment on column public.informe_attachments.kind is
  'T-024: discriminador image|file. image va a seccion "Anexos visuales" del PDF; file solo a tabla descargable.';

comment on column public.informe_attachments.storage_path is
  'T-024: path completo dentro del bucket informe-attachments. Formato: <consultora_id>/<informe_id>/<uuid>.<ext>. UNIQUE para evitar duplicados.';

comment on column public.informe_attachments.position is
  'T-024: orden para reorder de imagenes en el PDF. Server action mantiene consecutivos 0..N-1.';


-- =============================================================================
-- TRIGGER DE METADATA
-- =============================================================================
-- Reusa la funcion compartida public.set_updated_at() definida en tenancy.sql.

create trigger set_updated_at_informe_attachments
  before update on public.informe_attachments
  for each row execute function public.set_updated_at();


-- =============================================================================
-- AUDIT TRIGGER
-- =============================================================================
-- Patron forward T-019/T-021. Loguea filename + kind + mime + size + caption +
-- position. NUNCA el binario (storage_path es derivado, no aporta a auditoria).
-- Diff guard sobre (filename, caption, position): el resto (kind, mime, size,
-- storage_path) es inmutable post-insert.

create or replace function public.audit_informe_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before_payload jsonb;
  v_after_payload  jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (new.consultora_id, auth.uid(), 'created', 'informe_attachments', new.id,
       null,
       jsonb_build_object(
         'informe_id', new.informe_id,
         'kind', new.kind,
         'filename', new.filename,
         'mime_type', new.mime_type,
         'size_bytes', new.size_bytes,
         'caption', new.caption,
         'position', new.position
       ));
    return new;

  elsif tg_op = 'UPDATE' then
    if (new.filename, new.caption, new.position) is distinct from
       (old.filename, old.caption, old.position) then
      v_before_payload := jsonb_build_object(
        'filename', old.filename,
        'caption', old.caption,
        'position', old.position
      );
      v_after_payload := jsonb_build_object(
        'filename', new.filename,
        'caption', new.caption,
        'position', new.position
      );
      insert into public.audit_log
        (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
      values
        (new.consultora_id, auth.uid(), 'updated', 'informe_attachments', new.id,
         v_before_payload, v_after_payload);
    end if;
    return new;

  elsif tg_op = 'DELETE' then
    insert into public.audit_log
      (consultora_id, actor_user_id, action, entity_type, entity_id, before_data, after_data)
    values
      (old.consultora_id, auth.uid(), 'deleted', 'informe_attachments', old.id,
       jsonb_build_object(
         'informe_id', old.informe_id,
         'kind', old.kind,
         'filename', old.filename,
         'mime_type', old.mime_type,
         'size_bytes', old.size_bytes
       ),
       null);
    return old;
  end if;
  return null;
end;
$$;

comment on function public.audit_informe_attachments() is
  'T-024: trigger AFTER que escribe a audit_log en INSERT/UPDATE/DELETE de informe_attachments. Diff guard sobre (filename, caption, position). Nunca incluye el binario.';

create trigger audit_informe_attachments_after_insert
  after insert on public.informe_attachments
  for each row execute function public.audit_informe_attachments();

create trigger audit_informe_attachments_after_update
  after update on public.informe_attachments
  for each row execute function public.audit_informe_attachments();

create trigger audit_informe_attachments_after_delete
  after delete on public.informe_attachments
  for each row execute function public.audit_informe_attachments();


-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.informe_attachments enable row level security;

-- SELECT: cualquier member de la consultora ve los attachments.
create policy informe_attachments_select_own on public.informe_attachments
  for select using (
    public.is_member_of_consultora(consultora_id)
  );

-- INSERT: member de la consultora Y (creator del informe O owner) Y se atribuye a si mismo.
-- Mismo gate que informes UPDATE (T-019). uploaded_by = auth.uid() evita usurpacion.
create policy informe_attachments_insert_own on public.informe_attachments
  for insert with check (
    public.is_member_of_consultora(consultora_id)
    and uploaded_by = auth.uid()
    and exists (
      select 1 from public.informes i
      where i.id = informe_attachments.informe_id
        and i.consultora_id = informe_attachments.consultora_id
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  );

-- UPDATE: idem INSERT (caption + position). USING + WITH CHECK simetricos.
create policy informe_attachments_update_own on public.informe_attachments
  for update
  using (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.informes i
      where i.id = informe_attachments.informe_id
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  )
  with check (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.informes i
      where i.id = informe_attachments.informe_id
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  );

-- DELETE: idem gate (creator OR owner). A diferencia de informes (default-deny),
-- aca SI hay policy DELETE porque el user borra attachments individuales desde UI.
create policy informe_attachments_delete_own on public.informe_attachments
  for delete using (
    public.is_member_of_consultora(consultora_id)
    and exists (
      select 1 from public.informes i
      where i.id = informe_attachments.informe_id
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  );

comment on policy informe_attachments_select_own on public.informe_attachments is
  'T-024: SELECT por membership de la consultora del attachment. Helper is_member_of_consultora.';
comment on policy informe_attachments_insert_own on public.informe_attachments is
  'T-024: INSERT por creator del informe O owner de la consultora; uploaded_by debe ser auth.uid().';
comment on policy informe_attachments_update_own on public.informe_attachments is
  'T-024: UPDATE por creator del informe O owner. USING + WITH CHECK simetricos.';
comment on policy informe_attachments_delete_own on public.informe_attachments is
  'T-024: DELETE por creator del informe O owner. Server action borra storage object antes de la row.';
