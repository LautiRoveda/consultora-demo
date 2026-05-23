/**
 * T-073 · Unit tests de `getBillingStatus` (puro, sin I/O).
 *
 * Mockeamos `@/env` para controlar `BILLING_GATE_DISABLED`. La fecha "now"
 * se pasa explícita en cada test para evitar timing flakiness.
 *
 * No mockeamos `getActiveSubscription` porque `getBillingStatus` no la usa —
 * la suscripción se pasa como parámetro.
 */
import type { SuscripcionRow } from '@/app/(app)/settings/billing/queries';
import type { CurrentConsultora } from '@/shared/auth/types';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Default: gate ENFORCED. Mock sin importActual — `getBillingStatus` sólo
// lee `env.BILLING_GATE_DISABLED`, no necesita el resto del schema cargado
// (que requeriría env vars reales en jsdom). Tests específicos hacen
// vi.doMock para override.
vi.mock('@/env', () => ({
  env: { BILLING_GATE_DISABLED: 'false' as const },
}));

const NOW = new Date('2026-05-22T12:00:00.000Z');
const YESTERDAY = new Date('2026-05-21T12:00:00.000Z').toISOString();
const TOMORROW = new Date('2026-05-23T12:00:00.000Z').toISOString();

function makeConsultora(overrides: Partial<CurrentConsultora> = {}): CurrentConsultora {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test',
    slug: 'test',
    plan: 'trial',
    trialHasta: TOMORROW,
    role: 'owner',
    logoStoragePath: null,
    autoCreateEventOnSign: false,
    ...overrides,
  };
}

function makeSub(overrides: Partial<SuscripcionRow> = {}): SuscripcionRow {
  return {
    id: '00000000-0000-0000-0000-000000000002',
    consultora_id: '00000000-0000-0000-0000-000000000001',
    plan_codigo: 'pro_mensual',
    estado: 'activa',
    mp_subscription_id: 'mp-test',
    init_point: null,
    periodo_inicio: YESTERDAY,
    periodo_fin: TOMORROW,
    cancelar_en: null,
    cancelada_en: null,
    created_at: YESTERDAY,
    updated_at: YESTERDAY,
    ...overrides,
  };
}

describe('getBillingStatus · gate ENFORCED (default)', () => {
  it('trial con fecha futura → ok', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(makeConsultora({ trialHasta: TOMORROW }), null, NOW);
    expect(status.ok).toBe(true);
  });

  it('trial con fecha pasada → TRIAL_EXPIRED', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(makeConsultora({ trialHasta: YESTERDAY }), null, NOW);
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.reason).toBe('TRIAL_EXPIRED');
  });

  it('trial con trialHasta=null → TRIAL_EXPIRED (defensa: no debería pasar)', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(makeConsultora({ trialHasta: null }), null, NOW);
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.reason).toBe('TRIAL_EXPIRED');
  });

  it('plan=pro sin suscripción → ok (no caemos al branch de trial)', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(makeConsultora({ plan: 'pro', trialHasta: null }), null, NOW);
    expect(status.ok).toBe(true);
  });

  it('suscripción activa → ok', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(makeConsultora(), makeSub({ estado: 'activa' }), NOW);
    expect(status.ok).toBe(true);
  });

  it('suscripción morosa → ok (grace period, MP reintenta)', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(makeConsultora(), makeSub({ estado: 'morosa' }), NOW);
    expect(status.ok).toBe(true);
  });

  it('suscripción pendiente_autorizacion → ok', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(
      makeConsultora(),
      makeSub({ estado: 'pendiente_autorizacion' }),
      NOW,
    );
    expect(status.ok).toBe(true);
  });

  it('suscripción expirada → SUBSCRIPTION_EXPIRED', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(makeConsultora(), makeSub({ estado: 'expirada' }), NOW);
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.reason).toBe('SUBSCRIPTION_EXPIRED');
  });

  it('suscripción cancelada + cancelar_en futuro → ok (sigue activa hasta fin del período)', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(
      makeConsultora(),
      makeSub({ estado: 'cancelada', cancelar_en: TOMORROW }),
      NOW,
    );
    expect(status.ok).toBe(true);
  });

  it('suscripción cancelada + cancelar_en pasado → SUBSCRIPTION_CANCELLED', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(
      makeConsultora(),
      makeSub({ estado: 'cancelada', cancelar_en: YESTERDAY }),
      NOW,
    );
    expect(status.ok).toBe(false);
    if (status.ok) return;
    expect(status.reason).toBe('SUBSCRIPTION_CANCELLED');
  });

  it('suscripción cancelada sin cancelar_en → ok (período aún no terminó, defensa)', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(
      makeConsultora(),
      makeSub({ estado: 'cancelada', cancelar_en: null }),
      NOW,
    );
    expect(status.ok).toBe(true);
  });

  it('frontera: trial_hasta exactamente igual a now → ok (< es estricto)', async () => {
    const { getBillingStatus } = await import('@/shared/billing/access');
    const exactlyNow = NOW.toISOString();
    const status = getBillingStatus(makeConsultora({ trialHasta: exactlyNow }), null, NOW);
    // trialHasta < now ? false (son iguales). → no triggea TRIAL_EXPIRED.
    expect(status.ok).toBe(true);
  });
});

describe('getBillingStatus · BILLING_GATE_DISABLED=true', () => {
  it('bypass total: trial vencido + sub expirada → ok', async () => {
    vi.resetModules();
    vi.doMock('@/env', () => ({
      env: { BILLING_GATE_DISABLED: 'true' as const },
    }));
    const { getBillingStatus } = await import('@/shared/billing/access');
    const status = getBillingStatus(
      makeConsultora({ trialHasta: YESTERDAY }),
      makeSub({ estado: 'expirada' }),
      NOW,
    );
    expect(status.ok).toBe(true);
    vi.doUnmock('@/env');
    vi.resetModules();
  });
});
