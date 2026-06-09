import { describe, expect, it } from 'vitest';

import {
  anularIncidenteSchema,
  corregirIncidenteSchema,
  createIncidenteSchema,
} from '@/app/(app)/accidentabilidad/schema';

/**
 * T-062 · Unit del schema del libro de incidentes (sin DB).
 *
 * Foco: reglas condicionales por tipo (accidente exige gravedad; casi_accidente
 * la rechaza), `fecha <= hoy`, y los schemas de corregir/anular.
 */

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = isoDateOffset(0);
const TOMORROW = isoDateOffset(1);

const validAccidente = {
  tipo: 'accidente',
  fecha: '2026-05-01',
  descripcion: 'Operario sufrió un corte en la mano al manipular la guarda.',
  gravedad: 'grave',
  dias_perdidos: 7,
};

const validCasiAccidente = {
  tipo: 'casi_accidente',
  fecha: '2026-05-01',
  descripcion: 'Cayó una herramienta desde altura, sin impactar a nadie.',
  causa_raiz: 'Falta de amarre de herramientas en trabajo en altura.',
};

describe('createIncidenteSchema · happy path', () => {
  it('parsea un accidente con gravedad + dias_perdidos', () => {
    const r = createIncidenteSchema.safeParse(validAccidente);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tipo).toBe('accidente');
      expect(r.data.gravedad).toBe('grave');
      expect(r.data.dias_perdidos).toBe(7);
    }
  });

  it('parsea un casi_accidente sin gravedad ni dias_perdidos', () => {
    const r = createIncidenteSchema.safeParse(validCasiAccidente);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.tipo).toBe('casi_accidente');
      expect(r.data.gravedad).toBeUndefined();
    }
  });
});

describe('createIncidenteSchema · tipo vs lesión', () => {
  it('accidente SIN gravedad → INVALID (path gravedad)', () => {
    const { gravedad, ...sinGravedad } = validAccidente;
    void gravedad;
    const r = createIncidenteSchema.safeParse(sinGravedad);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'gravedad')).toBe(true);
    }
  });

  it('casi_accidente CON gravedad → INVALID (path gravedad)', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, gravedad: 'leve' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'gravedad')).toBe(true);
    }
  });

  it('casi_accidente con dias_perdidos != 0 → INVALID (path dias_perdidos)', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, dias_perdidos: 3 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'dias_perdidos')).toBe(true);
    }
  });

  it('casi_accidente con dias_perdidos == 0 → OK', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, dias_perdidos: 0 });
    expect(r.success).toBe(true);
  });
});

describe('createIncidenteSchema · fecha', () => {
  it('rechaza fecha futura', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, fecha: TOMORROW });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'fecha')).toBe(true);
    }
  });

  it('acepta fecha de hoy', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, fecha: TODAY });
    expect(r.success).toBe(true);
  });

  it('acepta fecha pasada', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, fecha: '2020-01-01' });
    expect(r.success).toBe(true);
  });

  it('rechaza formato de fecha inválido', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, fecha: '01/05/2026' });
    expect(r.success).toBe(false);
  });
});

describe('createIncidenteSchema · descripcion', () => {
  it('rechaza descripcion < 10 caracteres', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, descripcion: 'corto' });
    expect(r.success).toBe(false);
  });
});

describe('createIncidenteSchema · FKs opcionales', () => {
  it('rechaza cliente_id que no es UUID', () => {
    const r = createIncidenteSchema.safeParse({ ...validCasiAccidente, cliente_id: 'no-uuid' });
    expect(r.success).toBe(false);
  });

  it('acepta cliente_id UUID válido', () => {
    const r = createIncidenteSchema.safeParse({
      ...validCasiAccidente,
      cliente_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.success).toBe(true);
  });
});

describe('corregirIncidenteSchema', () => {
  it('exige corrige_id', () => {
    const r = corregirIncidenteSchema.safeParse(validAccidente);
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.path[0] === 'corrige_id')).toBe(true);
    }
  });

  it('parsea con corrige_id UUID + campos válidos', () => {
    const r = corregirIncidenteSchema.safeParse({
      ...validAccidente,
      corrige_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(r.success).toBe(true);
  });
});

describe('anularIncidenteSchema', () => {
  it('exige motivo (min 5)', () => {
    const r = anularIncidenteSchema.safeParse({
      id: '33333333-3333-4333-8333-333333333333',
      motivo: 'abc',
    });
    expect(r.success).toBe(false);
  });

  it('parsea con id UUID + motivo válido', () => {
    const r = anularIncidenteSchema.safeParse({
      id: '33333333-3333-4333-8333-333333333333',
      motivo: 'Cargado por error, duplicado.',
    });
    expect(r.success).toBe(true);
  });
});
