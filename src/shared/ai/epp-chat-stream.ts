import 'server-only';

import type { ChatTurn } from '@/shared/ai/epp-chat';
import type { SseStreamEvent } from '@/shared/ai/sse-encode';
import type { Database } from '@/shared/supabase/types';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/env';
import { getAnthropicClient } from '@/shared/ai/anthropic';
import { toTokens } from '@/shared/ai/epp-chat';
import {
  buildEppChatSystemPrompt,
  EPP_CHAT_FALLBACK_CAP,
  EPP_CHAT_FALLBACK_NO_TEXT,
  EPP_CHAT_MAX_ITERATIONS,
  EPP_CHAT_MAX_TOKENS,
} from '@/shared/ai/prompts/epp-chat';
import { encodeSseEvent, isAbortError, mapAnthropicError } from '@/shared/ai/sse-encode';
import { CHAT_TOOLS, dispatchTool } from '@/shared/ai/tools/registry';
import { logger } from '@/shared/observability/logger';

/**
 * T-117-FU3 · `streamEppChat` — orquestador de streaming SSE tool-aware del
 * asistente IA de EPP. Reemplaza el path productivo de `runEppChat` (T-117), que
 * devolvia la respuesta entera.
 *
 * Mismo loop de tools que `runEppChat` (Haiku 4.5, tool_choice auto, hasta
 * `EPP_CHAT_MAX_ITERATIONS`), pero con `messages.stream()` por turno:
 *  - Itera los raw events del SDK para emitir, en vivo:
 *      · `tool {name}`  al `content_block_start` de un `tool_use` (chip de estado).
 *      · `delta {text}` por cada `text_delta` (el answer final, token por token).
 *  - Al cerrar el turno, `stream.finalMessage()` ensambla el Message (bloques
 *    tool_use con `input` ya parseado + `stop_reason` + `usage`). Eso permite
 *    reusar el dispatch de tools VERBATIM (mismo `messages.push` con los ids que
 *    la API exige) sin reimplementar el acumulador de `input_json_delta`.
 *  - Turno final → `stop` / `usage` / `done`. Cap de iteraciones → `delta`
 *    (fallback) + `stop` (`iteration_cap_reached`) + `usage` + `done`.
 *
 * Contrato de errores: los gates (auth/billing/rate-limit local) corren ANTES en
 * el route → HTTP status. Todo lo que falla DESPUES del HTTP 200 (rate-limit del
 * SDK, timeout, refusal, abort) viaja como evento SSE `error`. El wrapper NUNCA
 * tira: traduce y cierra.
 *
 * Supresion de narracion: el server forwardea `text_delta` en vivo, pero los
 * turnos de tool del prompt actual son puro `tool_use` (sin texto). Como garantia
 * (el system prompt es fuera de scope), el cliente descarta cualquier texto
 * recibido antes de un evento `tool`. Asi el usuario nunca ve narracion del
 * modelo, solo el chip de estado + la respuesta final.
 */
