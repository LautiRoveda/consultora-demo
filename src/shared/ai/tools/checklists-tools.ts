import 'server-only';

import type { ToolEntry } from '@/shared/ai/tools/tool-result';
import { z } from 'zod';

import {
  getCapasForConsultora,
  getEjecucionesForConsultora,
  getEjecucionForDetail,
} from '@/app/(app)/checklists/ejecuciones/queries';
import { fail, ok } from '@/shared/ai/tools/tool-result';
import { todayCivilIsoAR } from '@/shared/lib/format-date';

/**
 * T-125 · Tools (sólo-lectura) del módulo Checklists/Inspecciones del asistente IA.
 *
 * Mapean 1:1 a queries RLS-aware existentes. Recorte de IDs internos (igual que
 * EPP): el único id que sobrevive es el de la inspección (`listar_inspecciones.id`),
 * porque es lo que el modelo pasa a `inspeccion_detalle`. Nombre de cliente mostrado
 * = `establecimiento_razon_social` (SNAPSHOT tomado al momento de la inspección),
 * pero el FILTRO es por `cliente_id` (resuelto con `buscar_cliente`).
 */

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const listarInspeccionesInput = z.object({
  cliente_id: z.string().uuid().optional(),
  estado: z.enum(['borrador', 'cerrada', 'anulada']).optional(),
  fecha_desde: z.string().regex(FECHA_ISO, 'fecha_desde debe ser YYYY-MM-DD.').optional(),
  fecha_hasta: z.string().regex(FECHA_ISO, 'fecha_hasta debe ser YYYY-MM-DD.').optional(),
  incluir_anuladas: z.boolean().optional(),
});

const inspeccionDetalleInput = z.object({
  execution_id: z.string().uuid({ message: 'execution_id debe ser un UUID.' }),
});

const capasPendientesInput = z.object({
  cliente_id: z.string().uuid().optional(),
  prioridad: z.enum(['baja', 'media', 'alta']).optional(),
  dentro_de_dias: z.number().int().min(1).max(365).optional(),
  fecha_desde: z.string().regex(FECHA_ISO, 'fecha_desde debe ser YYYY-MM-DD.').optional(),
  fecha_hasta: z.string().regex(FECHA_ISO, 'fecha_hasta debe ser YYYY-MM-DD.').optional(),
  estados: z.array(z.enum(['abierta', 'en_progreso', 'cerrada', 'anulada'])).optional(),
});

