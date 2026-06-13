/**
 * T-143 · Unit Zod del catálogo de agentes de riesgo y de la exposición.
 *
 * Bounds 1:1 con los CHECK de la migración t143 (rar_agentes): codigo 2-60,
 * nombre 2-120, cas ≤40, enfermedad_asociada ≤200, descripcion ≤500. Si cambia
 * el CHECK sin actualizar el schema, este test rompe.
 */
import { describe, expect, it } from 'vitest';

import {
  assignAgenteSchema,
  createAgenteSchema,
  removeAgenteSchema,
  updateAgentePatchSchema,
} from '@/app/(app)/rar/schema';

const UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

describe('T-143 · createAgenteSchema', () => {
  it('acepta un agente válido', () => {
    const r = createAgenteSchema.safeParse({
      codigo: '90001',
      nombre: 'Ruido',
      agente_tipo: 'fisico',
    });
    expect(r.success).toBe(true);
  });

  it('acepta campos opcionales (cas, enfermedad, descripcion)', () => {
    const r = createAgenteSchema.safeParse({
      codigo: '40153',
      nombre: 'Polvo de sílice cristalina',
      agente_tipo: 'quimico',
      cas: '14808-60-7',
      enfermedad_asociada: 'Silicosis',
      descripcion: 'Cuarzo o cristobalita.',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza codigo de 1 caracter (min 2)', () => {
    expect(
      createAgenteSchema.safeParse({ codigo: '9', nombre: 'Ruido', agente_tipo: 'fisico' }).success,
    ).toBe(false);
  });

  it('rechaza codigo > 60 caracteres', () => {
    expect(
      createAgenteSchema.safeParse({
        codigo: 'x'.repeat(61),
        nombre: 'Ruido',
        agente_tipo: 'fisico',
      }).success,
    ).toBe(false);
  });

  it('rechaza nombre < 2 y > 120 caracteres', () => {
    expect(
      createAgenteSchema.safeParse({ codigo: '90001', nombre: 'R', agente_tipo: 'fisico' }).success,
    ).toBe(false);
    expect(
      createAgenteSchema.safeParse({
        codigo: '90001',
        nombre: 'x'.repeat(121),
        agente_tipo: 'fisico',
      }).success,
    ).toBe(false);
  });

  it('rechaza agente_tipo fuera del enum', () => {
    expect(
      createAgenteSchema.safeParse({ codigo: '90001', nombre: 'Ruido', agente_tipo: 'radiologico' })
        .success,
    ).toBe(false);
  });

  it('rechaza cas > 40, enfermedad > 200, descripcion > 500', () => {
    const base = { codigo: '90001', nombre: 'Ruido', agente_tipo: 'fisico' as const };
    expect(createAgenteSchema.safeParse({ ...base, cas: 'x'.repeat(41) }).success).toBe(false);
    expect(
      createAgenteSchema.safeParse({ ...base, enfermedad_asociada: 'x'.repeat(201) }).success,
    ).toBe(false);
    expect(createAgenteSchema.safeParse({ ...base, descripcion: 'x'.repeat(501) }).success).toBe(
      false,
    );
  });
});

describe('T-143 · updateAgentePatchSchema', () => {
  it('acepta un patch con un solo campo', () => {
    expect(updateAgentePatchSchema.safeParse({ nombre: 'Ruido continuo' }).success).toBe(true);
  });

  it('acepta cas/enfermedad/descripcion nullable (limpiar el campo)', () => {
    expect(updateAgentePatchSchema.safeParse({ cas: null }).success).toBe(true);
  });

  it('rechaza un patch vacío (.refine al menos un campo)', () => {
    expect(updateAgentePatchSchema.safeParse({}).success).toBe(false);
  });
});

describe('T-143 · assign/remove schemas', () => {
  it('aceptan UUIDs válidos', () => {
    expect(
      assignAgenteSchema.safeParse({ cliente_id: UUID, puesto_id: UUID, agente_id: UUID }).success,
    ).toBe(true);
    expect(
      removeAgenteSchema.safeParse({ cliente_id: UUID, puesto_id: UUID, agente_id: UUID }).success,
    ).toBe(true);
  });

  it('rechazan ids no-uuid', () => {
    expect(
      assignAgenteSchema.safeParse({ cliente_id: UUID, puesto_id: 'abc', agente_id: UUID }).success,
    ).toBe(false);
  });

  it('rechazan cliente_id faltante (T-145)', () => {
    expect(assignAgenteSchema.safeParse({ puesto_id: UUID, agente_id: UUID }).success).toBe(false);
  });
});
