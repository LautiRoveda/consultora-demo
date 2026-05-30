import { MessageCircleIcon } from 'lucide-react';

import { WHATSAPP_LINK_HREF } from './whatsapp';

/**
 * T-108 · Botón flotante WhatsApp persistente bottom-right en mobile + desktop.
 *
 * Server Component (link estático, sin state). El número y el mensaje
 * provienen de `./whatsapp.ts` (placeholder hasta que Lautaro pase el real
 * pre-CP5 smoke productivo).
 *
 * Diseño: pill verde WhatsApp con icono + label "WhatsApp". `z-50` para
 * quedar arriba del header sticky (z-40). En mobile el `bottom-4 right-4`
 * + `pointer-events-auto` evita conflicto con áreas tappables. El `aria-label`
 * explícito porque el contenido visible es ambiguo para screen readers.
 */
export function WhatsAppFloat() {
  return (
    <a
      href={WHATSAPP_LINK_HREF}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Abrir conversación de WhatsApp con ConsultoraDemo"
      // T-108 CP4 a11y fix: bg darker que el #25D366 brand pure para subir
      // contrast WCAG AA con `text-white`. #075E54 es WhatsApp darkest green
      // oficial (≈7.5:1 con blanco). Mantiene branding reconocible.
      className="fixed right-4 bottom-4 z-50 inline-flex items-center gap-2 rounded-full bg-[#075E54] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-black/15 transition-all hover:bg-[#054943] hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25D366] focus-visible:ring-offset-2 sm:right-6 sm:bottom-6"
    >
      <MessageCircleIcon className="size-5" aria-hidden="true" />
      <span className="hidden sm:inline">WhatsApp</span>
    </a>
  );
}
