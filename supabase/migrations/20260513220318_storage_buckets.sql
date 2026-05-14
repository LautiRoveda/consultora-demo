-- T-024 · Storage buckets para logos + attachments.
--
-- 2 buckets privados con signed URLs:
-- - consultora-logos:   2 MB cap, solo PNG/JPG/WEBP. Path: <consultora_id>/logo-*.
--   Solo owner puede write. Member puede read (PDF render necesita ver el logo).
-- - informe-attachments: 10 MB cap. PNG/JPG/WEBP + PDF/DOC/XLS.
--   Path: <consultora_id>/<informe_id>/<uuid>.<ext>. Gate creator-OR-owner para
--   write/delete; member para read.
--
-- SVG excluido (vector XSS si se sirve inline; PNG/JPG/WEBP cubren el caso).
-- HEIC/HEIF excluido v1 (requiere conversion server-side con libheif; mensaje
-- UI claro pidiendo conversion a JPG).
--
-- Defensa en profundidad: estas policies son segunda barrera. La primera es
-- el server action / route handler. Si alguna ruta futura olvida el gate,
-- las storage policies lo cubren.
--
-- Helpers SQL T-015 (is_member_of_consultora, is_owner_of_consultora) usados
-- con cast (storage.foldername(name))[1]::uuid: el primer segmento del path
-- es el consultora_id, el segundo (cuando aplica) es el informe_id.


-- =============================================================================
-- BUCKETS
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('consultora-logos', 'consultora-logos', false, 2097152,
   array['image/png','image/jpeg','image/webp']),
  ('informe-attachments', 'informe-attachments', false, 10485760,
   array[
     'image/png',
     'image/jpeg',
     'image/webp',
     'application/pdf',
     'application/msword',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
   ])
on conflict (id) do nothing;


-- =============================================================================
-- POLICIES — consultora-logos
-- =============================================================================

create policy "consultora_logos_read_member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'consultora-logos'
    and public.is_member_of_consultora((storage.foldername(name))[1]::uuid)
  );

create policy "consultora_logos_insert_owner"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'consultora-logos'
    and public.is_owner_of_consultora((storage.foldername(name))[1]::uuid)
  );

create policy "consultora_logos_update_owner"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'consultora-logos'
    and public.is_owner_of_consultora((storage.foldername(name))[1]::uuid)
  );

create policy "consultora_logos_delete_owner"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'consultora-logos'
    and public.is_owner_of_consultora((storage.foldername(name))[1]::uuid)
  );


-- =============================================================================
-- POLICIES — informe-attachments
-- =============================================================================

create policy "informe_attachments_storage_read_member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'informe-attachments'
    and public.is_member_of_consultora((storage.foldername(name))[1]::uuid)
  );

-- Insert: gate creator-OR-owner via EXISTS contra informes. El primer
-- segmento del path es consultora_id, el segundo es informe_id.
create policy "informe_attachments_storage_insert_editor"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'informe-attachments'
    and exists (
      select 1 from public.informes i
      where i.id = (storage.foldername(name))[2]::uuid
        and i.consultora_id = (storage.foldername(name))[1]::uuid
        and public.is_member_of_consultora(i.consultora_id)
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  );

create policy "informe_attachments_storage_delete_editor"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'informe-attachments'
    and exists (
      select 1 from public.informes i
      where i.id = (storage.foldername(name))[2]::uuid
        and (i.created_by = auth.uid() or public.is_owner_of_consultora(i.consultora_id))
    )
  );

-- No policy UPDATE para informe-attachments — los attachments en storage son
-- inmutables (upload + delete; reemplazar = delete + insert).
