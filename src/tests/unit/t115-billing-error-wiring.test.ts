/**
 * T-115 · Wiring tests: el manejo de error del billing-gate llega bien hasta el
 * borde (Server Action y Route Handler), no sólo al helper.
 *
 * Cuando `getActiveSubscription` TIRA:
 *  - una Server Action migrada (`createClienteAction`) devuelve `INTERNAL_ERROR`
 *    de dominio, NO un reject sin manejar (el bug T-115).
 *  - un Route Handler migrado (`GET /api/informes/[id]/pdf`) responde 503
 *    INTERNAL_ERROR con body JSON limpio, NO el 500 opaco de Next.
 *
 * Sin DB: `getActiveSubscription` + `getCurrentConsultora` + `createClient` están
 * mockeados; el gate corta ANTES de cualquier INSERT / Puppeteer.
 */
import type { CurrentConsultora } from '@/shared/auth/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClienteAction } from '@/app/(app)/clientes/actions';
import { GET as informePdfRoute } from '@/app/api/informes/[id]/pdf/route';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ env: { BILLING_GATE_DISABLED: 'false' as const } }));
vi.mock('@/shared/observability/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/shared/billing/messages', () => ({
  getGateMessage: (reason: string) => `gate:${reason}`,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const getActiveSubscription = vi.fn();
vi.mock('@/app/(app)/settings/billing/queries', () => ({
  getActiveSubscription: (...args: unknown[]) => getActiveSubscription(...args),
}));

const getCurrentConsultora = vi.fn();
vi.mock('@/shared/auth/getCurrentConsultora', () => ({
  getCurrentConsultora: (...args: unknown[]) => getCurrentConsultora(...args),
}));

const fakeSupabase = {
  auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
} as never;
vi.mock('@/shared/supabase/server', () => ({
  createClient: () => Promise.resolve(fakeSupabase),
}));

// Módulos pesados que el route importa pero NO ejecuta antes del gate.
vi.mock('@/shared/pdf/render-print-page', () => ({
  renderPrintPageToPdf: vi.fn(),
  pdfDownloadResponse: vi.fn(),
}));
vi.mock('@/shared/supabase/service-role', () => ({ createServiceRoleClient: vi.fn() }));

function makeConsultora(overrides: Partial<CurrentConsultora> = {}): CurrentConsultora {
  return {
    id: 'consultora-1',
    name: 'Test',
    slug: 'test',
    plan: 'trial',
    trialHasta: new Date('2999-01-01T00:00:00.000Z').toISOString(),
    role: 'owner',
    logoStoragePath: null,
    autoCreateEventOnSign: false,
    onboardingCompletadoAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentConsultora.mockResolvedValue(makeConsultora());
  getActiveSubscription.mockRejectedValue(new Error('db down'));
});

describe('Server Action migrada (Patrón A)', () => {
  it('createClienteAction: billing query tira → INTERNAL_ERROR, sin reject', async () => {
    const result = await createClienteAction({ razon_social: 'ACME SA', cuit: '30-12345678-9' });

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL_ERROR' });
  });
});

describe('Route Handler migrado (Patrón B)', () => {
  it('GET /api/informes/[id]/pdf: billing query tira → 503 INTERNAL_ERROR', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    const res = await informePdfRoute({} as never, { params: Promise.resolve({ id }) });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
