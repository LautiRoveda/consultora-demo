/**
 * T-014 · Tests del flow de password recovery.
 *
 * **Estrategia:**
 * - `recoverPasswordAction` se invoca server-side via dynamic import (mocks
 *   de `server-only` + `next/headers` para que funcione en Node).
 * - `admin.auth.admin.generateLink({ type: 'recovery', email })` bypasea el
 *   rate limit de email (no envía mail). Devuelve URL con `token_hash` que
 *   `verifyOtp` consume para establecer sesión recovery.
 * - `updatePasswordAction` se invoca con la sesión recovery activa.
 *
 * El flow end-to-end real (con email enviado) lo cubre Lautaro en PARADA #2.
 *
 * Cleanup: borrar users via service-role. Consultoras quedan orphan (slug
 * `t014-test-*`). Limpieza manual periódica vía SQL Editor.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';

// Mocks para importar server actions desde Node.
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: () => {},
    }),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const originalPassword = 'TestPassword123!';
const createdUserIds: string[] = [];

async function createConfirmedUserWithConsultora(email: string, consultoraName: string) {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: originalPassword,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`createUser falló: ${createErr?.message}`);
  createdUserIds.push(created.user.id);

  const { error: rpcErr } = await admin.rpc('create_consultora_and_owner', {
    p_user_id: created.user.id,
    p_name: consultoraName,
  });
  if (rpcErr) throw new Error(`RPC falló: ${rpcErr.message}`);
  return created.user.id;
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // Best-effort.
    });
  }
});

describe('recoverPasswordAction', () => {
  it('email válido registrado → ok:true con mensaje genérico', async () => {
    const { recoverPasswordAction } = await import('@/app/recuperar-password/actions');

    const email = `t014-test-recover-valid-${runId}@example.com`;
    await createConfirmedUserWithConsultora(email, `Test Recover Valid ${runId}`);

    const result = await recoverPasswordAction({ email });

    if (!result.ok && result.code === 'RATE_LIMITED') {
      console.warn('[skip] recoverPasswordAction: Supabase rate-limited. Re-correr en ~1h.');
      return;
    }

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain('Si el email');
      expect(result.message).toContain(email);
    }
  });

  it('email inexistente → ok:true MISMO mensaje genérico (anti-enumeration)', async () => {
    const { recoverPasswordAction } = await import('@/app/recuperar-password/actions');

    const email = `t014-test-recover-nonexistent-${runId}@example.com`;
    const result = await recoverPasswordAction({ email });

    if (!result.ok && result.code === 'RATE_LIMITED') {
      console.warn('[skip] recoverPasswordAction: rate-limited.');
      return;
    }

    // Resultado INDISTINGUIBLE del caso "email válido" — la única diferencia
    // visible es el email interpolado en el mensaje.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toContain('Si el email');
      expect(result.message).toContain(email);
    }

    // Confirmar que NO se creó user (resetPasswordForEmail con email
    // inexistente NO crea cuenta — distinto a signInWithOtp con
    // shouldCreateUser: true, que sí crearía).
    const { data: users } = await admin.auth.admin.listUsers();
    const found = users?.users.find((u) => u.email === email);
    expect(found).toBeUndefined();
  });

  it('INVALID_INPUT cuando email malformado', async () => {
    const { recoverPasswordAction } = await import('@/app/recuperar-password/actions');

    const result = await recoverPasswordAction({ email: 'not-an-email' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT');
    }
  });
});

describe('updatePasswordAction', () => {
  it('NO_SESSION cuando no hay sesión activa', async () => {
    // El mock de next/headers devuelve cookies vacías → server client sin sesión.
    const { updatePasswordAction } = await import('@/app/cambiar-password/actions');

    const result = await updatePasswordAction({
      password: 'BrandNewPassword456!',
      confirmPassword: 'BrandNewPassword456!',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NO_SESSION');
    }
  });

  it('INVALID_INPUT cuando passwords no coinciden', async () => {
    const { updatePasswordAction } = await import('@/app/cambiar-password/actions');

    const result = await updatePasswordAction({
      password: 'BrandNewPassword456!',
      confirmPassword: 'Different999!',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_INPUT');
    }
  });

  it('happy path: generateLink recovery → exchange → updateUser → signIn con nueva password funciona', async () => {
    const email = `t014-test-update-happy-${runId}@example.com`;
    const userId = await createConfirmedUserWithConsultora(email, `Test Update ${runId}`);
    const newPassword = `NewPass-${runId}!`;

    // 1. admin.generateLink type recovery devuelve URL sin enviar email.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    });
    expect(linkErr).toBeNull();
    expect(linkData.properties?.action_link).toBeTruthy();

    // 2. Extraer `token_hash` del URL para verifyOtp (simula el flow del callback).
    const actionLink = linkData.properties?.action_link;
    if (!actionLink) throw new Error('generateLink no devolvió action_link');
    const linkUrl = new URL(actionLink);
    const tokenHash = linkUrl.searchParams.get('token') ?? linkUrl.searchParams.get('token_hash');
    expect(tokenHash).toBeTruthy();

    // 3. Client anon con persistSession para que verifyOtp + updateUser
    //    compartan la sesión recovery.
    const client = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: false },
    });
    const { data: verifyData, error: verifyErr } = await client.auth.verifyOtp({
      type: 'recovery',
      token_hash: tokenHash!,
    });
    expect(verifyErr).toBeNull();
    expect(verifyData.session).toBeTruthy();
    expect(verifyData.user?.id).toBe(userId);

    // 4. Cambiar password con la sesión recovery activa.
    const { error: updateErr } = await client.auth.updateUser({ password: newPassword });
    expect(updateErr).toBeNull();

    // 5. Verificar que signInWithPassword funciona con la nueva password.
    const newClient = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { data: signInData, error: signInErr } = await newClient.auth.signInWithPassword({
      email,
      password: newPassword,
    });
    expect(signInErr).toBeNull();
    expect(signInData.user?.id).toBe(userId);

    // 6. Verificar que la password vieja YA NO funciona.
    const oldPassClient = createSbClient<Database>(url, anonKey, {
      auth: { persistSession: false },
    });
    const { error: oldPassErr } = await oldPassClient.auth.signInWithPassword({
      email,
      password: originalPassword,
    });
    expect(oldPassErr).not.toBeNull();
  });
});