export function streamEppChat(args: {
  messages: ChatTurn[];
  consultoraId: string;
  userId: string;
  supabase: SupabaseClient<Database>;
  signal: AbortSignal;
}): ReadableStream<Uint8Array> {
  const { messages: history, consultoraId, userId, supabase, signal } = args;

  const model = env.ANTHROPIC_CHAT_MODEL;
  // Cast del tool schema: el registry tipa las defs como `ToolDefinition[]` pero el
  // SDK exige `Tool[]`. Runtime identico. `CHAT_TOOLS` agrega TODOS los modulos
  // (EPP + transversales + Checklists) sin que el stream conozca cada modulo.
  const tools = CHAT_TOOLS as unknown as Anthropic.Tool[];
  // System prompt con la fecha de hoy (TZ AR) → el modelo razona plazos.
  const system = buildEppChatSystemPrompt(new Date());

  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const t0 = Date.now();
      let closed = false;
      let tokensInput = 0;
      let tokensOutput = 0;
      let toolCalls = 0;

      function enqueue(ev: SseStreamEvent): void {
        if (closed) return;
        try {
          controller.enqueue(encodeSseEvent(ev));
        } catch {
          // Controller cerrado por el consumer entre el check y el enqueue.
          closed = true;
        }
      }

      function close(): void {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Ya cerrado por el consumer.
        }
      }

      function emitAbort(): void {
        enqueue({ type: 'error', code: 'STREAM_ABORTED', message: 'Generación cancelada.' });
        close();
        logger.info(
          { consultoraId, userId, model, toolCalls, ms: Date.now() - t0 },
          'epp_chat_aborted',
        );
      }

      function emitUsage(): void {
        enqueue({
          type: 'usage',
          usage: {
            inputTokens: tokensInput,
            outputTokens: tokensOutput,
            // El chat no usa prompt caching (sin cache_control en el system).
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        });
      }

      try {
        const client = getAnthropicClient();

        for (let iteration = 1; iteration <= EPP_CHAT_MAX_ITERATIONS; iteration++) {
          // Abort entre turnos (incluye abort mientras corria un dispatchTool).
          if (signal.aborted) {
            emitAbort();
            return;
          }

          const sdkStream = client.messages.stream(
            {
              model,
              max_tokens: EPP_CHAT_MAX_TOKENS,
              system,
              messages,
              tools,
              // `auto` + `disable_parallel` → a lo sumo 1 tool_use por turno y el
              // modelo PUEDE cerrar con end_turn (no copiar el forzado de epp-suggest).
              tool_choice: { type: 'auto', disable_parallel_tool_use: true },
            },
            { signal },
          );

          let sawTextDelta = false;

          for await (const event of sdkStream) {
            if (signal.aborted) break;
            if (event.type === 'content_block_start') {
              if (event.content_block.type === 'tool_use') {
                // El modelo decidio llamar una tool → chip de estado ASAP.
                enqueue({ type: 'tool', name: event.content_block.name });
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta.type === 'text_delta') {
                sawTextDelta = true;
                enqueue({ type: 'delta', text: event.delta.text });
              }
            }
          }

          if (signal.aborted) {
            emitAbort();
            return;
          }

          const finalMsg = await sdkStream.finalMessage();
          tokensInput += finalMsg.usage.input_tokens;
          tokensOutput += finalMsg.usage.output_tokens;

          if (finalMsg.stop_reason === 'tool_use') {
            // Append del turno assistant VERBATIM (bloques tool_use con su id) +
            // dispatch de cada tool — reuso 1:1 del loop de runEppChat.
            messages.push({ role: 'assistant', content: finalMsg.content });

            const toolResults: Anthropic.ToolResultBlockParam[] = [];
            for (const block of finalMsg.content) {
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

          // Turno final (end_turn | max_tokens | refusal | …).
          if (finalMsg.stop_reason === 'refusal') {
            // Mismo mapping que informes (T-020): refusal → CONTENT_FILTER.
            logger.warn({ consultoraId, userId, model }, 'epp_chat_refusal');
            enqueue({
              type: 'error',
              code: 'CONTENT_FILTER',
              message: 'No puedo responder eso. Probá reformular la pregunta.',
            });
            close();
            return;
          }

          // Caso raro: el turno final no emitio texto → fallback explicito para no
          // dejar la burbuja vacia (paridad con EPP_CHAT_FALLBACK_NO_TEXT).
          if (!sawTextDelta) {
            enqueue({ type: 'delta', text: EPP_CHAT_FALLBACK_NO_TEXT });
          }

          const tokens = toTokens(tokensInput, tokensOutput);
          enqueue({ type: 'stop', reason: finalMsg.stop_reason ?? 'end_turn' });
          emitUsage();
          enqueue({ type: 'done' });
          close();

          // Tracking de costo IA (principio #9) — replica el log de runEppChat.
          logger.info(
            {
              consultoraId,
              userId,
              model,
              iterations: iteration,
              toolCalls,
              stopReason: finalMsg.stop_reason,
              tokens_input: tokens.input,
              tokens_output: tokens.output,
              cost_usd: tokens.cost_usd,
              ms: Date.now() - t0,
            },
            'epp_chat_answered',
          );
          return;
        }

        // Cap de iteraciones alcanzado sin que el modelo cierre con end_turn.
        const tokens = toTokens(tokensInput, tokensOutput);
        enqueue({ type: 'delta', text: EPP_CHAT_FALLBACK_CAP });
        enqueue({ type: 'stop', reason: 'iteration_cap_reached' });
        emitUsage();
        enqueue({ type: 'done' });
        close();
        logger.warn(
          {
            consultoraId,
            userId,
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
      } catch (err) {
        // El SDK puede tirar APIUserAbortError al respetar el signal.
        if (signal.aborted || isAbortError(err)) {
          emitAbort();
          return;
        }
        const mapped = mapAnthropicError(err, { consultoraId, userId }, { domain: 'chat' });
        enqueue(mapped);
        close();
      }
    },

    cancel() {
      // El consumer cerro el stream sin esperar `done`. No-op: el loop chequea
      // `signal.aborted` y corta solo.
    },
  });
}
