import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * T-125 · Contrato compartido de las tools del asistente IA (registry).
 *
 * Antes vivía privado dentro de `epp-chat-tools.ts`; lo extraemos para que TODOS
 * los módulos del registry (EPP, Checklists, …) usen el MISMO `ok`/`fail` y el
 * mismo cap de truncado. Single source → la longitud, el sufijo de truncado y la
 * forma del JSON de error no pueden divergir entre módulos.
 *
 * Las tools son sólo-lectura y NUNCA tiran: input inválido / fallo de query /
 * tool desconocida vuelven como tool_result con `isError: true`, para que el
 * modelo se recupere en vez de cortar el loop. El recorte de IDs internos lo hace
 * cada handler antes de `ok()` (el modelo no los necesita y, si los ve, los cita
 * como si fueran datos).
 */

/** Cap del string del tool_result (defensa anti-token-blowup del siguiente turno). */
export const TOOL_RESULT_MAX_CHARS = 6000;

/** Resultado de una tool: el `content` (string) va al bloque tool_result. */
export type DispatchToolResult = { content: string; isError: boolean };

/**
 * Contexto que el registry inyecta a cada handler. RLS la impone el `supabase`
 * del request; `consultoraId` se usa sólo para correlación en logs (NO para
 * filtrar — la fuente de verdad es el claim del JWT).
 */
export type ToolContext = {
  supabase: SupabaseClient<Database>;
  consultoraId: string;
};

/** Un handler corre la query y devuelve el tool_result. No tira (lo envuelve el registry). */
export type ToolHandler = (input: unknown, ctx: ToolContext) => Promise<DispatchToolResult>;

/** Definición de la tool tal cual la consume la API de Anthropic (vía cast en el stream). */
export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: readonly string[];
    additionalProperties: false;
  };
};

/** Entry del registry: la definición (para el modelo) + su handler (para el dispatch). */
export type ToolEntry = {
  definition: ToolDefinition;
  handler: ToolHandler;
};

export function ok(value: unknown): DispatchToolResult {
  let json = JSON.stringify(value);
  if (json.length > TOOL_RESULT_MAX_CHARS) {
    json = `${json.slice(0, TOOL_RESULT_MAX_CHARS)}…(resultado truncado, refiná la búsqueda)`;
  }
  return { content: json, isError: false };
}

export function fail(error: string, detalle?: string): DispatchToolResult {
  return {
    content: JSON.stringify(detalle ? { error, detalle } : { error }),
    isError: true,
  };
}
