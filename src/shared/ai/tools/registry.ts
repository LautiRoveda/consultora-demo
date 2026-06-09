import 'server-only';

import type { DispatchToolResult, ToolDefinition, ToolEntry } from '@/shared/ai/tools/tool-result';
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

import { CHECKLIST_TOOL_ENTRIES } from '@/shared/ai/tools/checklists-tools';
import { COMMON_TOOL_ENTRIES } from '@/shared/ai/tools/common-tools';
import { EPP_TOOL_ENTRIES } from '@/shared/ai/tools/epp-tools';
import { fail } from '@/shared/ai/tools/tool-result';
import { logger } from '@/shared/observability/logger';

/**
 * T-125 · Registry central de las tools del asistente IA.
 *
 * Reemplaza el `switch(name)` plano de `epp-chat-tools.ts` (T-117) por un Map
 * `name → ToolEntry` ensamblado desde las listas por módulo. Agregar un módulo =
 * spread de su lista de entries en `ALL_ENTRIES`; el `dispatchTool` y el array
 * `CHAT_TOOLS` los recogen solos, sin tocar el ruteo.
 *
 * `dispatchTool` mantiene la firma exacta de T-117 ({ name, input, supabase,
 * consultoraId }) — los tests la llaman así. Ruteo por lookup O(1); el
 * `default → tool_desconocida`, el `catch → fallo_consulta` y el log viven acá
 * (centralizados, idénticos a antes). Los handlers sólo parsean, consultan y
 * recortan; nunca tiran al caller (lo envuelve este try/catch).
 */

// Orden de registro = orden en que el modelo ve las tools. Spread de cada módulo.
// EPP primero (preserva el orden previo); luego las transversales y Checklists.
const ALL_ENTRIES: ToolEntry[] = [
  ...EPP_TOOL_ENTRIES,
  ...COMMON_TOOL_ENTRIES,
  ...CHECKLIST_TOOL_ENTRIES,
];

/** Definiciones para la API de Anthropic (el stream las castea a `Anthropic.Tool[]`). */
export const CHAT_TOOLS: ToolDefinition[] = ALL_ENTRIES.map((e) => e.definition);

/** Lookup name → entry. */
export const TOOL_REGISTRY: Map<string, ToolEntry> = new Map(
  ALL_ENTRIES.map((e) => [e.definition.name, e]),
);

// Guardia anti-shadow: si dos módulos registran el mismo nombre, el Map lo sombrea
// en silencio. Detectarlo al cargar el módulo (falla ruidosa en import, no en runtime).
if (TOOL_REGISTRY.size !== ALL_ENTRIES.length) {
  throw new Error('Tool registry: nombre de tool duplicado entre módulos.');
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

  const entry = TOOL_REGISTRY.get(name);
  if (!entry) return fail('tool_desconocida', name);

  try {
    return await entry.handler(input, { supabase, consultoraId });
  } catch (err) {
    logger.error({ err, tool: name, consultoraId }, 'epp_chat_tool_failed');
    return fail('fallo_consulta');
  }
}
