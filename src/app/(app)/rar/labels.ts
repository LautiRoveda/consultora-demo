import type { AgenteTipo } from './schema';

/** T-143 · Etiquetas display de los tipos de agente de riesgo (Dto 658/96). */
export const TIPO_LABELS: Record<AgenteTipo, string> = {
  fisico: 'Físico',
  quimico: 'Químico',
  biologico: 'Biológico',
  ergonomico: 'Ergonómico',
};

/** Orden de presentación de los tipos (físico → químico → biológico → ergonómico). */
export const TIPO_ORDER: readonly AgenteTipo[] = [
  'fisico',
  'quimico',
  'biologico',
  'ergonomico',
] as const;
