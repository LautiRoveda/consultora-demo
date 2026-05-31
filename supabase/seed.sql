-- Seed de desarrollo local. Se aplica con `supabase db reset` después de las migrations.

-- T-111 · Vault secrets de cron para los tests de cron/notifications en el stack
-- local efímero. En prod se crean post-deploy (Studio UI); acá el seed los crea
-- para paridad. El valor del secret tiene 64 chars: pasa el placeholder check
-- robusto (length=64) de process_pending_* / process_epp_weekly_summary (T-031/T-109).
-- base_url apunta al stack local. Los secrets YA existen tras las migraciones
-- (creados con placeholder), por eso usamos set_cron_vault_secret (UPDATE) y NO
-- vault.create_secret, que duplicaria (secrets_name_idx 23505).
select public.set_cron_vault_secret('cron_dispatch_secret', repeat('a', 64));
select public.set_cron_vault_secret('cron_dispatch_base_url', 'http://127.0.0.1:54321');
