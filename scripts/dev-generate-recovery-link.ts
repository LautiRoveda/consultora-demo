import type { Database } from '../src/shared/supabase/types';
import { createClient } from '@supabase/supabase-js';

/**
 * Dev-only: genera un recovery link y lo imprime SIN enviar email.
 *
 * Usa `admin.generateLink({ type: 'recovery' })` y arma el URL apuntando
 * directo al callback nuestro con `?token_hash=&type=&next=` — el formato
 * que `verifyOtp` consume. Evita el endpoint `/auth/v1/verify` de Supabase
 * (que dispara implicit flow con fragment-based session) y mantiene PKCE-style.
 *
 * Bypasea el rate limit de email outbound — útil para iterar el flow
 * recovery localmente sin esperar 1h.
 */
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Faltan env vars. Correr con: pnpm dev:recovery-link <email>');
    process.exit(1);
  }

  const email = process.argv[2];
  if (!email) {
    console.error('Uso: pnpm dev:recovery-link <email>');
    process.exit(1);
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: 'http://localhost:3000/auth/callback?next=/cambiar-password&from=recovery',
    },
  });

  if (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  const tokenHash = data.properties?.hashed_token;
  if (!tokenHash) {
    console.error('generateLink no devolvió hashed_token');
    process.exit(1);
  }

  const link = `http://localhost:3000/auth/callback?token_hash=${tokenHash}&type=recovery&next=/cambiar-password`;

  console.log('\n🔗 Recovery link generado (NO se envió email):\n');
  console.log(link);
  console.log('\nPegalo en el browser para validar el redirect chain.\n');
}

void main();
