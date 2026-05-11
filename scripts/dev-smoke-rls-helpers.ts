/**
 * Dev-only smoke de los 4 RLS helpers (T-015 PARADA #1).
 *
 * Flujo:
 * 1. admin.listUsers() para encontrar el user de prueba por email.
 * 2. admin.generateLink({ type: 'magiclink' }) para obtener hashed_token sin
 *    enviar email (bypasea rate limit + email outbound).
 * 3. anonClient.auth.verifyOtp({ token_hash, type: 'magiclink' }) para
 *    establecer sesión real → JWT con sub = user.id.
 * 4. Invocar las 4 RPCs con la sesión activa.
 *
 * Si Lautaro quiere mantenerlo como dev tool útil post-PARADA #2, lo
 * agregamos a package.json scripts. Si no, se borra junto con cualquier
 * otro scratch antes del commit final.
 */
import type { Database } from '../src/shared/supabase/types';
import { createClient } from '@supabase/supabase-js';

const TEST_EMAIL = process.argv[2] ?? 'lautaroeroveda@gmail.com';
const RANDOM_UUID = '00000000-0000-0000-0000-000000000000';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    console.error('Faltan env vars.');
    process.exit(1);
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Encontrar user.
  const { data: list } = await admin.auth.admin.listUsers();
  const user = list?.users.find((u) => u.email === TEST_EMAIL);
  if (!user) {
    console.error(`Usuario no encontrado: ${TEST_EMAIL}`);
    process.exit(1);
  }
  console.log(`\nUser: ${user.email} · id=${user.id.slice(0, 8)}...`);

  // 2. Encontrar memberships (vía admin, bypasea RLS).
  const { data: memberships } = await admin
    .from('consultora_members')
    .select('consultora_id, role, consultoras(slug, name)')
    .eq('user_id', user.id);
  console.log(`Memberships: ${JSON.stringify(memberships, null, 2)}\n`);
  if (!memberships || memberships.length === 0) {
    console.error('No hay memberships para el user.');
    process.exit(1);
  }
  const ownConsultoraId = memberships[0]!.consultora_id;

  // 3. Generar magic link + verifyOtp para obtener sesión real.
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: TEST_EMAIL,
  });
  if (linkErr || !linkData.properties?.hashed_token) {
    console.error('generateLink falló:', linkErr);
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
    console.error('verifyOtp falló:', verifyErr);
    process.exit(1);
  }
  console.log(`Sesión activa via magic link. JWT sub=${verifyData.user?.id.slice(0, 8)}...\n`);

  // 4. Invocar las 4 RPCs.
  console.log('─────────────────────────────────────────────────');
  console.log(`Smoke RLS helpers (auth.uid() = ${user.id.slice(0, 8)}...)`);
  console.log('─────────────────────────────────────────────────\n');

  const r1 = await anonClient.rpc('is_member_of_consultora', {
    p_consultora_id: ownConsultoraId,
  });
  console.log(
    `is_member_of_consultora(<own>): ${JSON.stringify(r1.data)} (err: ${r1.error?.message ?? 'null'})`,
  );

  const r2 = await anonClient.rpc('is_member_of_consultora', {
    p_consultora_id: RANDOM_UUID,
  });
  console.log(
    `is_member_of_consultora(<random>): ${JSON.stringify(r2.data)} (err: ${r2.error?.message ?? 'null'})`,
  );

  const r3 = await anonClient.rpc('is_owner_of_consultora', {
    p_consultora_id: ownConsultoraId,
  });
  console.log(
    `is_owner_of_consultora(<own>): ${JSON.stringify(r3.data)} (err: ${r3.error?.message ?? 'null'})`,
  );

  const r4 = await anonClient.rpc('is_owner_of_consultora', {
    p_consultora_id: RANDOM_UUID,
  });
  console.log(
    `is_owner_of_consultora(<random>): ${JSON.stringify(r4.data)} (err: ${r4.error?.message ?? 'null'})`,
  );

  const r5 = await anonClient.rpc('role_on_consultora', {
    p_consultora_id: ownConsultoraId,
  });
  console.log(
    `role_on_consultora(<own>): ${JSON.stringify(r5.data)} (err: ${r5.error?.message ?? 'null'})`,
  );

  const r6 = await anonClient.rpc('role_on_consultora', {
    p_consultora_id: RANDOM_UUID,
  });
  console.log(
    `role_on_consultora(<random>): ${JSON.stringify(r6.data)} (err: ${r6.error?.message ?? 'null'})`,
  );

  const r7 = await anonClient.rpc('my_consultora_ids');
  console.log(
    `my_consultora_ids(): ${JSON.stringify(r7.data)} (err: ${r7.error?.message ?? 'null'})`,
  );

  console.log('\n─────────────────────────────────────────────────');
  console.log('Smoke con anon SIN sesión (auth.uid() = null)');
  console.log('─────────────────────────────────────────────────\n');

  const anonNoSession = createClient<Database>(url, anonKey, {
    auth: { persistSession: false },
  });
  const r8 = await anonNoSession.rpc('is_member_of_consultora', {
    p_consultora_id: ownConsultoraId,
  });
  console.log(
    `(anon sin sesión) is_member_of_consultora(<own>): data=${JSON.stringify(r8.data)} error=${r8.error?.message ?? 'null'}`,
  );
}

void main();
