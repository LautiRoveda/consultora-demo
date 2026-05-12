import 'server-only';

import type { InformeTipo } from '@/app/(app)/informes/schema';

import { SYSTEM_PROMPT_ACCIDENTE } from './accidente';
import { SYSTEM_PROMPT_CAPACITACION } from './capacitacion';
import { SYSTEM_PROMPT_OTROS } from './otros';
import { SYSTEM_PROMPT_RELEVAMIENTO } from './relevamiento';
import { SYSTEM_PROMPT_RGRL } from './rgrl';

/**
 * T-020 · Barrel + lookup de system prompts por tipo de informe.
 *
 * Server-only — los prompts son texto largo que NO debe llegar al bundle del
 * cliente (incluso siendo publicos no-secretos, pesan KB y son IP del producto).
 *
 * El record exhaustivo sobre `InformeTipo` garantiza que TypeScript falle si
 * sumamos un tipo nuevo a `INFORME_TIPOS` (schema.ts) sin agregar el prompt
 * correspondiente acá.
 */
const PROMPTS_BY_TIPO: Record<InformeTipo, string> = {
  relevamiento: SYSTEM_PROMPT_RELEVAMIENTO,
  capacitacion: SYSTEM_PROMPT_CAPACITACION,
  rgrl: SYSTEM_PROMPT_RGRL,
  accidente: SYSTEM_PROMPT_ACCIDENTE,
  otros: SYSTEM_PROMPT_OTROS,
};

export function getSystemPromptForTipo(tipo: InformeTipo): string {
  return PROMPTS_BY_TIPO[tipo];
}
