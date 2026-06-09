/**
 * T-128 · Unit del schema de empleados — el campo "puesto" pasó de texto libre
 * a `puesto_id` (uuid del catálogo). Cubre create + update patch.
 */
import { describe, expect, it } from 'vitest';

import { createEmpleadoSchema, updateEmpleadoPatchSchema } from '@/app/(app)/empleados/schema';

// UUIDs v4-válidos (versión 4 + variant 8) — `z.uuid()` valida los bits.
const VALID_UUID = '11111111-1111-4111-8111-111111111111';
const baseCreate = {
  cliente_id: '22222222-2222-4222-8222-222222222222',
  nombre: 'Juan',
  apellido: 'Pérez',
  dni: '12345678',
};

describe('createEmpleadoSchema · puesto_id', () => {
  it('acepta puesto_id uuid válido', () => {
    const r = createEmpleadoSchema.safeParse({ ...baseCreate, puesto_id: VALID_UUID });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.puesto_id).toBe(VALID_UUID);
  });

  it('puesto_id es opcional (puede omitirse → undefined)', () => {
    const r = createEmpleadoSchema.safeParse(baseCreate);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.puesto_id).toBeUndefined();
  });

  it('rechaza puesto_id no-uuid', () => {
    const r = createEmpleadoSchema.safeParse({ ...baseCreate, puesto_id: 'no-es-uuid' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'puesto_id')).toBe(true);
    }
  });

  it('el texto libre `puesto` ya NO es parte del shape (deprecado, T-129)', () => {
    expect(Object.keys(createEmpleadoSchema.shape)).not.toContain('puesto');
    expect(Object.keys(createEmpleadoSchema.shape)).toContain('puesto_id');
  });
});

describe('updateEmpleadoPatchSchema · puesto_id', () => {
  it('acepta puesto_id uuid', () => {
    const r = updateEmpleadoPatchSchema.safeParse({ puesto_id: VALID_UUID });
    expect(r.success).toBe(true);
  });

  it('acepta puesto_id null (limpiar la asignación)', () => {
    const r = updateEmpleadoPatchSchema.safeParse({ puesto_id: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.puesto_id).toBeNull();
  });

  it('rechaza puesto_id no-uuid', () => {
    const r = updateEmpleadoPatchSchema.safeParse({ puesto_id: 'x' });
    expect(r.success).toBe(false);
  });

  it('patch vacío sigue rechazándose (refine ≥1 campo)', () => {
    const r = updateEmpleadoPatchSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});
