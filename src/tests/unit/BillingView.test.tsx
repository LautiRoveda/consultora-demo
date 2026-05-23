/**
 * T-072 · Tests de la vista de billing.
 *
 * Cubre los branches críticos de PlanCurrentCard (trial vacío, trial vencido,
 * suscripción activa, morosa, cancelada) + InvoicesList (empty state, render
 * con facturas, paginación habilitada/deshabilitada).
 */
import type { FacturaRow, SuscripcionRow } from '@/app/(app)/settings/billing/queries';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BillingView } from '@/app/(app)/settings/billing/BillingView';

vi.mock('server-only', () => ({}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/app/(app)/settings/billing/actions', () => ({
  createSubscriptionAction: vi.fn().mockResolvedValue({
    ok: true,
    initPoint: 'https://www.mercadopago.com.ar/preapproval?preapproval_id=mp-1',
    mpSubscriptionId: 'mp-1',
  }),
  cancelSubscriptionAction: vi.fn().mockResolvedValue({ ok: true, suscripcionId: 'sub-1' }),
  cancelPendingSubscriptionAction: vi.fn().mockResolvedValue({ ok: true, suscripcionId: 'sub-1' }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// jsdom stubs para Radix AlertDialog.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

afterEach(() => cleanup());

function makeSub(overrides: Partial<SuscripcionRow> = {}): SuscripcionRow {
  return {
    id: 'sub-1',
    consultora_id: 'cons-1',
    plan_codigo: 'pro_mensual',
    estado: 'activa',
    mp_subscription_id: 'mp-pre-1',
    init_point: null,
    periodo_inicio: '2026-05-01T00:00:00.000Z',
    periodo_fin: '2026-06-01T00:00:00.000Z',
    cancelar_en: null,
    cancelada_en: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeFactura(overrides: Partial<FacturaRow> = {}): FacturaRow {
  return {
    id: 'fac-' + Math.random().toString(36).slice(2, 8),
    consultora_id: 'cons-1',
    suscripcion_id: 'sub-1',
    mp_payment_id: 'mp-pay-1',
    monto_centavos: 3_000_000,
    moneda: 'ARS',
    estado: 'pagada',
    pagada_en: '2026-05-01T00:00:00.000Z',
    razon_falla: null,
    recibo_url: 'https://www.mercadopago.com.ar/recibos/abc',
    created_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

const baseProps = {
  role: 'owner' as const,
  trialHasta: null,
  suscripcion: null,
  invoices: [] as FacturaRow[],
  priceCentavos: 3_000_000,
  page: 1,
  hasNext: false,
  statusParam: null,
};

describe('BillingView', () => {
  it('trial sin suscripción → muestra CTA Suscribirme + días restantes', () => {
    const trialHasta = new Date(Date.now() + 5 * 86_400_000).toISOString();
    render(<BillingView {...baseProps} trialHasta={trialHasta} />);
    expect(screen.getByText('Plan Trial')).toBeInTheDocument();
    expect(screen.getByText(/5 días restantes/i)).toBeInTheDocument();
    expect(screen.getByTestId('subscribe-button')).toBeInTheDocument();
  });

  it('trial vencido sin suscripción → badge "Vencido" + CTA suscribirme + retención datos', () => {
    const trialHasta = new Date(Date.now() - 2 * 86_400_000).toISOString();
    render(<BillingView {...baseProps} trialHasta={trialHasta} />);
    expect(screen.getByText('Trial vencido')).toBeInTheDocument();
    expect(screen.getByText(/30 días post-trial/i)).toBeInTheDocument();
    expect(screen.getByTestId('subscribe-button')).toBeInTheDocument();
  });

  it('suscripción activa → muestra "Plan Pro" + precio + CTA cancelar', () => {
    const sub = makeSub({ estado: 'activa' });
    render(<BillingView {...baseProps} suscripcion={sub} />);
    expect(screen.getByText('Plan Pro')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-subscription-button')).toBeInTheDocument();
    expect(screen.queryByTestId('subscribe-button')).not.toBeInTheDocument();
  });

  it('suscripción morosa → warning + link externo a MP', () => {
    const sub = makeSub({ estado: 'morosa' });
    render(<BillingView {...baseProps} suscripcion={sub} />);
    expect(screen.getByText('Pago pendiente')).toBeInTheDocument();
    const mpLink = screen.getByRole('link', { name: /Abrir Mercado Pago/i });
    expect(mpLink).toHaveAttribute('href', expect.stringContaining('mercadopago.com.ar'));
  });

  it('suscripción cancelada con cancelar_en futuro → muestra fecha de bajada', () => {
    // Mediodía UTC para que el render con timezone local AR (UTC-3) no caiga
    // al día anterior.
    const cancelarEn = '2026-08-15T12:00:00.000Z';
    const sub = makeSub({ estado: 'cancelada', cancelar_en: cancelarEn });
    render(<BillingView {...baseProps} suscripcion={sub} />);
    expect(screen.getByText('Plan cancelado')).toBeInTheDocument();
    expect(screen.getByText(/15\/08\/2026/)).toBeInTheDocument();
    expect(screen.queryByTestId('cancel-subscription-button')).not.toBeInTheDocument();
  });

  it('member non-owner con suscripción activa → no muestra cancel button', () => {
    const sub = makeSub({ estado: 'activa' });
    render(<BillingView {...baseProps} role="member" suscripcion={sub} />);
    expect(screen.getByText('Solo el owner puede gestionar la suscripción')).toBeInTheDocument();
    expect(screen.queryByTestId('cancel-subscription-button')).not.toBeInTheDocument();
  });

  it('facturas vacías → empty state', () => {
    render(<BillingView {...baseProps} />);
    expect(screen.getByText('Todavía no hay facturas')).toBeInTheDocument();
    expect(screen.queryByTestId('invoices-list')).not.toBeInTheDocument();
  });

  it('facturas con datos → renderiza lista + monto formateado + link recibo', () => {
    // Usamos montos distintos al precio del plan (3_000_000) para evitar
    // colisiones con el card "Plan Pro · ARS 30.000 mensuales" en estado
    // activa.
    const facturas = [
      makeFactura({ monto_centavos: 5_000_000, estado: 'pagada' }),
      makeFactura({ monto_centavos: 4_500_000, estado: 'pendiente', recibo_url: null }),
    ];
    const sub = makeSub({ estado: 'activa' });
    render(<BillingView {...baseProps} suscripcion={sub} invoices={facturas} />);
    expect(screen.getByTestId('invoices-list')).toBeInTheDocument();
    expect(screen.getByText('ARS 50.000')).toBeInTheDocument();
    expect(screen.getByText('ARS 45.000')).toBeInTheDocument();
    expect(screen.getByText('Pagada')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    const recibo = screen.getByRole('link', { name: 'Ver' });
    expect(recibo).toHaveAttribute('href', 'https://www.mercadopago.com.ar/recibos/abc');
  });

  it('paginación: page=1 sin next → Anteriores y Siguientes ambos disabled', () => {
    const facturas = [makeFactura()];
    render(<BillingView {...baseProps} invoices={facturas} page={1} hasNext={false} />);
    const prev = screen.getByRole('link', { name: /Anteriores/i });
    const next = screen.getByRole('link', { name: /Siguientes/i });
    expect(prev).toHaveAttribute('aria-disabled', 'true');
    expect(next).toHaveAttribute('aria-disabled', 'true');
  });

  it('paginación: page=2 con next=true → ambos habilitados con href correcto', () => {
    const facturas = [makeFactura()];
    render(<BillingView {...baseProps} invoices={facturas} page={2} hasNext />);
    const prev = screen.getByRole('link', { name: /Anteriores/i });
    const next = screen.getByRole('link', { name: /Siguientes/i });
    expect(prev).toHaveAttribute('href', '/settings/billing?page=1');
    expect(next).toHaveAttribute('href', '/settings/billing?page=3');
  });

  // ============ T-071-FU3 · recovery flow pendiente_autorizacion ============

  it('pendiente_autorizacion con init_point → muestra link "Continuar autorización" + CancelPendingButton', () => {
    const initPoint = 'https://www.mercadopago.com.ar/preapproval?preapproval_id=mp-pre-fu3';
    const sub = makeSub({ estado: 'pendiente_autorizacion', init_point: initPoint });
    render(<BillingView {...baseProps} suscripcion={sub} />);

    expect(screen.getByText('Procesando suscripción')).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();

    // Button asChild propaga props al child anchor — data-testid + href quedan en el <a>.
    const continueLink = screen.getByTestId('continue-authorization-link');
    expect(continueLink).toBeInTheDocument();
    expect(continueLink).toHaveAttribute('href', initPoint);
    expect(continueLink).toHaveAttribute('target', '_blank');

    expect(screen.getByTestId('cancel-pending-button')).toBeInTheDocument();
    // NO debe mostrar el SubscribeButton (fallback solo si init_point null).
    expect(screen.queryByTestId('subscribe-button')).not.toBeInTheDocument();
  });

  it('pendiente_autorizacion sin init_point → fallback SubscribeButton + CancelPendingButton', () => {
    const sub = makeSub({ estado: 'pendiente_autorizacion', init_point: null });
    render(<BillingView {...baseProps} suscripcion={sub} />);

    expect(screen.getByText('Procesando suscripción')).toBeInTheDocument();
    expect(screen.queryByTestId('continue-authorization-link')).not.toBeInTheDocument();
    expect(screen.getByTestId('subscribe-button')).toBeInTheDocument();
    expect(screen.getByTestId('cancel-pending-button')).toBeInTheDocument();
  });
});
