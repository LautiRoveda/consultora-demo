/**
 * T-115 · Unit tests del hardening del billing-gate.
 *
 * El bug: `requireBillingAccess` → `getActiveSubscription` TIRA ante un error de
 * la query de suscripción. Sin try/catch, en una Server Action eso es un reject
 * sin manejar → 500 en vez de un error de dominio.
 *
 * Estos tests demuestran el guard (red→green): mockeamos `getActiveSubscription`
 * para que TIRE y asseritamos que los helpers seguros NO propagan — devuelven
 * `INTERNAL_ERROR` (Server Actions) / `kind:'error'` (route handlers). Sin el
 * try/catch, el `.resolves` fallaría porque la promesa rechazaría.
 *
 * No tocan DB: `getActiveSubscription` + `getCurrentConsultora` están mockeados.
 */
import type { CurrentConsultora } from '@/shared/auth/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireMemberWithBilling, requireOwnerWithBilling } from '@/shared/auth/with-billing';
import { billingAccessForRoute } from '@/shared/billing/access';

vi.mock('server-only', () => ({}));

// Gate ENFORCED (env real de dev tiene BILLING_GATE_DISABLED=true).
vi.mock('@/env', () => ({
  env: { BILLING_GATE_DISABLED: 'false' as const },
}));

vi.mock('@/shared/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/shared/billing/messages', () => ({
  getGateMessage: (reason: string) => `gate:${reason}`,
}));

// El borde que tira / responde — controlado por test.
const getActiveSubscription = vi.fn();
vi.mock('@/app/(app)/settings/billing/queries', () => ({
  getActiveSubscription: (...args: unknown[]) => getActiveSubscription(...args),
}));

// Auth: consultora siempre presente (role configurable para owner-gate).
const getCurrentConsultora = vi.fn();
vi.mock('@/shared/auth/getCurrentConsultora', () => ({
  getCurrentConsultora: (...args: unknown[]) => getCurrentConsultora(...args),
}));

const TOMORROW = new Date('2999-01-01T00:00:00.000Z').toISOString();

function makeConsultora(overrides: Partial<CurrentConsultora> = {}): CurrentConsultora {
  return {
    id: 'consultora-1',
    name: 'Test',
    slug: 'test',
    plan: 'trial',
    trialHasta: TOMORROW,
    role: 'owner',
    logoStoragePath: null,
    autoCreateEventOnSign: false,
    onboardingCompletadoAt: null,
    ...overrides,
  };
}

// Fake supabase: sólo se usa `auth.getUser()` (getCurrentConsultora está mockeado).
const fakeSupabase = {
  auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
} as never;

const unauthSupabase = {
  auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentConsultora.mockResolvedValue(makeConsultora());
});

describe('requireMemberWithBilling (T-115 guard)', () => {
  it('NO propaga si getActiveSubscription TIRA → INTERNAL_ERROR', async () => {
    getActiveSubscription.mockRejectedValue(new Error('db down'));

    const result = await requireMemberWithBilling(fakeSupabase);

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
  });

  it('billing OK (sub activa) → ok:true + ctx', async () => {
    getActiveSubscription.mockResolvedValue({ estado: 'activa', cancelar_en: null });

    const result = await requireMemberWithBilling(fakeSupabase);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ctx.userId).toBe('user-1');
      expect(result.ctx.consultoraId).toBe('consultora-1');
    }
  });

  it('billing gated (sub expirada) → BILLING_GATED + reason', async () => {
    getActiveSubscription.mockResolvedValue({ estado: 'expirada', cancelar_en: null });

    const result = await requireMemberWithBilling(fakeSupabase);

    expect(result).toMatchObject({
      ok: false,
      code: 'BILLING_GATED',
      reason: 'SUBSCRIPTION_EXPIRED',
    });
  });

  it('sin sesión → UNAUTHENTICATED (no consulta billing)', async () => {
    const result = await requireMemberWithBilling(unauthSupabase);

    expect(result).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(getActiveSubscription).not.toHaveBeenCalled();
  });
});

describe('requireOwnerWithBilling (T-115 guard)', () => {
  it('NO propaga si getActiveSubscription TIRA → INTERNAL_ERROR', async () => {
    getActiveSubscription.mockRejectedValue(new Error('db down'));

    const result = await requireOwnerWithBilling(fakeSupabase);

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
  });

  it('member (no owner) → FORBIDDEN_NOT_OWNER (no consulta billing)', async () => {
    getCurrentConsultora.mockResolvedValue(makeConsultora({ role: 'member' }));

    const result = await requireOwnerWithBilling(fakeSupabase);

    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN_NOT_OWNER' });
    expect(getActiveSubscription).not.toHaveBeenCalled();
  });
});

describe('billingAccessForRoute (T-115 guard para route handlers)', () => {
  const consultora = makeConsultora();

  it('NO propaga si getActiveSubscription TIRA → kind:error', async () => {
    getActiveSubscription.mockRejectedValue(new Error('db down'));

    const result = await billingAccessForRoute(fakeSupabase, consultora, { route: 'test' });

    expect(result).toEqual({ ok: false, kind: 'error' });
  });

  it('billing gated → kind:gated + reason', async () => {
    getActiveSubscription.mockResolvedValue({ estado: 'expirada', cancelar_en: null });

    const result = await billingAccessForRoute(fakeSupabase, consultora, { route: 'test' });

    expect(result).toEqual({ ok: false, kind: 'gated', reason: 'SUBSCRIPTION_EXPIRED' });
  });

  it('billing OK → ok:true', async () => {
    getActiveSubscription.mockResolvedValue({ estado: 'activa', cancelar_en: null });

    const result = await billingAccessForRoute(fakeSupabase, consultora, { route: 'test' });

    expect(result).toEqual({ ok: true });
  });
});
