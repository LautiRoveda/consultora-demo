import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';

import { getAnthropicClient } from './anthropic';
import { dispatchTool, EPP_CHAT_TOOLS } from './epp-chat-tools';
import {
  buildEppChatSystemPrompt,
  EPP_CHAT_FALLBACK_CAP,
  EPP_CHAT_FALLBACK_NO_TEXT,
  EPP_CHAT_MAX_ITERATIONS,
  EPP_CHAT_MAX_TOKENS,
} from './prompts/epp-chat';

/**
 * T-117 · `runEppChat` — orquesta el asistente IA contextual de EPP.
 *
 * Loop multi-turno con tool-calling NO forzado sobre las 4 tools sólo-lectura de
 * `epp-chat-tools`. Cada iteración:
 *  1. `messages.create` con tools + `tool_choice: auto` (el modelo decide).
 *  2. Si `stop_reason === 'tool_use'`: corre el dispatcher por cada bloque, arma
 *     los `tool_result` y sigue. Si no: junta el texto y devuelve.
 *  3. Corta en `EPP_CHAT_MAX_ITERATIONS` → fallback (no 500).
 *
 * Acumula tokens de TODAS las iteraciones y loguea structured (tokens + cost_usd),
 * mismo criterio que `epp-suggest`. Errores del SDK NO se swallowean — se propagan
 * al try/catch del route (→ 500, o 429 si RateLimitError).
 *
 * Auth/consultora/billing/rate-limit los resuelve el route ANTES de llamar acá;
 * este módulo no sabe de HTTP.
 */

// Haiku 4.5 pricing (USD por 1M tokens) — mismo criterio que epp-suggest.
const HAIKU_INPUT_PRICE_PER_M = 1.0;
const HAIKU_OUTPUT_PRICE_PER_M = 5.0;

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type ChatTokens = { input: number; output: number; cost_usd: number };

export type ChatResult =
  | { kind: 'ok'; answer: string; iterations: number; tokens: ChatTokens; model: string }
  | {
      kind: 'iteration_cap_reached';
      answer: string;
      iterations: number;
      tokens: ChatTokens;
      model: string;
    };

function toTokens(input: number, output: number): ChatTokens {
  return {
    input,
    output,
    cost_usd:
      (input / 1_000_000) * HAIKU_INPUT_PRICE_PER_M +
      (output / 1_000_000) * HAIKU_OUTPUT_PRICE_PER_M,
  };
}

export async function runEppChat(args: {
  messages: ChatTurn[];
  consultoraId: string;
  supabase: SupabaseClient<Database>;
}): Promise<ChatResult> {
  const { messages: history, consultoraId, supabase } = args;

  const model = env.ANTHROPIC_CHAT_MODEL;
  const client = getAnthropicClient();
  // Cast del tool schema: lo declaramos `as const` (literals para los tests) pero
  // el SDK exige `Tool[]` mutable. El runtime es idéntico (mismo patrón epp-suggest).
  const tools = EPP_CHAT_TOOLS as unknown as Anthropic.Tool[];
  // System prompt con la fecha de hoy (TZ AR) → el modelo razona plazos (FU1).
  const system = buildEppChatSystemPrompt(new Date());

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let tokensInput = 0;
  let tokensOutput = 0;
  let toolCalls = 0;
  const t0 = Date.now();

  for (let iteration = 1; iteration <= EPP_CHAT_MAX_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model,
      max_tokens: EPP_CHAT_MAX_TOKENS,
      system,
      messages,
      tools,
      // `auto` (no forzado) → el modelo PUEDE cerrar con end_turn. `disable_parallel`
      // → a lo sumo 1 tool por turno (loop trivialmente correcto + caps predecibles).
      // NO copiar el tool_choice forzado de epp-suggest: haría imposible el end_turn.
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    });
    tokensInput += response.usage.input_tokens;
    tokensOutput += response.usage.output_tokens;

    if (response.stop_reason === 'tool_use') {
      // Append del turno assistant VERBATIM (bloques tool_use con su id + texto
      // previo si lo hay) — requisito de la API para continuar la conversación.
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        toolCalls += 1;
        const result = await dispatchTool({
          name: block.name,
          input: block.input,
          supabase,
          consultoraId,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        });
      }
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // end_turn | max_tokens | refusal | … → devolvemos el texto final.
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const tokens = toTokens(tokensInput, tokensOutput);
    logger.info(
      {
        consultoraId,
        model,
        iterations: iteration,
        toolCalls,
        stopReason: response.stop_reason,
        tokens_input: tokens.input,
        tokens_output: tokens.output,
        cost_usd: tokens.cost_usd,
        ms: Date.now() - t0,
      },
      'epp_chat_answered',
    );
    return {
      kind: 'ok',
      answer: text || EPP_CHAT_FALLBACK_NO_TEXT,
      iterations: iteration,
      tokens,
      model,
    };
  }

  // Cap de iteraciones alcanzado sin que el modelo cierre con end_turn.
  const tokens = toTokens(tokensInput, tokensOutput);
  logger.warn(
    {
      consultoraId,
      model,
      iterations: EPP_CHAT_MAX_ITERATIONS,
      toolCalls,
      tokens_input: tokens.input,
      tokens_output: tokens.output,
      cost_usd: tokens.cost_usd,
      ms: Date.now() - t0,
    },
    'epp_chat_iteration_cap_reached',
  );
  return {
    kind: 'iteration_cap_reached',
    answer: EPP_CHAT_FALLBACK_CAP,
    iterations: EPP_CHAT_MAX_ITERATIONS,
    tokens,
    model,
  };
}
