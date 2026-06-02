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
