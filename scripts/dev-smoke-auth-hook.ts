/**
 * Dev-only smoke del Auth Hook custom_access_token_hook (T-016 PARADA #1).
 *
 * Invoca la function directamente via admin.rpc() con un event mock para un
 * user real (lautaroeroveda@gmail.com por default). Muestra el event modificado
 * para validar que app_metadata.consultora_id + consultora_role aparecen.
 *
 * En prod el hook lo invoca GoTrue como supabase_auth_admin durante el token
 * issue. Este smoke usa service_role via PostgREST (grant explicito en la
 * migration de PARADA #1, justificado con comment).
 *
 * Para validacion end-to-end via flow real de magic link + verifyOtp ver
 * scripts/dev-smoke-jwt-claim.ts (PARADA #2).
 */
import type { Database } from '../src/shared/supabase/types';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.argv[2] ?? 'lautaroeroveda@gmail.com';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Faltan env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
    process.exit(1);
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: list } = await admin.auth.admin.listUsers();
  const user = list?.users.find((u) => u.email === TEST_EMAIL);
  if (!user) {
    console.error(`Usuario no encontrado: ${TEST_EMAIL}`);
    process.exit(1);
  }
  console.log(`\nUser: ${user.email} · id=${user.id.slice(0, 8)}...`);

  // Replica la shape que envia GoTrue al hook.
  const eventMock = {
    user_id: user.id,
    claims: {
      iss: 'https://example.supabase.co/auth/v1',
      sub: user.id,
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      email: user.email,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      role: 'authenticated',
    },
  };

  console.log('\n─────────────────────────────────────────────────');
  console.log('Event mock (input):');
  console.log('─────────────────────────────────────────────────');
  console.log(JSON.stringify(eventMock, null, 2));

  const { data, error } = await admin.rpc('custom_access_token_hook', {
    event: eventMock,
  });

  if (error) {
    console.error('\nRPC error:', error);
    process.exit(1);
  }

  console.log('\n─────────────────────────────────────────────────');
  console.log('Event modificado (output):');
  console.log('─────────────────────────────────────────────────');
  console.log(JSON.stringify(data, null, 2));

  const out = data as { claims?: { app_metadata?: Record<string, unknown> } } | null;
  const claim = out?.claims?.app_metadata?.consultora_id;
  const roleClaim = out?.claims?.app_metadata?.consultora_role;
  console.log('\n─────────────────────────────────────────────────');
  console.log('Asserts:');
  console.log('─────────────────────────────────────────────────');
  console.log(`  app_metadata.consultora_id presente: ${claim ? 'OK' : 'FAIL'} (${String(claim)})`);
  console.log(
    `  app_metadata.consultora_role = "owner": ${roleClaim === 'owner' ? 'OK' : 'FAIL'} (${String(roleClaim)})`,
  );
  if (!claim || roleClaim !== 'owner') {
    process.exit(1);
  }
}

void main();
