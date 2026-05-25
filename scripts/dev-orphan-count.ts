import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const c = createClient(url, key, { auth: { persistSession: false } });
  const cutoff5min = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const r1 = await c
    .from('billing_notifications_log')
    .select('id', { count: 'exact', head: true })
    .is('resend_email_id', null)
    .gte('created_at', '2026-05-24');
  const r2 = await c
    .from('billing_notifications_log')
    .select('id', { count: 'exact', head: true })
    .is('resend_email_id', null)
    .lt('created_at', cutoff5min);
  const r3 = await c
    .from('billing_notifications_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', '2026-05-24');
  console.log(
    'total_post_aud001:',
    r3.count,
    'null_post_aud001:',
    r1.count,
    'stale_recoverable_now:',
    r2.count,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
