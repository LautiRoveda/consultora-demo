import 'server-only';

import type { ToolEntry } from '@/shared/ai/tools/tool-result';
import { z } from 'zod';

import { searchEmpleadosByDni, searchEmpleadosForChat } from '@/app/(app)/empleados/queries';
import {
  getEntregasByEmpleado,
  getPlanificacionesActivasByEmpleado,
} from '@/app/(app)/epp/entregas/queries';
import { listEmpleadosConEstadoEpp } from '@/app/(app)/epp/padron/queries';
import { fail, ok } from '@/shared/ai/tools/tool-result';

/**
 * T-125 · Tools (sólo-lectura) del módulo EPP + empleados del asistente IA.
 *
 * Movidas verbatim desde el viejo `epp-chat-tools.ts` (T-117) al registry: mismas
 * definiciones (nombres SIN renombrar — los guardan los tests y el prompt), mismo
 * recorte de IDs internos, mismo parse zod por handler. Cada tool mapea 1:1 a una
 * query existente; el `supabase` RLS-aware del request garantiza el aislamiento
 * por consultora (cross-tenant → []).
 *
 * Result shaping: antes de serializar recortamos los identificadores internos
 * (calendar_event_id, ids de entrega/item, cliente_id, cuil). El único id que
 * sobrevive es `empleado.id`, porque es lo que el modelo pasa a las otras tools.
 */

const buscarEmpleadoInput = z.object({
  query: z.string().min(1).max(100),
});

const empleadoIdInput = z.object({
  empleado_id: z.string().uuid({ message: 'empleado_id debe ser un UUID.' }),
});

export const EPP_TOOL_ENTRIES: ToolEntry[] = [
  {
    definition: {
      name: 'buscar_empleado',
      description:
        'Busca empleados de la consultora por nombre/apellido o por DNI. Si el texto son sólo dígitos se busca por DNI (mín. 3 dígitos); si no, por nombre o apellido (mín. 2 letras). Devuelve hasta 10 coincidencias activas con id, nombre, apellido y dni. Usá el `id` devuelto para las demás herramientas. Si hay varias coincidencias, preguntá al usuario cuál antes de continuar; nunca asumas.',
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
    handler: async (input, { supabase }) => {
      const parsed = buscarEmpleadoInput.safeParse(input);
      if (!parsed.success) return fail('input_invalido', parsed.error.issues[0]?.message);
      const query = parsed.data.query.trim();
      // Sólo dígitos → DNI (prefix match). Si no → búsqueda robusta del chat
      // (multi-término + accent-insensitive, T-117-FU1).
      const empleados = /^\d+$/.test(query)
        ? await searchEmpleadosByDni(supabase, query)
        : await searchEmpleadosForChat(supabase, query);
      return ok(
        empleados.map((e) => ({
          id: e.id,
          nombre: e.nombre,
          apellido: e.apellido,
          dni: e.dni,
        })),
      );
    },
  },
  {
    definition: {
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
    handler: async (input, { supabase }) => {
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
    },
  },
  {
    definition: {
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
    handler: async (input, { supabase }) => {
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
    },
  },
  {
    definition: {
      name: 'vencimientos_epp_proximos',
      description:
        'Empleados de la consultora con EPP que vence o requiere reposición en los PRÓXIMOS 30 DÍAS (ventana fija, no configurable). Por empleado: nombre, apellido, dni, cliente, última entrega y cantidad de reposiciones próximas. Útil para "¿a quién le vence el EPP pronto?".',
      input_schema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    handler: async (_input, { supabase }) => {
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
    },
  },
];
