/**
 * T-131 · Tests de getDashboardData (derivación del view-model del tablero).
 *
 * Estrategia: mockeamos las sub-queries server-only (calendario / informes /
 * checklists) y verificamos la derivación pura: contador "vencen esta semana"
 * (bucket hoy+siete, sin solaparse con vencidos), orden de la cola de atención
 * (vencidos primero), slice a 6, y borradores recientes (filtro draft + slice 2).
 *
 * Cross-day fix (T-085): los offsets se anclan a `todayCivilIsoAR()` + UTC noon
 * para que el bucketing sea idempotente entre 00:00–03:00 UTC.
 */
import type { CalendarEventRow } from '@/app/(app)/calendario/queries';
import type { ClienteRow } from '@/app/(app)/clientes/queries';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { todayCivilIsoAR } from '@/shared/lib/format-date';

vi.mock('server-only', () => ({}));

const getUpcomingMock = vi.fn<() => Promise<CalendarEventRow[]>>();
const getOverdueMock = vi.fn<() => Promise<CalendarEventRow[]>>();
vi.mock('@/app/(app)/calendario/queries', () => ({
  getUpcomingEvents: () => getUpcomingMock(),
  getOverdueEvents: () => getOverdueMock(),
}));

const listInformesMock = vi.fn();
const countBorradoresMock = vi.fn<() => Promise<number>>();
vi.mock('@/app/(app)/informes/queries', () => ({
  listInformes: () => listInformesMock(),
  countInformesEnBorrador: () => countBorradoresMock(),
}));

const countCapasMock = vi.fn<() => Promise<number>>();
vi.mock('@/app/(app)/checklists/ejecuciones/queries', () => ({
  countCapasAbiertas: () => countCapasMock(),
}));

// Fase B (semáforo): getDashboardData ahora también lista clientes + llama la RPC.
const getClientesMock = vi.fn();
vi.mock('@/app/(app)/clientes/queries', () => ({
  getClientesForConsultora: () => getClientesMock(),
}));

// Import DESPUÉS de los mocks.
const { getDashboardData } = await import('@/app/(app)/dashboard/queries');

