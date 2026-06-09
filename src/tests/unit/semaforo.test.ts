/**
 * T-131 fase B · Tests de `buildSemaforo` (merge puro del semáforo por cliente).
 *
 * Helper puro (sin mocks, igual que agenda-buckets.test): verificamos el orden
 * (rojo→amarillo→verde, intra-bucket por fecha asc, desempate por nombre), el merge
 * (cliente ausente del RPC → al_dia), los textos de contexto, y el drop de filas RPC
 * de clientes archivados (ausentes de la lista activa).
 */
import type { ClienteRow } from '@/app/(app)/clientes/queries';
import type { SemaforoRow } from '@/app/(app)/dashboard/queries';
import { describe, expect, it } from 'vitest';

import { buildSemaforo } from '@/app/(app)/dashboard/semaforo';

const HOY = '2026-06-09';

function mkCliente(id: string, razon_social: string): ClienteRow {
  return {
    id,
    razon_social,
    consultora_id: 'c1',
    cuit: '20-12345678-9',
    archived_at: null,
    art: null,
    contacto_email: null,
    contacto_nombre: null,
    contacto_telefono: null,
    created_at: '2026-01-01T00:00:00.000Z',
    created_by: null,
    domicilio: null,
    industria: null,
    localidad: null,
    nombre_fantasia: null,
    notas: null,
    provincia: null,
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function mkRow(over: Partial<SemaforoRow> & { cliente_id: string }): SemaforoRow {
  return { estado: 'al_dia', fecha_proxima: HOY, vencidos_count: 0, proximos_count: 0, ...over };
}

describe('buildSemaforo', () => {
  it('ordena rojo → amarillo → verde (peor estado primero)', () => {
    const clientes = [mkCliente('verde', 'V'), mkCliente('rojo', 'R'), mkCliente('amar', 'A')];
    const rows = [
      mkRow({
        cliente_id: 'rojo',
        estado: 'vencido',
        vencidos_count: 1,
        fecha_proxima: '2026-06-01',
      }),
      mkRow({ cliente_id: 'amar', estado: 'por_vencer', fecha_proxima: '2026-06-20' }),
      mkRow({ cliente_id: 'verde', estado: 'al_dia', fecha_proxima: '2026-09-01' }),
    ];

    const out = buildSemaforo(clientes, rows, HOY);

    expect(out.map((s) => s.id)).toEqual(['rojo', 'amar', 'verde']);
    expect(out.map((s) => s.estado)).toEqual(['vencido', 'por_vencer', 'al_dia']);
  });

  it('intra-bucket: el vencimiento más próximo primero', () => {
    const clientes = [mkCliente('b', 'B'), mkCliente('a', 'A')];
    const rows = [
      mkRow({ cliente_id: 'b', estado: 'por_vencer', fecha_proxima: '2026-06-25' }),
      mkRow({ cliente_id: 'a', estado: 'por_vencer', fecha_proxima: '2026-06-12' }),
    ];

    const out = buildSemaforo(clientes, rows, HOY);

    expect(out.map((s) => s.id)).toEqual(['a', 'b']); // 'a' vence antes
  });

  it('desempate por nombre cuando no hay fecha (verdes sin fila)', () => {
    const clientes = [mkCliente('z', 'Zeta'), mkCliente('a', 'Alfa')];

    const out = buildSemaforo(clientes, [], HOY);

    expect(out.map((s) => s.nombre)).toEqual(['Alfa', 'Zeta']);
    expect(out.every((s) => s.estado === 'al_dia')).toBe(true);
  });

  it('cliente ausente del RPC → al día (verde)', () => {
    const out = buildSemaforo([mkCliente('x', 'X')], [], HOY);

    expect(out[0]).toMatchObject({ id: 'x', estado: 'al_dia', contexto: 'al día' });
  });

  it('textos de contexto: N vencido(s) / vence en X d / vence hoy', () => {
    const clientes = [
      mkCliente('uno', 'Uno'),
      mkCliente('dos', 'Dos'),
      mkCliente('hoy', 'Hoy'),
      mkCliente('cinco', 'Cinco'),
    ];
    const rows = [
      mkRow({
        cliente_id: 'uno',
        estado: 'vencido',
        vencidos_count: 1,
        fecha_proxima: '2026-06-01',
      }),
      mkRow({
        cliente_id: 'dos',
        estado: 'vencido',
        vencidos_count: 2,
        fecha_proxima: '2026-05-20',
      }),
      mkRow({ cliente_id: 'hoy', estado: 'por_vencer', fecha_proxima: HOY }),
      mkRow({ cliente_id: 'cinco', estado: 'por_vencer', fecha_proxima: '2026-06-14' }),
    ];

    const out = buildSemaforo(clientes, rows, HOY);
    const ctx = Object.fromEntries(out.map((s) => [s.id, s.contexto]));

    expect(ctx.uno).toBe('1 vencido');
    expect(ctx.dos).toBe('2 vencidos');
    expect(ctx.hoy).toBe('vence hoy');
    expect(ctx.cinco).toBe('vence en 5 d');
  });

  it('descarta filas RPC de clientes archivados (no en la lista activa)', () => {
    const clientes = [mkCliente('activo', 'Activo')];
    const rows = [
      mkRow({ cliente_id: 'activo', estado: 'por_vencer', fecha_proxima: '2026-06-14' }),
      mkRow({
        cliente_id: 'archivado',
        estado: 'vencido',
        vencidos_count: 9,
        fecha_proxima: '2026-01-01',
      }),
    ];

    const out = buildSemaforo(clientes, rows, HOY);

    expect(out).toHaveLength(clientes.length); // el archivado no aparece
    expect(out.map((s) => s.id)).toEqual(['activo']);
  });
});
