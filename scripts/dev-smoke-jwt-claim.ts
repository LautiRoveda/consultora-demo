/**
 * Dev-only smoke end-to-end del custom claim (T-016 PARADA #2).
 *
 * Valida el flow real: magic link -> verifyOtp -> session con access_token
 * cuyo payload contiene app_metadata.consultora_id + consultora_role inyectados
 * por el hook (PARADA #1, enchufado via Dashboard en PARADA #2).
 *
 * Diferencia clave vs dev-smoke-auth-hook.ts:
 *   - auth-hook invoca la function via admin.rpc() con un event mock. Valida
 *     que la function PROPIA funciona en aislamiento.
 *   - jwt-claim NO toca la function directamente: confia en que GoTrue la
 *     invoca durante el token issue. Valida la integracion end-to-end:
 *     hook enchufado correctamente + GoTrue lo llama + el claim viaja en el JWT.
 *
 * Si este smoke pasa pero auth-hook falla, hay bug en el body.
 * Si auth-hook pasa pero este falla, hay drift entre config.toml/Dashboard
 *   y el remote (hook desenchufado, URI mal escrita, etc.).
 */
import type { Database } from '../src/shared/supabase/types';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.argv[2] ?? 'lautaroeroveda@gmail.com';

interface JwtPayload {
  sub?: string;
  app_metadata?: {
    consultora_id?: string;
    consultora_role?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// Decodifica el payload del JWT (segundo segmento, base64url). No verifica firma
// — eso lo hace Supabase server-side; aca solo necesitamos leer el claim.
function decodeJwtPayload(jwt: string): JwtPayload {
  const segments = jwt.split('.');
  if (segments.length !== 3) {
    throw new Error(`JWT mal formado: ${segments.length} segmentos en lugar de 3`);
  }
  const b64url = segments[1]!;
  // base64url -> base64: cambiar - por +, _ por /, agregar padding.
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (b64.length % 4)) % 4;
  const padded = b64 + '='.repeat(padLen);
  const json = Buffer.from(padded, 'base64').toString('utf-8');
  return JSON.parse(json) as JwtPayload;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    console.error(
      'Faltan env vars (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).',
    );
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

  // Bypasea send de email + rate limits: generateLink + verifyOtp produce
  // sesion real sin tocar SMTP. Mismo patron que dev-smoke-rls-helpers.ts.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: TEST_EMAIL,
  });
  if (linkErr || !linkData.properties?.hashed_token) {
    console.error('generateLink fallo:', linkErr);
    process.exit(1);
  }

  const anonClient = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  const { data: verifyData, error: verifyErr } = await anonClient.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });
  if (verifyErr || !verifyData.session) {
    console.error('verifyOtp fallo:', verifyErr);
    process.exit(1);
  }

  const accessToken = verifyData.session.access_token;
  const payload = decodeJwtPayload(accessToken);

  console.log(`\nUser: ${user.email} · id=${user.id.slice(0, 8)}...`);
  console.log('\n─────────────────────────────────────────────────');
  console.log('JWT payload (decoded):');
  console.log('─────────────────────────────────────────────────');
  console.log(JSON.stringify(payload, null, 2));

  const claim = payload.app_metadata?.consultora_id;
  const roleClaim = payload.app_metadata?.consultora_role;
  const sub = payload.sub;

  console.log('\n─────────────────────────────────────────────────');
  console.log('Asserts:');
  console.log('─────────────────────────────────────────────────');
  const subOk = sub === user.id;
  const claimOk = typeof claim === 'string' && claim.length === 36;
  const roleOk = roleClaim === 'owner';
  console.log(`  payload.sub === user.id: ${subOk ? 'OK' : 'FAIL'} (${String(sub)})`);
  console.log(
    `  payload.app_metadata.consultora_id presente (uuid): ${claimOk ? 'OK' : 'FAIL'} (${String(claim)})`,
  );
  console.log(
    `  payload.app_metadata.consultora_role === "owner": ${roleOk ? 'OK' : 'FAIL'} (${String(roleClaim)})`,
  );

  if (!subOk || !claimOk || !roleOk) {
    process.exit(1);
  }
}

void main();
