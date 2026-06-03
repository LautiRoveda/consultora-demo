/**
 * T-063-FU1 · Test del filtro `gravedad` server-side en `getIncidentes`.
 *
 * Mockeamos el query-builder de Supabase (chainable) para asertar que el filtro
 * se traduce a un `.eq('gravedad', value)` en el query — antes se filtraba
 * client-side sobre la página devuelta.
 */
import { describe, expect, it, vi } from 'vitest';

import { getIncidentes } from '@/app/(app)/accidentabilidad/queries';

// queries.ts hace `import 'server-only'`, que tira si se importa fuera de un
// bundle server (vitest usa la condición `default`). Lo neutralizamos.
vi.mock('server-only', () => ({}));

type Call = { method: string; args: unknown[] };

function makeBuilder(rows: unknown[] = []) {
  const calls: Call[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  const builder = {
    select: record('select'),
    order: record('order'),
    eq: record('eq'),
    gte: record('gte'),
    lte: record('lte'),
    range: record('range'),
    // Thenable: `await query` resuelve a `{ data }`.
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  return { builder, calls };
}

function makeSupabase(builder: ReturnType<typeof makeBuilder>['builder']) {
  return { from: vi.fn(() => builder) } as unknown as Parameters<typeof getIncidentes>[0];
}

/** Captura el nombre de relación pasado a `.from(...)` (para asertar la vista). */
function makeSupabaseRecordingFrom(builder: ReturnType<typeof makeBuilder>['builder']) {
  const fromArgs: string[] = [];
  const supabase = {
    from: (rel: string) => {
      fromArgs.push(rel);
      return builder;
    },
  } as unknown as Parameters<typeof getIncidentes>[0];
  return { supabase, fromArgs };
}

describe('getIncidentes · filtro gravedad server-side', () => {
  it('aplica .eq("gravedad", value) cuando se pasa gravedad', async () => {
    const { builder, calls } = makeBuilder();
    await getIncidentes(makeSupabase(builder), { gravedad: 'grave' });
    expect(calls).toContainEqual({ method: 'eq', args: ['gravedad', 'grave'] });
  });

  it('no aplica filtro de gravedad cuando no se pasa', async () => {
    const { builder, calls } = makeBuilder();
    await getIncidentes(makeSupabase(builder), {});
    const gravedadEq = calls.filter((c) => c.method === 'eq' && c.args[0] === 'gravedad');
    expect(gravedadEq).toHaveLength(0);
  });

  it('combina gravedad con tipo (ambos como .eq)', async () => {
    const { builder, calls } = makeBuilder();
    await getIncidentes(makeSupabase(builder), { tipo: 'accidente', gravedad: 'mortal' });
    expect(calls).toContainEqual({ method: 'eq', args: ['tipo', 'accidente'] });
    expect(calls).toContainEqual({ method: 'eq', args: ['gravedad', 'mortal'] });
  });
});

describe('getIncidentes · fuente según includeAnulados (T-063-FU2)', () => {
  it('default (sin includeAnulados) lee de incidentes_vigentes', async () => {
    const { builder } = makeBuilder();
    const { supabase, fromArgs } = makeSupabaseRecordingFrom(builder);
    await getIncidentes(supabase, {});
    expect(fromArgs).toEqual(['incidentes_vigentes']);
  });

  it('includeAnulados:false lee de incidentes_vigentes', async () => {
    const { builder } = makeBuilder();
    const { supabase, fromArgs } = makeSupabaseRecordingFrom(builder);
    await getIncidentes(supabase, { includeAnulados: false });
    expect(fromArgs).toEqual(['incidentes_vigentes']);
  });

  it('includeAnulados:true lee de incidentes_heads', async () => {
    const { builder } = makeBuilder();
    const { supabase, fromArgs } = makeSupabaseRecordingFrom(builder);
    await getIncidentes(supabase, { includeAnulados: true });
    expect(fromArgs).toEqual(['incidentes_heads']);
  });

  it('includeAnulados:true mantiene los filtros server-side (.eq gravedad)', async () => {
    const { builder, calls } = makeBuilder();
    const { supabase } = makeSupabaseRecordingFrom(builder);
    await getIncidentes(supabase, { includeAnulados: true, gravedad: 'grave' });
    expect(calls).toContainEqual({ method: 'eq', args: ['gravedad', 'grave'] });
  });
});
