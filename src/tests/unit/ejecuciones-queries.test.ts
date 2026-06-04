/**
 * T-061-FU1 · `getEjecucionesForConsultora`: la fuente de lectura cambia con
 * `includeAnuladas` (vigentes ↔ heads). Mockeamos el query-builder de Supabase
 * (chainable) y capturamos el nombre de relación pasado a `.from(...)`.
 */
import { describe, expect, it, vi } from 'vitest';

import { getEjecucionesForConsultora } from '@/app/(app)/checklists/ejecuciones/queries';

// queries.ts hace `import 'server-only'`, que tira fuera de un bundle server.
vi.mock('server-only', () => ({}));

function makeBuilder(rows: unknown[] = []) {
  const builder = {
    select: () => builder,
    order: () => builder,
    // Thenable: `await query` resuelve a `{ data }`.
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: rows, error: null }),
  };
  return builder;
}

/** Captura el nombre de relación pasado a `.from(...)` (para asertar la vista). */
function makeSupabaseRecordingFrom(builder: ReturnType<typeof makeBuilder>) {
  const fromArgs: string[] = [];
  const supabase = {
    from: (rel: string) => {
      fromArgs.push(rel);
      return builder;
    },
  } as unknown as Parameters<typeof getEjecucionesForConsultora>[0];
  return { supabase, fromArgs };
}

describe('getEjecucionesForConsultora · fuente según includeAnuladas (T-061-FU1)', () => {
  it('default (sin opts) lee de checklist_executions_vigentes', async () => {
    const { supabase, fromArgs } = makeSupabaseRecordingFrom(makeBuilder());
    await getEjecucionesForConsultora(supabase);
    expect(fromArgs).toEqual(['checklist_executions_vigentes']);
  });

  it('includeAnuladas:false lee de checklist_executions_vigentes', async () => {
    const { supabase, fromArgs } = makeSupabaseRecordingFrom(makeBuilder());
    await getEjecucionesForConsultora(supabase, { includeAnuladas: false });
    expect(fromArgs).toEqual(['checklist_executions_vigentes']);
  });

  it('includeAnuladas:true lee de checklist_executions_heads', async () => {
    const { supabase, fromArgs } = makeSupabaseRecordingFrom(makeBuilder());
    await getEjecucionesForConsultora(supabase, { includeAnuladas: true });
    expect(fromArgs).toEqual(['checklist_executions_heads']);
  });
});
