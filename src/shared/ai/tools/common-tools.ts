import 'server-only';

import type { ToolEntry } from '@/shared/ai/tools/tool-result';
import { z } from 'zod';

import { searchClientesByRazonSocial } from '@/app/(app)/clientes/queries';
import { fail, ok } from '@/shared/ai/tools/tool-result';

/**
 * T-125 · Tools transversales del asistente IA (reusables por varios módulos).
 *
 * `buscar_cliente` resuelve cliente_id desde la razón social, igual que
 * `buscar_empleado` resuelve empleado_id. Las tools de Inspecciones/CAPAs toman
 * `cliente_id` (no un nombre ambiguo): el modelo resuelve primero el cliente y usa
 * el `id` devuelto. Recorta a lo mostrable; conserva `id` (clave de chaining).
 */

const buscarClienteInput = z.object({
  query: z.string().min(1).max(100),
});

export const COMMON_TOOL_ENTRIES: ToolEntry[] = [
  {
    definition: {
      name: 'buscar_cliente',
      description:
        'Busca clientes (empresas) de la consultora por razón social. Devuelve hasta 10 coincidencias activas con id, razón social, CUIT y localidad. Usá el `id` devuelto para filtrar inspecciones o CAPAs por cliente. Si hay varias coincidencias, preguntá al usuario cuál antes de continuar; nunca asumas.',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Razón social (nombre de la empresa) a buscar. Mín. 2 caracteres.',
            maxLength: 100,
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    handler: async (input, { supabase }) => {
      const parsed = buscarClienteInput.safeParse(input);
      if (!parsed.success) return fail('input_invalido', parsed.error.issues[0]?.message);
      // searchClientesByRazonSocial guarda < 2 chars → []; ILIKE, sólo activos, cap 10.
      const clientes = await searchClientesByRazonSocial(supabase, parsed.data.query);
      return ok(
        clientes.map((c) => ({
          id: c.id,
          razon_social: c.razon_social,
          cuit: c.cuit,
          localidad: c.localidad,
        })),
      );
    },
  },
];
