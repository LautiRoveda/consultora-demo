/**
 * T-108 · WhatsAppFloat: renderiza un link a wa.me con número placeholder +
 * mensaje pre-cargado URL-encoded + target=_blank con rel seguro.
 *
 * Test puro sin DB (patrón epp-suggest-prompt.test.ts). Cubre el wiring
 * entre el componente y el helper `whatsapp.ts` para detectar regresión
 * silenciosa si alguien cambia el href sin actualizar el helper.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildWhatsAppHref,
  WHATSAPP_DEFAULT_MESSAGE,
  WHATSAPP_E164,
} from '@/shared/landing/whatsapp';
import { WhatsAppFloat } from '@/shared/landing/WhatsAppFloat';

afterEach(() => {
  cleanup();
});

describe('WhatsAppFloat', () => {
  it('renderiza un <a> con href wa.me/<E164>?text=<mensaje encoded>', () => {
    render(<WhatsAppFloat />);
    const link = screen.getByRole('link', {
      name: /abrir conversación de whatsapp/i,
    });
    const href = link.getAttribute('href');
    expect(href).toBe(buildWhatsAppHref());
    expect(href).toContain(WHATSAPP_E164);
    expect(href).toContain(encodeURIComponent(WHATSAPP_DEFAULT_MESSAGE));
    expect(href).toMatch(/^https:\/\/wa\.me\//);
  });

  it('abre en pestaña nueva con rel noopener noreferrer (seguridad target=_blank)', () => {
    render(<WhatsAppFloat />);
    const link = screen.getByRole('link', { name: /abrir conversación de whatsapp/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });

  it('helper buildWhatsAppHref acepta mensaje custom y lo URL-encodea', () => {
    const custom = 'Hola desde test con espacios & caracteres';
    const href = buildWhatsAppHref(custom);
    expect(href).toContain(encodeURIComponent(custom));
    expect(href).toContain(WHATSAPP_E164);
  });
});
