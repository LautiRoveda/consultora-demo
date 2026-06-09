import type { ClienteRow } from '../clientes/queries';
import type { SemaforoEstado, SemaforoItem, SemaforoRow } from './queries';

import { civilDayDiff } from './format';

/**
 * T-131 fase B · Merge puro del semáforo por cliente.
 *
 * La RPC `semaforo_clientes` devuelve SOLO clientes con ≥1 vencimiento derivable.
 * Acá cruzamos con TODOS los clientes activos (`getClientesForConsultora`, fuente de
 * verdad de "cliente activo") → los ausentes del resultado RPC son `al_dia` (verde).
 * Orden: rojo → amarillo → verde, luego `fecha_proxima` ASC, luego nombre. Las filas
 * RPC de clientes archivados (cliente_id que no está en la lista activa) se descartan
 * por construcción: iteramos la lista de clientes, no las filas.
 *
 * Sin `'server-only'`: módulo puro y testeable (igual que `format.ts` /
 * `agenda-buckets.ts`). NO reimplementar el date-math: reusa `civilDayDiff` (T-085).
 */

const ESTADO_RANK: Record<SemaforoEstado, number> = { vencido: 0, por_vencer: 1, al_dia: 2 };

/** Contexto mínimo por cliente: "N vencido(s)" (rojo) / "vence en X d" (ámbar) / "al día". */
function contextoFor(row: SemaforoRow | undefined, hoy: string): string {
  if (!row) return 'al día';
  if (row.vencidos_count > 0) {
    return `${row.vencidos_count} ${row.vencidos_count === 1 ? 'vencido' : 'vencidos'}`;
  }
  if (row.estado === 'por_vencer' && row.fecha_proxima) {
    const dias = civilDayDiff(hoy, row.fecha_proxima);
    return dias <= 0 ? 'vence hoy' : `vence en ${dias} d`;
  }
  return 'al día';
}

export function buildSemaforo(
  clientes: ReadonlyArray<ClienteRow>,
  rows: ReadonlyArray<SemaforoRow>,
  hoy: string,
): SemaforoItem[] {
  const byId = new Map<string, SemaforoRow>();
  for (const r of rows) {
    if (r.cliente_id) byId.set(r.cliente_id, r);
  }

  const items: SemaforoItem[] = clientes.map((c) => {
    const row = byId.get(c.id);
    return {
      id: c.id,
      nombre: c.razon_social,
      estado: row ? (row.estado as SemaforoEstado) : 'al_dia',
      contexto: contextoFor(row, hoy),
    };
  });

  items.sort((a, b) => {
    const rank = ESTADO_RANK[a.estado] - ESTADO_RANK[b.estado];
    if (rank !== 0) return rank;
    // Dentro del bucket: el vencimiento más próximo primero; nulls (sin fila) al final.
    const fa = byId.get(a.id)?.fecha_proxima ?? null;
    const fb = byId.get(b.id)?.fecha_proxima ?? null;
    if (fa && fb && fa !== fb) return fa < fb ? -1 : 1;
    if (fa && !fb) return -1;
    if (!fa && fb) return 1;
    return a.nombre.localeCompare(b.nombre, 'es');
  });

  return items;
}
