/**
 * T-106 · Unit tests del system prompt + tool schema de sugerencia EPP.
 *
 * Tests "anchor": validan que cambios en el prompt mantengan invariantes
 * críticos (rol HyS AR, normativa citada, tool schema shape correcto). No
 * testea calidad de output IA — eso es smoke en prod.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  EPP_SUGGEST_SYSTEM_PROMPT,
  RECOMMEND_EPP_TOOL_SCHEMA,
  recommendEppOutputSchema,
} from '@/shared/ai/prompts/epp-suggest';

vi.mock('server-only', () => ({}));

describe('EPP_SUGGEST_SYSTEM_PROMPT', () => {
  it('incluye anchor normativa argentina (SRT / IRAM)', () => {
    expect(EPP_SUGGEST_SYSTEM_PROMPT).toMatch(/SRT/i);
    expect(EPP_SUGGEST_SYSTEM_PROMPT).toMatch(/IRAM/i);
  });

  it('declara el rol experto HyS argentino', () => {
    expect(EPP_SUGGEST_SYSTEM_PROMPT.toLowerCase()).toContain('higiene y seguridad');
    expect(EPP_SUGGEST_SYSTEM_PROMPT).toMatch(/argentin/i);
  });

  it('instruye a usar SOLO items del catálogo provisto (anti-alucinación)', () => {
    expect(EPP_SUGGEST_SYSTEM_PROMPT).toMatch(/SOLO recomendar items/i);
    expect(EPP_SUGGEST_SYSTEM_PROMPT).toMatch(/NO inventes/i);
  });

  it('exige llamar la tool exactamente una vez', () => {
    expect(EPP_SUGGEST_SYSTEM_PROMPT).toContain('recommend_epp_items');
  });
});

describe('RECOMMEND_EPP_TOOL_SCHEMA', () => {
  it('define los 3 campos por recomendación con tipos correctos', () => {
    const props =
      RECOMMEND_EPP_TOOL_SCHEMA.input_schema.properties.recommendations.items.properties;
    expect(props.item_id.type).toBe('string');
    expect(props.confianza_porcentaje.type).toBe('integer');
    expect(props.confianza_porcentaje.minimum).toBe(1);
    expect(props.confianza_porcentaje.maximum).toBe(100);
    expect(props.justificacion.maxLength).toBe(200);
  });

  it('nombre de la tool matchea el system prompt', () => {
    expect(RECOMMEND_EPP_TOOL_SCHEMA.name).toBe('recommend_epp_items');
  });
});

describe('recommendEppOutputSchema (Zod mirror)', () => {
  const validId = '550e8400-e29b-41d4-a716-446655440000';

  it('parsea output happy path', () => {
    const r = recommendEppOutputSchema.safeParse({
      recommendations: [
        { item_id: validId, confianza_porcentaje: 95, justificacion: 'Riesgo proyección.' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rechaza confianza > 100', () => {
    const r = recommendEppOutputSchema.safeParse({
      recommendations: [{ item_id: validId, confianza_porcentaje: 150, justificacion: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza confianza < 1', () => {
    const r = recommendEppOutputSchema.safeParse({
      recommendations: [{ item_id: validId, confianza_porcentaje: 0, justificacion: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza item_id no-UUID', () => {
    const r = recommendEppOutputSchema.safeParse({
      recommendations: [{ item_id: 'not-a-uuid', confianza_porcentaje: 80, justificacion: 'x' }],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza justificacion > 200 chars', () => {
    const r = recommendEppOutputSchema.safeParse({
      recommendations: [
        { item_id: validId, confianza_porcentaje: 80, justificacion: 'a'.repeat(201) },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('acepta array vacío (sin recomendaciones — caso edge no_catalogo)', () => {
    const r = recommendEppOutputSchema.safeParse({ recommendations: [] });
    expect(r.success).toBe(true);
  });
});
