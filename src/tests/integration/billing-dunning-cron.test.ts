/**
 * T-074 · Integration tests del flujo dunning (senders directos + auth route).
 *
 * Cobertura:
 *  1. POST /api/cron/billing-notifications sin secret -> 401.
 *  2. POST con secret invalido -> 401.
 *  3. sendTrialExpiresIn end-to-end: log row insertada + Resend invocado +
 *     resend_email_id seteado.
 *  4. sendTrialExpiresIn idempotency: 2x mismo (consultora, daysLeft) ->
 *     1 sola log row + 1 sola llamada Resend (segunda devuelve already_sent).
 *  5. sendTrialExpired end-to-end con retencion_datos_hasta.
 *  6. Resolve owner email: consultora sin owner -> null + skip.
 *
 * NOTA: el cron route end-to-end con buckets queries no se testea acá
 * porque el DB de testing tiene polución de tests previos (consultoras
 * trial sin owner) que hacen el procesamiento O(N) muy lento. La logica
 * de fanout es trivial; lo crítico (idempotency + Resend) está cubierto
 * en los senders.
 *
 * Mocks: server-only, resend.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/cron/billing-notifications/route';
import {
  resolveConsultoraOwnerEmail,
  sendTrialExpired,
  sendTrialExpiresIn,
} from '@/shared/billing/dunning';

vi.mock('server-only', () => ({}));

const mockEmailsSend = vi.fn();
vi.mock('@/shared/notifications/resend', () => ({
  getResendClient: () => ({
    emails: { send: mockEmailsSend },
  }),
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

type ConsultoraFixture = {
  id: string;
  name: string;
  ownerId: string;
  email: string;
};

const fixtures: {
  withOwner?: ConsultoraFixture;
  idem?: ConsultoraFixture;
  noOwner?: { id: string };
} = {};

async function createConsultoraWithOwner(prefix: string): Promise<ConsultoraFixture> {
  const slug = `t074-${prefix}-${runId}`;
  const email = `t074-${prefix}-${runId}@example.com`;
  const name = `T074 ${prefix}`;
  const { data: c, error: cErr } = await admin
    .from('consultoras')
    .insert({ name, slug, plan: 'trial' })
    .select('id, name')
    .single();
  if (cErr) throw cErr;
  const { data: u } = await admin.auth.admin.createUser({
    email,
    password: 'TestPassword123!',
    email_confirm: true,
  });
  const ownerId = u.user!.id;
  await admin
    .from('consultora_members')
    .insert({ user_id: ownerId, consultora_id: c.id, role: 'owner' });
  return { id: c.id, name: c.name, ownerId, email };
}

beforeAll(async () => {
  fixtures.withOwner = await createConsultoraWithOwner('owner');
  // Consultora propia para el test de idempotencia (test 4): billing_notifications_log
  // es append-only (AUD-001) → no se puede borrar con DELETE la fila que deja el test 3,
  // así que test 4 arranca de una consultora sin fila trial_expires_in_3d previa.
  fixtures.idem = await createConsultoraWithOwner('idem');

  const slugNoOwner = `t074-no-owner-${runId}`;
  const { data: cNoOwner } = await admin
    .from('consultoras')
    .insert({ name: 'T074 sin owner', slug: slugNoOwner, plan: 'trial' })
    .select('id')
    .single();
  fixtures.noOwner = { id: cNoOwner!.id };
});

afterAll(async () => {
  if (fixtures.withOwner) {
    await admin
      .from('billing_notifications_log')
      .delete()
      .eq('consultora_id', fixtures.withOwner.id);
    await admin.from('consultoras').delete().eq('id', fixtures.withOwner.id);
    await admin.auth.admin.deleteUser(fixtures.withOwner.ownerId).catch(() => {});
  }
  if (fixtures.idem) {
    // billing_notifications_log es append-only (AUD-001): el cascade-delete de la
    // consultora queda bloqueado → la fila queda orphan (la DB efímera la resetea por run).
    await admin.auth.admin.deleteUser(fixtures.idem.ownerId).catch(() => {});
  }
  if (fixtures.noOwner) {
    await admin.from('billing_notifications_log').delete().eq('consultora_id', fixtures.noOwner.id);
    await admin.from('consultoras').delete().eq('id', fixtures.noOwner.id);
  }
});

beforeEach(() => {
  mockEmailsSend.mockReset();
  mockEmailsSend.mockImplementation(() =>
    Promise.resolve({
      data: { id: `rsd_test_${Math.random().toString(36).slice(2, 8)}` },
      error: null,
    }),
  );
});

describe('POST /api/cron/billing-notifications · auth', () => {
  it('1. sin header X-Internal-Cron-Secret -> 401', async () => {
    const req = new NextRequest('http://localhost/api/cron/billing-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('2. header invalido -> 401', async () => {
    const req = new NextRequest('http://localhost/api/cron/billing-notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Cron-Secret': 'wrong-secret',
      },
      body: '{}',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

describe('sendTrialExpiresIn · idempotency end-to-end', () => {
  it('3. happy path: log row + Resend send + resend_email_id seteado', async () => {
    const f = fixtures.withOwner!;
    const result = await sendTrialExpiresIn(admin, { id: f.id, name: f.name }, f.email, 3);
    expect(result.sent).toBe(true);
    if (!result.sent) return;
    expect(result.emailId).toMatch(/^rsd_test_/);

    expect(mockEmailsSend).toHaveBeenCalledOnce();
    const sendArgs = mockEmailsSend.mock.calls[0]![0];
    expect(sendArgs.to).toBe(f.email);
    expect(sendArgs.subject).toContain('Tu trial vence en 3 días');

    const { data: log } = await admin
      .from('billing_notifications_log')
      .select('tipo, ref_id, resend_email_id')
      .eq('consultora_id', f.id)
      .eq('tipo', 'trial_expires_in_3d');
    expect(log).toHaveLength(1);
    expect(log![0]!.ref_id).toBeNull();
    expect(log![0]!.resend_email_id).toMatch(/^rsd_test_/);
  });

  it('4. idempotency: 2x mismo (consultora, daysLeft=3) -> 1 sola fila log + 1 sola llamada Resend', async () => {
    // Consultora propia: billing_notifications_log es append-only (AUD-001) → no se
    // puede borrar con DELETE la fila del test 3, así que arrancamos de una limpia.
    const f = fixtures.idem!;

    const r1 = await sendTrialExpiresIn(admin, { id: f.id, name: f.name }, f.email, 3);
    expect(r1.sent).toBe(true);
    expect(mockEmailsSend).toHaveBeenCalledTimes(1);

    const r2 = await sendTrialExpiresIn(admin, { id: f.id, name: f.name }, f.email, 3);
    expect(r2.sent).toBe(false);
    if (!r2.sent) expect(r2.reason).toBe('already_sent');
    expect(mockEmailsSend).toHaveBeenCalledTimes(1); // sigue en 1

    const { data: log } = await admin
      .from('billing_notifications_log')
      .select('id')
      .eq('consultora_id', f.id)
      .eq('tipo', 'trial_expires_in_3d');
    expect(log).toHaveLength(1);
  });

  it('5. daysLeft=1 usa tipo distinto -> coexiste con daysLeft=3', async () => {
    const f = fixtures.withOwner!;
    const r = await sendTrialExpiresIn(admin, { id: f.id, name: f.name }, f.email, 1);
    expect(r.sent).toBe(true);

    const sendArgs = mockEmailsSend.mock.calls[0]![0];
    expect(sendArgs.subject).toContain('Tu trial vence en 1 día');

    const { data: log } = await admin
      .from('billing_notifications_log')
      .select('tipo')
      .eq('consultora_id', f.id);
    const tipos = (log ?? []).map((r) => r.tipo).sort();
    expect(tipos).toEqual(['trial_expires_in_1d', 'trial_expires_in_3d']);
  });
});

describe('sendTrialExpired · end-to-end', () => {
  it('6. envia con retencion_datos_hasta presente + log row + ref_id null', async () => {
    const f = fixtures.withOwner!;
    const r = await sendTrialExpired(
      admin,
      { id: f.id, name: f.name, retencionDatosHasta: '2026-06-30T12:00:00Z' },
      f.email,
    );
    expect(r.sent).toBe(true);

    const sendArgs = mockEmailsSend.mock.calls[0]![0];
    expect(sendArgs.subject).toContain('Tu trial ha expirado');
    expect(sendArgs.html).toContain('30/06/2026');

    const { data: log } = await admin
      .from('billing_notifications_log')
      .select('tipo, ref_id, resend_email_id')
      .eq('consultora_id', f.id)
      .eq('tipo', 'trial_expired');
    expect(log).toHaveLength(1);
    expect(log![0]!.ref_id).toBeNull();
    expect(log![0]!.resend_email_id).toMatch(/^rsd_test_/);
  });
});

describe('resolveConsultoraOwnerEmail', () => {
  it('7. consultora con owner -> retorna { ownerUserId, ownerEmail }', async () => {
    const f = fixtures.withOwner!;
    const result = await resolveConsultoraOwnerEmail(admin, f.id);
    expect(result).not.toBeNull();
    expect(result!.ownerUserId).toBe(f.ownerId);
    expect(result!.ownerEmail).toBe(f.email);
  });

  it('8. consultora sin owner -> null (no rompe)', async () => {
    const result = await resolveConsultoraOwnerEmail(admin, fixtures.noOwner!.id);
    expect(result).toBeNull();
  });
});
