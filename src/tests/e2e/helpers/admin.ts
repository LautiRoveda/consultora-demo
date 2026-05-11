/**
 * T-018 · Helpers de admin Supabase para tests E2E.
 *
 * Mismo patrón que `src/tests/integration/signin.test.ts`:
 *   - `admin.auth.admin.createUser({ email_confirm: true })` crea users sin
 *     enviar email (NO consume rate limit, NO requiere inbox).
 *   - `admin.rpc('create_consultora_and_owner')` simula el flow atómico
 *     de signup post-confirmación (T-012).
 *   - `admin.auth.admin.generateLink({ type: 'recovery' })` produce un
 *     `hashed_token` con el que se arma un URL al callback (mismo
 *     patrón que `scripts/dev-generate-recovery-link.ts`).
 *
 * Cleanup: `deleteTestUser` es idempotente. Las `consultoras` quedan orphan
 * (cascade borra `consultora_members` pero no `consultoras`) — mismo trade-off
 * conocido de los integration tests. Limpieza manual periódica.
 *
 * Env vars requeridas (mismas que integration tests):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:e2e`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Tests E2E requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:e2e`.',
  );
}

export const adminClient = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Password compartido para users de prueba. Cumple Supabase default (≥6 chars)
 * y el mínimo de zod del schema de login/signup (≥8 chars).
 */
export const TEST_PASSWORD = 'TestPassword123!';

/**
 * Base URL del dev server que Playwright lanza (`playwright.config.ts` →
 * `webServer.url`). Hardcoded acá para que `generateRecoveryLinkUrl` arme
 * URLs absolutas válidas para el callback handler.
 */
const E2E_BASE_URL = 'http://localhost:3000';

/**
 * Email único por test, prefix-able por escenario.
 *
 * @example uniqueTestEmail('login-happy') → 't018-login-happy-mlxabc12-3xq2@example.com'
 */
export function uniqueTestEmail(prefix: string): string {
  return `t018-${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.com`;
}

/**
 * Crea user confirmado + consultora + membership owner en una sola llamada.
 *
 * Idéntico flow a `signin.test.ts:createConfirmedUserWithConsultora`.
 */
export async function createTestUserWithConsultora(args: {
  email: string;
  consultoraName: string;
  password?: string;
}): Promise<{
  userId: string;
  consultoraId: string;
  slug: string;
  password: string;
}> {
  const password = args.password ?? TEST_PASSWORD;

  const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
    email: args.email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) {
    throw new Error(`createTestUserWithConsultora.createUser: ${createErr?.message}`);
  }

  const { data: rpcData, error: rpcErr } = await adminClient.rpc('create_consultora_and_owner', {
    p_user_id: created.user.id,
    p_name: args.consultoraName,
  });
  if (rpcErr) {
    // Cleanup parcial: si el RPC falla, no dejamos el user huérfano.
    await deleteTestUser(created.user.id);
    throw new Error(`createTestUserWithConsultora.rpc: ${rpcErr.message}`);
  }
  const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  if (!row) {
    await deleteTestUser(created.user.id);
    throw new Error('createTestUserWithConsultora.rpc: sin row');
  }

  return {
    userId: created.user.id,
    consultoraId: row.consultora_id,
    slug: row.slug,
    password,
  };
}

/**
 * Crea user confirmado SIN consultora ni membership. Útil para testear el
 * caso edge del layout `(app)` (T-017): user autenticado sin consultora →
 * redirect a `/login?error=no_consultora`.
 */
export async function createTestUserWithoutConsultora(
  email: string,
): Promise<{ userId: string; password: string }> {
  const { data: created, error } = await adminClient.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !created.user) {
    throw new Error(`createTestUserWithoutConsultora: ${error?.message}`);
  }
  return { userId: created.user.id, password: TEST_PASSWORD };
}

/**
 * Borra un test user via service-role. Idempotente: acepta `undefined` y
 * absorbe errores (un test que falla antes de crear el user no debe
 * romper el cleanup).
 *
 * Cascada: borra `consultora_members` automáticamente (FK on delete cascade).
 * NO borra `consultoras` — limpieza manual periódica.
 */
export async function deleteTestUser(userId: string | undefined): Promise<void> {
  if (!userId) return;
  await adminClient.auth.admin.deleteUser(userId).catch(() => {
    // Best-effort cleanup.
  });
}

/**
 * Genera un URL del callback con `token_hash` listo para `page.goto(...)`.
 *
 * Mismo flow que `scripts/dev-generate-recovery-link.ts`: pide a Supabase
 * el `hashed_token` (sin enviar email) y arma el URL apuntando al callback
 * handler con `type=recovery` + `next=/cambiar-password`.
 */
export async function generateRecoveryLinkUrl(email: string): Promise<string> {
  const { data, error } = await adminClient.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: {
      redirectTo: `${E2E_BASE_URL}/auth/callback?next=/cambiar-password&from=recovery`,
    },
  });
  if (error) {
    throw new Error(`generateRecoveryLinkUrl: ${error.message}`);
  }
  const hashedToken = data.properties?.hashed_token;
  if (!hashedToken) {
    throw new Error('generateRecoveryLinkUrl: sin hashed_token');
  }
  return `${E2E_BASE_URL}/auth/callback?token_hash=${hashedToken}&type=recovery&next=/cambiar-password`;
}
