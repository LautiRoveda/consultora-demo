-- Seed de desarrollo local. Se aplica con `supabase db reset` después de las migrations.

-- T-111 · Vault secrets de cron para los tests de cron/notifications en el stack
-- local efímero. En prod se crean post-deploy (Studio UI); acá el seed los crea
-- para paridad. El valor del secret tiene 64 chars: pasa el placeholder check
-- robusto (length=64) de process_pending_* / process_epp_weekly_summary (T-031/T-109).
-- base_url apunta al stack local. Los tests que necesiten otro valor lo actualizan
-- con set_cron_vault_secret (el helper exige que el secret ya exista).
select vault.create_secret(repeat('a', 64), 'cron_dispatch_secret');
select vault.create_secret('http://127.0.0.1:54321', 'cron_dispatch_base_url');
