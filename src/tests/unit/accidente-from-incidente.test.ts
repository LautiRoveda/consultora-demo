/**
 * T-075 · Mapeo incidente → metadata del template accidente.
 *
 * Lo crítico es el CONTRATO: el objeto devuelto DEBE pasar
 * `accidenteMetadataSchema` (si no, `createInformeAction` lo descarta — no
 * bloqueante — y el editor abre vacío). Además testeamos los mapeos no triviales:
 * gravedad (mortal→grave_mortal), hora (null→'00:00'), placeholders y el cap de
 * `dias_baja_estimados` (365 vs los 3650 del incidente).
 */
import { describe, expect, it } from 'vitest';

import { mapIncidenteToAccidenteMetadata } from '@/shared/templates/accidente/from-incidente';
import { accidenteMetadataSchema } from '@/shared/templates/accidente/schema';

type Incidente = Parameters<typeof mapIncidenteToAccidenteMetadata>[0]['incidente'];
type Cliente = Parameters<typeof mapIncidenteToAccidenteMetadata>[0]['cliente'];

// CUIT con dígito verificador válido (reusado del fixture de accidente-schema).
const cliente: Cliente = {
  razon_social: 'Talleres Metalúrgicos SA',
  cuit: '30-55566677-8',
  domicilio: 'Calle 9 de Julio 1500',
};

function makeIncidente(overrides: Partial<Incidente> = {}): Incidente {
  return {
    fecha: '2026-05-11',
    hora: '14:30:00',
    lugar_especifico: 'Línea de prensa, sector B',
    descripcion: 'Operario sufrió corte en la mano al retirar la guarda.',
    gravedad: 'grave',
    dias_perdidos: 15,
    ...overrides,
  };
}

describe('mapIncidenteToAccidenteMetadata · contrato schema', () => {
  it('el resultado pasa accidenteMetadataSchema (con cliente + empleado)', () => {
    const { metadata } = mapIncidenteToAccidenteMetadata({
      incidente: makeIncidente(),
      cliente,
      empleado: { puesto: 'Operario de prensa' },
    });
    expect(accidenteMetadataSchema.safeParse(metadata).success).toBe(true);
  });

  it('pasa el schema aun sin empleado ni hora ni lugar (defaults)', () => {
    const { metadata } = mapIncidenteToAccidenteMetadata({
      incidente: makeIncidente({ hora: null, lugar_especifico: null, dias_perdidos: null }),
      cliente,
      empleado: null,
    });
    expect(accidenteMetadataSchema.safeParse(metadata).success).toBe(true);
  });
});

describe('mapIncidenteToAccidenteMetadata · gravedad libro → template', () => {
  it('mortal → grave_mortal', () => {
    const { metadata } = mapIncidenteToAccidenteMetadata({
      incidente: makeIncidente({ gravedad: 'mortal' }),
      cliente,
      empleado: null,
    });
    expect(metadata.gravedad).toBe('grave_mortal');
  });

  it('grave → grave; leve → leve', () => {
    expect(
      mapIncidenteToAccidenteMetadata({
        incidente: makeIncidente({ gravedad: 'grave' }),
        cliente,
        empleado: null,
      }).metadata.gravedad,
    ).toBe('grave');
    expect(
      mapIncidenteToAccidenteMetadata({
        incidente: makeIncidente({ gravedad: 'leve' }),
        cliente,
        empleado: null,
      }).metadata.gravedad,
    ).toBe('leve');
  });
});

describe('mapIncidenteToAccidenteMetadata · campos derivados', () => {
  it('hora null → "00:00"; presente → HH:MM (sin segundos)', () => {
    expect(
      mapIncidenteToAccidenteMetadata({
        incidente: makeIncidente({ hora: null }),
        cliente,
        empleado: null,
      }).metadata.hora_accidente,
    ).toBe('00:00');
    expect(
      mapIncidenteToAccidenteMetadata({
        incidente: makeIncidente({ hora: '08:05:00' }),
        cliente,
        empleado: null,
      }).metadata.hora_accidente,
    ).toBe('08:05');
  });

  it('lugar/puesto nulos → "A determinar"', () => {
    const { metadata } = mapIncidenteToAccidenteMetadata({
      incidente: makeIncidente({ lugar_especifico: null }),
      cliente,
      empleado: { puesto: null },
    });
    expect(metadata.lugar_especifico).toBe('A determinar');
    expect(metadata.puesto_afectado).toBe('A determinar');
  });

  it('dias_perdidos: 300→300, 366→undefined (cap 365), null→undefined', () => {
    expect(
      mapIncidenteToAccidenteMetadata({
        incidente: makeIncidente({ dias_perdidos: 300 }),
        cliente,
        empleado: null,
      }).metadata.dias_baja_estimados,
    ).toBe(300);
    expect(
      mapIncidenteToAccidenteMetadata({
        incidente: makeIncidente({ dias_perdidos: 366 }),
        cliente,
        empleado: null,
      }).metadata.dias_baja_estimados,
    ).toBeUndefined();
    expect(
      mapIncidenteToAccidenteMetadata({
        incidente: makeIncidente({ dias_perdidos: null }),
        cliente,
        empleado: null,
      }).metadata.dias_baja_estimados,
    ).toBeUndefined();
  });

  it('descripcion_inicial = descripcion del incidente; defaults de lesión', () => {
    const { metadata } = mapIncidenteToAccidenteMetadata({
      incidente: makeIncidente({ descripcion: 'Caída desde andamio a 2 metros.' }),
      cliente,
      empleado: null,
    });
    expect(metadata.descripcion_inicial).toBe('Caída desde andamio a 2 metros.');
    expect(metadata.tipo_lesion).toEqual(['otros']);
    expect(metadata.partes_cuerpo_afectadas).toEqual(['otros']);
    expect(metadata.testigos_presentes).toBe(false);
  });

  it('titulo = "Investigación de accidente — {razón social} — {fecha}"', () => {
    const { titulo } = mapIncidenteToAccidenteMetadata({
      incidente: makeIncidente({ fecha: '2026-05-11' }),
      cliente,
      empleado: null,
    });
    expect(titulo).toBe('Investigación de accidente — Talleres Metalúrgicos SA — 2026-05-11');
  });
});
