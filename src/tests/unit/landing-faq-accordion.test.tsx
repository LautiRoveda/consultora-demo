/**
 * T-108 · FAQAccordion: smoke render + interacción básica del accordion.
 *
 * Patrón del repo (PushChannelRow.test.tsx): stubs jsdom para APIs no
 * implementadas que Radix necesita (ResizeObserver, scrollIntoView,
 * hasPointerCapture, releasePointerCapture).
 *
 * Cubre:
 *  - render: todas las preguntas (triggers) visibles.
 *  - inicialmente todos los items cerrados (collapsible="single").
 *  - click en un trigger expande la respuesta correspondiente.
 *  - click en el mismo trigger ya abierto lo colapsa (collapsible=true).
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FAQAccordion } from '@/shared/landing/FAQAccordion';

// jsdom no implementa ResizeObserver — Radix lo usa internamente.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const ITEMS = [
  { q: '¿Necesito tarjeta de crédito para el trial?', a: 'No, 14 días sin tarjeta.' },
  { q: '¿Puedo cancelar cuando quiera?', a: 'Sí, en 1 click desde tu cuenta.' },
  { q: '¿Qué pasa con mis datos al cancelar?', a: 'Acceso 30 días para exportar todo.' },
];

beforeEach(() => {
  cleanup();
});

afterEach(() => {
  cleanup();
});

describe('FAQAccordion', () => {
  it('renderiza todas las preguntas como triggers visibles', () => {
    render(<FAQAccordion items={ITEMS} />);
    for (const item of ITEMS) {
      expect(screen.getByRole('button', { name: item.q })).toBeInTheDocument();
    }
  });

  it('inicialmente ningún item está expandido (aria-expanded=false)', () => {
    render(<FAQAccordion items={ITEMS} />);
    for (const item of ITEMS) {
      const trigger = screen.getByRole('button', { name: item.q });
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('click en un trigger expande el item correspondiente', async () => {
    const user = userEvent.setup();
    render(<FAQAccordion items={ITEMS} />);

    const first = ITEMS[0]!;
    const firstTrigger = screen.getByRole('button', { name: first.q });
    await user.click(firstTrigger);

    expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(first.a)).toBeInTheDocument();
  });

  it('click en el item ya abierto lo colapsa (collapsible=true)', async () => {
    const user = userEvent.setup();
    render(<FAQAccordion items={ITEMS} />);

    const second = ITEMS[1]!;
    const trigger = screen.getByRole('button', { name: second.q });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
