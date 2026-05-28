/**
 * T-108 · WhatsApp link compartido por header, footer, CTAs y botón flotante.
 *
 * **TODO Lautaro (pre-CP5 smoke productivo)**: reemplazar `WHATSAPP_E164` con
 * el número real de WhatsApp Business (E.164 sin `+`, ej. `5491100000000` para
 * +54 9 11 0000-0000). El placeholder actual (`5491100000000`) hace clic-OK
 * en wa.me pero abre un chat con un número inválido — perfecto para QA visual
 * pero NO para smoke productivo.
 *
 * El mensaje pre-cargado (`WHATSAPP_DEFAULT_MESSAGE`) puede personalizarse por
 * CTA en el futuro pasándolo como override. MVP: un mensaje único para todos
 * los puntos de entrada.
 *
 * wa.me docs: https://faq.whatsapp.com/5913398998672934
 */

export const WHATSAPP_E164 = '5491100000000';

export const WHATSAPP_DEFAULT_MESSAGE =
  'Hola, llegué desde la landing de ConsultoraDemo y me gustaría hacer una consulta antes de empezar el trial.';

/**
 * Devuelve el href `https://wa.me/<E164>?text=<encoded>` listo para `<a href>`.
 * Mantener el resultado estable entre renders (no envolver en hook ni computar
 * client-side — el mensaje es estático por defecto).
 */
export function buildWhatsAppHref(message: string = WHATSAPP_DEFAULT_MESSAGE): string {
  return `https://wa.me/${WHATSAPP_E164}?text=${encodeURIComponent(message)}`;
}

/** Atajo para el href con el mensaje default (90% de los call-sites). */
export const WHATSAPP_LINK_HREF = buildWhatsAppHref();
