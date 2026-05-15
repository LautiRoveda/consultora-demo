-- T-031 · Helper `set_cron_vault_secret` para tests integration y rotacion
-- programatica futura.
--
-- Separado de la migration principal (20260515095701) para mantener esa
-- limpia y porque este helper se identifico durante implementacion del
-- test integration del rpc.
--
-- Allowlist de 2 nombres: cron_dispatch_secret + cron_dispatch_base_url.
-- Defensa contra escritura arbitraria a Vault si el service_role key se
-- filtra (un atacante con service_role aun no podria modificar otros
-- secrets via este helper -- los modificaria directo, pero al menos este
-- vector queda cerrado).
--
-- Restringido a service_role -- Lautaro usa Studio UI para rotacion en
-- MVP.

create or replace function public.set_cron_vault_secret(
  secret_name text,
  new_value text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if secret_name not in ('cron_dispatch_secret', 'cron_dispatch_base_url') then
    raise exception 'set_cron_vault_secret: solo se permiten cron_dispatch_secret o cron_dispatch_base_url, recibido %', secret_name;
  end if;

  select id into v_id from vault.secrets where name = secret_name;
  if v_id is null then
    raise exception 'Secret % no existe; corre vault.create_secret primero', secret_name;
  end if;

  perform vault.update_secret(v_id, new_value);
end;
$$;

comment on function public.set_cron_vault_secret(text, text) is
  $c$T-031: actualizar secrets cron de Vault desde service-role. Allowlist de 2 nombres. Util para tests integration y rotacion programatica futura.$c$;

revoke all on function public.set_cron_vault_secret(text, text) from public;
grant execute on function public.set_cron_vault_secret(text, text) to service_role;
