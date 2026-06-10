/**
 * T-133 · Tests del borde Zod del módulo Calendario (hardening M-1).
 *
 * Qué protege cada bloque:
 *  - Partición: USER_CREATABLE ∪ SYSTEM = EVENT_TIPO_VALUES y disjuntos — si se
 *    agrega un tipo nuevo y la partición queda inconsistente, rompe acá.
 *  - createCalendarEventSchema solo acepta tipos user-creatable: epp_entrega /
 *    accion_correctiva los crean SOLO las RPCs gen_* (service-role); un alta
 *    manual envenenaría la derivación del semáforo / contexto EPP.
 *  - metadata: las claves del namespace system (SYSTEM_METADATA_KEYS) no entran
 *    por input de usuario, ni en create ni en update patch.
 */
import { describe, expect, it } from 'vitest';

import {
  EVENT_TIPO_VALUES,
  SYSTEM_GENERATED_EVENT_TIPOS,
  SYSTEM_METADATA_KEYS,
  USER_CREATABLE_EVENT_TIPOS,
} from '@/app/(app)/calendario/defaults';
import {
  createCalendarEventSchema,
  updateCalendarEventPatchSchema,
} from '@/app/(app)/calendario/schema';

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

const baseCreate = {
  titulo: 'Vencimiento de prueba',
  fecha_vencimiento: '2026-12-01',
};

describe('partición de tipos (anti-drift)', () => {
  it('USER_CREATABLE ∪ SYSTEM = EVENT_TIPO_VALUES, sin solapamiento', () => {
    const union = [...USER_CREATABLE_EVENT_TIPOS, ...SYSTEM_GENERATED_EVENT_TIPOS];
    expect([...union].sort()).toEqual([...EVENT_TIPO_VALUES].sort());
    const overlap = USER_CREATABLE_EVENT_TIPOS.filter((t) =>
      (SYSTEM_GENERATED_EVENT_TIPOS as readonly string[]).includes(t),
    );
    expect(overlap).toEqual([]);
  });
});

describe('createCalendarEventSchema · tipo', () => {
  it.each([...SYSTEM_GENERATED_EVENT_TIPOS])('rechaza tipo system-generated %s', (tipo) => {
    const r = createCalendarEventSchema.safeParse({ ...baseCreate, tipo });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'tipo')).toBe(true);
  });

  it.each([...USER_CREATABLE_EVENT_TIPOS])('acepta tipo user-creatable %s', (tipo) => {
    const r = createCalendarEventSchema.safeParse({ ...baseCreate, tipo });
    expect(r.success).toBe(true);
  });
});

describe('metadata · claves reservadas del sistema', () => {
  it.each([...SYSTEM_METADATA_KEYS])('create rechaza metadata con clave %s', (key) => {
    const r = createCalendarEventSchema.safeParse({
      ...baseCreate,
      tipo: 'custom',
      metadata: { [key]: VALID_UUID },
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'metadata')).toBe(true);
  });

  it.each([...SYSTEM_METADATA_KEYS])('update patch rechaza metadata con clave %s', (key) => {
    const r = updateCalendarEventPatchSchema.safeParse({ metadata: { [key]: VALID_UUID } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === 'metadata')).toBe(true);
  });

  it('create acepta metadata inocua, null y omitida', () => {
    expect(
      createCalendarEventSchema.safeParse({
        ...baseCreate,
        tipo: 'custom',
        metadata: { nota: 'comprar sonómetro antes del vencimiento' },
      }).success,
    ).toBe(true);
    expect(
      createCalendarEventSchema.safeParse({ ...baseCreate, tipo: 'custom', metadata: null })
        .success,
    ).toBe(true);
    expect(createCalendarEventSchema.safeParse({ ...baseCreate, tipo: 'custom' }).success).toBe(
      true,
    );
  });

  it('update patch acepta metadata inocua y null', () => {
    expect(updateCalendarEventPatchSchema.safeParse({ metadata: { nota: 'x' } }).success).toBe(
      true,
    );
    expect(updateCalendarEventPatchSchema.safeParse({ metadata: null }).success).toBe(true);
  });
});
