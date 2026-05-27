/**
 * T-107 · Helper de inyección de tablas SRT verificadas al prompt IA.
 *
 * Llamado desde el route handler del stream de generación de informes
 * (`src/app/api/informes/[id]/generate-stream/route.ts`) con el array
 * `agentes_a_relevar` de la metadata del informe relevamiento.
 *
 * Devuelve string (NO undefined) — caller hace string concat directo.
 * Si ningún agente del input tiene tabla cargada, retorna string vacío.
 *
 * Política de actualización: ADR-0013. Cada cambio en valores SRT
 * requiere bump del campo `version_tabla` en el const correspondiente +
 * commit con quote textual de fuente primaria en el PR.
 */
import type { AgenteHys } from '@/shared/templates/relevamiento/schema';
import type { SRTTable } from './res-85-12-ruido';

import { RES_85_12_RUIDO } from './res-85-12-ruido';

const SRT_TABLES_BY_AGENTE: Partial<Record<AgenteHys, SRTTable>> = {
  ruido: RES_85_12_RUIDO,
};

/**
 * Extrae la fecha YYYY-MM-DD del campo `version_tabla` (formato YYYY-MM-DD-vN).
 *
 * Throw on invalid format por diseño — un disclaimer con fecha rota es bug
 * visible que el matriculado va a notar al revisar. Silent fallback escondería
 * el problema. Ver ADR-0013.
 *
 * @internal Exportado únicamente para tests; no es parte del API público.
 */
export function formatVerifiedAt(versionTabla: string): string {
  const match = versionTabla.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match || !match[1]) {
    throw new Error(`Invalid version_tabla format: ${versionTabla}`);
  }
  return match[1];
}

/**
 * Inyecta bloques markdown SRT verificados para los agentes pasados. Para
 * cada agente que tenga tabla cargada, reemplaza `{VERIFIED_AT}` en el
 * `formato_informe` con la fecha del campo `version_tabla`.
 *
 * Múltiples bloques se separan con `\n\n---\n\n` (forward-compat para
 * agentes adicionales en T-107-FU0+).
 */
export function injectSRTTables(agentes: readonly AgenteHys[]): string {
  if (agentes.length === 0) return '';
  const blocks = agentes
    .map((agente) => SRT_TABLES_BY_AGENTE[agente])
    .filter((t): t is SRTTable => t !== undefined)
    .map((table) =>
      table.formato_informe.replace('{VERIFIED_AT}', formatVerifiedAt(table.version_tabla)),
    );
  return blocks.length === 0 ? '' : blocks.join('\n\n---\n\n');
}

export type { SRTTable } from './res-85-12-ruido';