export const CHECKLIST_TOOL_ENTRIES: ToolEntry[] = [
  {
    definition: {
      name: 'listar_inspecciones',
      description:
        'Lista las inspecciones/checklists (relevamientos como el RGRL) de la consultora, más recientes primero. Filtros opcionales: cliente_id (de buscar_cliente), estado (borrador|cerrada|anulada), rango de fecha de inspección (fecha_desde/fecha_hasta, YYYY-MM-DD). Por defecto excluye las anuladas; pasá incluir_anuladas=true para verlas. Devuelve por inspección: id, cliente (empresa relevada), fecha, estado, cumplimiento_pct y si tiene críticos incumplidos. Usá el `id` con inspeccion_detalle.',
      input_schema: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string', description: 'UUID del cliente (de buscar_cliente).' },
          estado: {
            type: 'string',
            enum: ['borrador', 'cerrada', 'anulada'],
            description: 'Filtra por estado. "anulada" implica incluir_anuladas.',
          },
          fecha_desde: { type: 'string', description: 'Fecha de inspección desde (YYYY-MM-DD).' },
          fecha_hasta: { type: 'string', description: 'Fecha de inspección hasta (YYYY-MM-DD).' },
          incluir_anuladas: {
            type: 'boolean',
            description: 'Incluir inspecciones anuladas (por defecto false).',
          },
        },
        additionalProperties: false,
      },
    },
    handler: async (input, { supabase }) => {
      const parsed = listarInspeccionesInput.safeParse(input);
      if (!parsed.success) return fail('input_invalido', parsed.error.issues[0]?.message);
      const { cliente_id, estado, fecha_desde, fecha_hasta, incluir_anuladas } = parsed.data;
      // Coherencia: las anuladas sólo existen en la vista heads. Si piden estado
      // 'anulada', leemos heads aunque no hayan pasado incluir_anuladas (sino → []).
      const includeAnuladas = incluir_anuladas === true || estado === 'anulada';
      const inspecciones = await getEjecucionesForConsultora(supabase, {
        includeAnuladas,
        clienteId: cliente_id,
        estado,
        fechaDesde: fecha_desde,
        fechaHasta: fecha_hasta,
        limit: 25,
      });
      return ok(
        inspecciones.map((e) => ({
          id: e.id,
          cliente: e.establecimiento_razon_social, // snapshot de la empresa relevada
          fecha_inspeccion: e.fecha_inspeccion,
          estado: e.estado,
          cumplimiento_pct: e.cumplimiento_pct,
          tiene_criticos_incumplidos: e.tiene_criticos_incumplidos,
        })),
      );
    },
  },
  {
    definition: {
      name: 'inspeccion_detalle',
      description:
        'Detalle de una inspección/checklist: datos de la inspección (cliente, fecha, estado, vigencia, cumplimiento, scores) y sus CAPAs (acciones correctivas). Requiere el `id` de la inspección (obtenelo con listar_inspecciones). No devuelve fotos, firma ni el detalle ítem por ítem.',
      input_schema: {
        type: 'object',
        properties: {
          execution_id: {
            type: 'string',
            description: 'UUID de la inspección (campo id de listar_inspecciones).',
          },
        },
        required: ['execution_id'],
        additionalProperties: false,
      },
    },
    handler: async (input, { supabase }) => {
      const parsed = inspeccionDetalleInput.safeParse(input);
      if (!parsed.success) return fail('input_invalido', parsed.error.issues[0]?.message);
      const detalle = await getEjecucionForDetail(supabase, parsed.data.execution_id);
      // No existe / cross-tenant → marcador explícito (no es error: query válida sin fila).
      if (!detalle) return ok({ encontrada: false });
      const { execution, esVigente, acciones } = detalle;
      return ok({
        encontrada: true,
        cliente: execution.establecimiento_razon_social,
        fecha_inspeccion: execution.fecha_inspeccion,
        estado: execution.estado,
        vigente: esVigente,
        cumplimiento_pct: execution.cumplimiento_pct,
        tiene_criticos_incumplidos: execution.tiene_criticos_incumplidos,
        score_cumple: execution.score_cumple,
        score_no_cumple: execution.score_no_cumple,
        score_na: execution.score_na,
        capas: acciones.map((a) => ({
          descripcion: a.descripcion,
          prioridad: a.prioridad,
          estado: a.estado,
          fecha_compromiso: a.fecha_compromiso,
          fecha_vencimiento: a.calendar_event_fecha_vencimiento,
        })),
      });
    },
  },
  {
    definition: {
      name: 'capas_pendientes',
      description:
        'CAPAs (acciones correctivas) de toda la consultora, ordenadas por fecha de compromiso (más próxima primero). Por defecto sólo las pendientes (abiertas o en progreso). Útil para "¿qué CAPAs vencen pronto o están vencidas?". Filtros opcionales: cliente_id, prioridad (baja|media|alta), ventana en días (dentro_de_dias, p.ej. 30) o rango de fechas (fecha_desde/fecha_hasta), y estados para ampliar más allá de las pendientes.',
      input_schema: {
        type: 'object',
        properties: {
          cliente_id: { type: 'string', description: 'UUID del cliente (de buscar_cliente).' },
          prioridad: { type: 'string', enum: ['baja', 'media', 'alta'] },
          dentro_de_dias: {
            type: 'integer',
            description:
              'Ventana: CAPAs con fecha de compromiso hasta hoy + N días (incluye vencidas).',
            minimum: 1,
            maximum: 365,
          },
          fecha_desde: { type: 'string', description: 'Fecha de compromiso desde (YYYY-MM-DD).' },
          fecha_hasta: { type: 'string', description: 'Fecha de compromiso hasta (YYYY-MM-DD).' },
          estados: {
            type: 'array',
            items: { type: 'string', enum: ['abierta', 'en_progreso', 'cerrada', 'anulada'] },
            description: 'Estados a incluir. Por defecto: abierta y en_progreso (pendientes).',
          },
        },
        additionalProperties: false,
      },
    },
    handler: async (input, { supabase }) => {
      const parsed = capasPendientesInput.safeParse(input);
      if (!parsed.success) return fail('input_invalido', parsed.error.issues[0]?.message);
      const { cliente_id, prioridad, dentro_de_dias, fecha_desde, fecha_hasta, estados } =
        parsed.data;
      // "dentro de N días" → tope de fecha_compromiso = hoy (AR) + N. Sin piso →
      // incluye las vencidas (fecha pasada) que siguen pendientes. fecha_hasta explícita gana.
      let fechaHasta = fecha_hasta;
      if (fechaHasta == null && dentro_de_dias != null) {
        const hasta = new Date();
        hasta.setDate(hasta.getDate() + dentro_de_dias);
        fechaHasta = todayCivilIsoAR(hasta);
      }
      const capas = await getCapasForConsultora(supabase, {
        estados,
        clienteId: cliente_id,
        prioridad,
        fechaDesde: fecha_desde,
        fechaHasta,
        limit: 50,
      });
      return ok(
        capas.map((c) => ({
          descripcion: c.descripcion,
          prioridad: c.prioridad,
          estado: c.estado,
          fecha_compromiso: c.fecha_compromiso,
          cliente: c.cliente_razon_social,
        })),
      );
    },
  },
];
