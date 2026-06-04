import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import { searchEmpleadosByDni, searchEmpleadosByNombre } from '@/app/(app)/empleados/queries';
import {
  getEntregasByEmpleado,
  getPlanificacionesActivasByEmpleado,
} from '@/app/(app)/epp/entregas/queries';
import { listEmpleadosConEstadoEpp } from '@/app/(app)/epp/padron/queries';
import { logger } from '@/shared/observability/logger';

/**
 * T-117 · Tools (sólo-lectura) + dispatcher del asistente IA de EPP.
 *
 * Cada tool mapea 1:1 a una query que YA EXISTE — acá no se crean queries ni
 * se toca SQL. El dispatcher corre la query con el `supabase` RLS-aware del
 * usuario logueado → aislamiento por consultora garantizado (cross-tenant → []).
 *
 * El dispatcher es **puro respecto de Anthropic** (no importa el SDK) → testeable
 * de forma determinística contra una DB sembrada, sin mockear el LLM. Nunca tira:
 * tool desconocida / input inválido / fallo de query vuelven como tool_result con
 * `isError: true`, para que el modelo se recupere en vez de cortar el loop.
 *
 * **Result shaping**: antes de serializar recortamos los identificadores internos
 * (calendar_event_id, ids de entrega/item, cliente_id, cuil) — el modelo no los
 * necesita y, si los ve, tiende a citarlos como si fueran datos. El único id que
 * sobrevive es `empleado.id`, porque es lo que el modelo pasa a las otras tools.
 */

/** Cap del string del tool_result (defensa anti-token-blowup del siguiente turno). */
const TOOL_RESULT_MAX_CHARS = 6000;

export const EPP_CHAT_TOOLS = [
  {
    name: 'buscar_empleado',
    description:
      'Busca empleados de la consultora por nombre/apellido o por DNI. Si el texto son sólo dígitos se busca por DNI (mín. 3 dígitos); si no, por nombre o apellido (mín. 2 letras). Devuelve hasta 10 coincidencias activas con id, nombre, apellido, dni y puesto. Usá el `id` devuelto para las demás herramientas. Si hay varias coincidencias, preguntá al usuario cuál antes de continuar; nunca asumas.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Nombre, apellido o DNI a buscar.',
          maxLength: 100,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'epp_entregado_a_empleado',
    description:
      'Historial de EPP entregado y FIRMADO a un empleado, más reciente primero. Devuelve fecha de entrega, si está firmada y los ítems (nombre, categoría, cantidad, motivo, número de serie). Requiere el `id` del empleado (obtenelo con buscar_empleado).',
    input_schema: {
      type: 'object',
      properties: {
        empleado_id: {
          type: 'string',
          description: 'UUID del empleado (campo id de buscar_empleado).',
        },
      },
      required: ['empleado_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'vencimientos_epp_de_empleado',
    description:
      'Próximas reposiciones/vencimientos de EPP planificados y ACTIVOS de un empleado, ordenados por fecha más próxima. Devuelve el EPP (item_nombre), la fecha de próxima entrega y la frecuencia en meses. Requiere el `id` del empleado.',
    input_schema: {
      type: 'object',
      properties: {
        empleado_id: {
          type: 'string',
          description: 'UUID del empleado (campo id de buscar_empleado).',
        },
      },
      required: ['empleado_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'vencimientos_epp_proximos',
    description:
      'Empleados de la consultora con EPP que vence o requiere reposición en los PRÓXIMOS 30 DÍAS (ventana fija, no configurable). Por empleado: nombre, apellido, dni, cliente, última entrega y cantidad de reposiciones próximas. Útil para "¿a quién le vence el EPP pronto?".',
    input_schema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
] as const;

/** Resultado de una tool: el `content` (string) va al bloque tool_result. */
export type DispatchToolResult = { content: string; isError: boolean };

const buscarEmpleadoInput = z.object({
  query: z.string().min(1).max(100),
});

const empleadoIdInput = z.object({
  empleado_id: z.string().uuid({ message: 'empleado_id debe ser un UUID.' }),
});

function ok(value: unknown): DispatchToolResult {
  let json = JSON.stringify(value);
  if (json.length > TOOL_RESULT_MAX_CHARS) {
    json = `${json.slice(0, TOOL_RESULT_MAX_CHARS)}…(resultado truncado, refiná la búsqueda)`;
  }
  return { content: json, isError: false };
}

function fail(error: string, detalle?: string): DispatchToolResult {
  return {
    content: JSON.stringify(detalle ? { error, detalle } : { error }),
    isError: true,
  };
}

/**
 * Ejecuta una tool por nombre. RLS la impone el `supabase` del request;
 * `consultoraId` se usa sólo para correlación en logs. Nunca tira.
 */
export async function dispatchTool(args: {
  name: string;
  input: unknown;
  supabase: SupabaseClient<Database>;
  consultoraId: string;
}): Promise<DispatchToolResult> {
  const { name, input, supabase, consultoraId } = args;

  try {
    switch (name) {
      case 'buscar_empleado': {
        const parsed = buscarEmpleadoInput.safeParse(input);
        if (!parsed.success) return fail('input_invalido', parsed.error.issues[0]?.message);
        const query = parsed.data.query.trim();
        const empleados = /^\d+$/.test(query)
          ? await searchEmpleadosByDni(supabase, query)
          : await searchEmpleadosByNombre(supabase, query);
        return ok(
          empleados.map((e) => ({
            id: e.id,
            nombre: e.nombre,
            apellido: e.apellido,
            dni: e.dni,
            puesto: e.puesto,
          })),
        );
      }

      case 'epp_entregado_a_empleado': {
        const parsed = empleadoIdInput.safeParse(input);
        if (!parsed.success) return fail('input_invalido', parsed.error.issues[0]?.message);
        const entregas = await getEntregasByEmpleado(supabase, parsed.data.empleado_id);
        return ok(
          entregas.map((en) => ({
            fecha_entrega: en.fecha_entrega,
            firmado: en.firmado_at !== null,
            observaciones: en.observaciones,
            items: en.items.map((it) => ({
              nombre: it.item_nombre,
              categoria: it.categoria_nombre,
              cantidad: it.cantidad,
              motivo: it.motivo_entrega,
              numero_serie: it.numero_serie,
            })),
          })),
        );
      }

      case 'vencimientos_epp_de_empleado': {
        const parsed = empleadoIdInput.safeParse(input);
        if (!parsed.success) return fail('input_invalido', parsed.error.issues[0]?.message);
        const planificaciones = await getPlanificacionesActivasByEmpleado(
          supabase,
          parsed.data.empleado_id,
        );
        return ok(
          planificaciones.map((p) => ({
            item_nombre: p.item_nombre,
            fecha_proxima_entrega: p.fecha_proxima_entrega,
            frecuencia_meses: p.frecuencia_meses,
          })),
        );
      }

      case 'vencimientos_epp_proximos': {
        const rows = await listEmpleadosConEstadoEpp(supabase, {});
        return ok(
          rows
            .filter((r) => r.pendientes_proximos_count > 0)
            .map((r) => ({
              nombre: r.empleado_nombre,
              apellido: r.empleado_apellido,
              dni: r.empleado_dni,
              cliente: r.cliente_razon_social,
              ultima_entrega: r.ultima_entrega,
              pendientes_proximos_count: r.pendientes_proximos_count,
            })),
        );
      }

      default:
        return fail('tool_desconocida', name);
    }
  } catch (err) {
    logger.error({ err, tool: name, consultoraId }, 'epp_chat_tool_failed');
    return fail('fallo_consulta');
  }
}
