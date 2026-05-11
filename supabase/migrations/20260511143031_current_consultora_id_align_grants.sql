-- T-016 PARADA #2 · Alinear grants de current_consultora_id() al patron del repo.
--
-- T-011 creo public.current_consultora_id() pero omitio el `revoke all from
-- public, anon` que T-012 (create_consultora_and_owner) y T-015 (4 RLS helpers)
-- ya aplicaron como patron. Resultado: la function quedo con grants default de
-- Postgres (EXECUTE a PUBLIC, anon, authenticated). En la practica no es bug de
-- seguridad — la function lee solo `auth.jwt()` y para anon devuelve NULL sin
-- tocar tablas, no leakea datos. Pero rompe el patron establecido y un refactor
-- futuro del body podria volverlo exploitable.
--
-- Esta migration cierra el drift de manera quirurgica:
--   - revoke from public, anon (consistente con T-012 y T-015)
--   - grant explicit a authenticated, service_role (idem)
--   - NO toca el body de la function (Opcion A: el body de T-011 ya implementa
--     la lectura robusta del claim, validado byte-identico vs version target).
--
-- Side effect a documentar: post-revoke, si en T-019+ algun flow hipotetico
-- intentara llamar current_consultora_id() con client anon, recibe "permission
-- denied" en lugar de NULL silent. Hoy NO hay tales flows en el repo (login,
-- signup, magic link, recovery no invocan tenancy con anon).
--
-- Ticket follow-up T-016-FU2 separado: audit comprehensive de grants en TODAS
-- las functions publicas del schema (no solo current_consultora_id).
--
-- Ver tambien: T-011 (creacion de la function), T-016 PARADA #1 (auth hook que
-- escribe el claim que esta function lee).

revoke all on function public.current_consultora_id() from public, anon;
grant execute on function public.current_consultora_id() to authenticated, service_role;