function isoDaysFromNow(n: number): string {
  const [y, m, d] = todayCivilIsoAR().split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function makeEvent(over: Partial<CalendarEventRow>): CalendarEventRow {
  return {
    id: 'evt',
    consultora_id: 'c1',
    tipo: 'custom',
    titulo: 'Evento',
    descripcion: null,
    informe_id: null,
    fecha_vencimiento: isoDaysFromNow(3),
    recurrence_months: null,
    status: 'pending',
    completed_at: null,
    completed_by: null,
    parent_event_id: null,
    reminder_offsets_days: [],
    metadata: null,
    created_by: 'u1',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

// fase B: el semáforo llama `supabase.rpc('semaforo_clientes', { p_hoy })`. Stub controlable.
const rpcMock = vi.fn<() => Promise<{ data: unknown; error: unknown }>>();
const fakeSb = { rpc: rpcMock } as never;

function makeCliente(id: string, razon_social: string): ClienteRow {
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
    created_at: '2026-06-01T00:00:00.000Z',
    created_by: null,
    domicilio: null,
    industria: null,
    localidad: null,
    nombre_fantasia: null,
    notas: null,
    provincia: null,
    updated_at: '2026-06-01T00:00:00.000Z',
  };
}

describe('getDashboardData', () => {
  // Defaults seguros para los mocks de fase B: sin clientes + RPC vacía → semaforo === [].
  // Los `it` de fase A no los tocan; el de fase B los sobreescribe en su cuerpo.
  beforeEach(() => {
    getClientesMock.mockResolvedValue([]);
    rpcMock.mockResolvedValue({ data: [], error: null });
  });

  it('métricas + cola priorizada + borradores recientes', async () => {
    getOverdueMock.mockResolvedValue([
      makeEvent({ id: 'o1', fecha_vencimiento: isoDaysFromNow(-10) }),
      makeEvent({ id: 'o2', fecha_vencimiento: isoDaysFromNow(-2) }),
    ]);
    getUpcomingMock.mockResolvedValue([
      makeEvent({ id: 'u-hoy', fecha_vencimiento: isoDaysFromNow(0) }),
      makeEvent({ id: 'u-3', fecha_vencimiento: isoDaysFromNow(3) }),
      makeEvent({ id: 'u-10', fecha_vencimiento: isoDaysFromNow(10) }),
      makeEvent({ id: 'u-20', fecha_vencimiento: isoDaysFromNow(20) }),
      makeEvent({ id: 'u-28', fecha_vencimiento: isoDaysFromNow(28) }),
    ]);
    countBorradoresMock.mockResolvedValue(7);
    countCapasMock.mockResolvedValue(4);
    listInformesMock.mockResolvedValue([
      { id: 'i1', tipo: 'rgrl', titulo: 'Pub', status: 'published', created_at: 'z' },
      { id: 'i2', tipo: 'rgrl', titulo: 'Bo 1', status: 'draft', created_at: 'z' },
      { id: 'i3', tipo: 'rgrl', titulo: 'Bo 2', status: 'draft', created_at: 'z' },
      { id: 'i4', tipo: 'rgrl', titulo: 'Bo 3', status: 'draft', created_at: 'z' },
    ]);

    const data = await getDashboardData(fakeSb);

    // vencidos = overdue.length; vencen esta semana = hoy(0) + siete(3); contadores exactos.
    expect(data.metrics).toEqual({
      vencidos: 2,
      vencenSemana: 2,
      borradores: 7,
      accionesAbiertas: 4,
    });

    // Cola: 2 vencidos primero (severity overdue), luego upcoming; slice a 6.
    expect(data.attention).toHaveLength(6); // 2 overdue + 5 upcoming = 7 → cap 6
    expect(data.attention[0]).toMatchObject({ severity: 'overdue', ev: { id: 'o1' } });
    expect(data.attention[1]).toMatchObject({ severity: 'overdue', ev: { id: 'o2' } });
    expect(data.attention[2]).toMatchObject({ severity: 'upcoming' });
    expect(data.attention.filter((a) => a.severity === 'overdue')).toHaveLength(2);

    // Borradores recientes: filtra draft + slice 2.
    expect(data.recentDrafts.map((d) => d.id)).toEqual(['i2', 'i3']);
  });

  it('sin eventos → cola vacía y métricas en cero', async () => {
    getOverdueMock.mockResolvedValue([]);
    getUpcomingMock.mockResolvedValue([]);
    countBorradoresMock.mockResolvedValue(0);
    countCapasMock.mockResolvedValue(0);
    listInformesMock.mockResolvedValue([]);

    const data = await getDashboardData(fakeSb);

    expect(data.attention).toEqual([]);
    expect(data.recentDrafts).toEqual([]);
    expect(data.metrics).toEqual({
      vencidos: 0,
      vencenSemana: 0,
      borradores: 0,
      accionesAbiertas: 0,
    });
  });

  // Guard de la regresión TZ (cross-day 21:00–00:00 ART): getOverdueEvents corta por
  // "hoy" UTC, así que un vencimiento de HOY-AR llega en el set `overdue`. El derive
  // por fecha civil AR sobre la unión debe clasificarlo como "por vencer", NO vencido.
  // Si se revierte a `vencidos = overdue.length`, este caso se pone rojo.
  it('evento de hoy-AR que llega por overdue (borde 21-24h ART) → por vencer, no vencido', async () => {
    getOverdueMock.mockResolvedValue([
      makeEvent({ id: 'o-viejo', fecha_vencimiento: isoDaysFromNow(-2) }),
      makeEvent({ id: 'o-hoy', fecha_vencimiento: isoDaysFromNow(0) }), // hoy-AR mal-clasificado por UTC
    ]);
    getUpcomingMock.mockResolvedValue([]);
    countBorradoresMock.mockResolvedValue(0);
    countCapasMock.mockResolvedValue(0);
    listInformesMock.mockResolvedValue([]);

    const data = await getDashboardData(fakeSb);

    expect(data.metrics.vencidos).toBe(1); // solo o-viejo
    expect(data.metrics.vencenSemana).toBe(1); // o-hoy
    expect(data.attention.find((a) => a.ev.id === 'o-hoy')?.severity).toBe('upcoming');
  });

  // Fase B: getDashboardData pasa `p_hoy` (civil AR) a la RPC y mergea sus filas con
  // TODOS los clientes activos. El cliente sin fila RPC sale "al día" (verde).
  it('cablea el semáforo: clientes activos + filas RPC → SemaforoItem[] ordenado', async () => {
    getOverdueMock.mockResolvedValue([]);
    getUpcomingMock.mockResolvedValue([]);
    countBorradoresMock.mockResolvedValue(0);
    countCapasMock.mockResolvedValue(0);
    listInformesMock.mockResolvedValue([]);
    getClientesMock.mockResolvedValue([
      makeCliente('c-rojo', 'Rojo SA'),
      makeCliente('c-verde', 'Verde SA'),
    ]);
    rpcMock.mockResolvedValue({
      data: [
        {
          cliente_id: 'c-rojo',
          estado: 'vencido',
          fecha_proxima: '2026-06-01',
          vencidos_count: 2,
          proximos_count: 0,
        },
      ],
      error: null,
    });

    const data = await getDashboardData(fakeSb);

    // Se llamó la RPC con la fecha civil AR (no UTC).
    expect(rpcMock).toHaveBeenCalledWith('semaforo_clientes', {
      p_hoy: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(data.semaforo).toHaveLength(2);
    expect(data.semaforo[0]).toMatchObject({
      id: 'c-rojo',
      estado: 'vencido',
      contexto: '2 vencidos',
    });
    expect(data.semaforo[1]).toMatchObject({ id: 'c-verde', estado: 'al_dia', contexto: 'al día' });
  });
});
