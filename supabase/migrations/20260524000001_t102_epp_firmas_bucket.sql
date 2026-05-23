-- T-102 · Storage bucket para firmas de entregas EPP.
--
-- Bucket privado dedicado a las firmas PNG capturadas en /epp/entregas/nueva
-- (canvas HTML5 nativo → toDataURL → base64 → upload). Cap 1 MB, PNG only.
--
-- Path convention: <consultora_id>/<entrega_id>.png
--   - El primer segmento del path es consultora_id (matchea is_member_of_consultora).
--   - El segundo segmento es entrega_id (UUID único, no colisiona).
--
-- RLS:
-- - SELECT for authenticated: members de la consultora pueden leer la firma
--   vía signed URL (TTL 1h) — necesario para mostrarla en detail page y para
--   el render del PDF Res 299/11 en T-104.
-- - INSERT/UPDATE/DELETE: SIN policy para authenticated. Solo service_role
--   puede mutar storage (service_role bypassa RLS por diseño). Justificación:
--   la firma se sube desde el server action createEntregaAction usando
--   createServiceRoleClient(), inmediatamente después de validar auth + role
--   owner + cross-tenant. La defensa en profundidad para este bucket es que
--   ningún path desde el browser puede tocar el bucket.
-- - Inmutabilidad legal Res 299/11: no hay UPDATE policy para authenticated
--   (consistente con epp_entregas que es inmutable post-firma en T-100).


-- =============================================================================
-- BUCKET
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('epp-firmas', 'epp-firmas', false, 1048576, array['image/png'])
on conflict (id) do nothing;


-- =============================================================================
-- POLICIES — epp-firmas
-- =============================================================================

create policy "epp_firmas_read_member"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'epp-firmas'
    and public.is_member_of_consultora((storage.foldername(name))[1]::uuid)
  );

-- INSERT/UPDATE/DELETE: sin policy para authenticated. service_role bypassa RLS
-- por diseño. El server action createEntregaAction usa createServiceRoleClient()
-- post auth/role/cross-tenant gates.
