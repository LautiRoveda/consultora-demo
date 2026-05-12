import 'server-only';

import Anthropic from '@anthropic-ai/sdk';

import { env } from '@/env';

/**
 * T-020 · Cliente Anthropic Claude para Server Actions / Route Handlers.
 *
 * **Server-only.** El `server-only` del tope asegura que un Client Component
 * que importe este modulo rompe el build de Next.js. Esto es defensa en
 * profundidad contra leak de `ANTHROPIC_API_KEY` al bundle del cliente.
 *
 * Singleton: el SDK es internamente thread-safe y reusa la conexion keep-alive,
 * asi que una sola instancia por process es ideal. En Vercel serverless cada
 * invocacion arranca un proceso nuevo pero adentro de una request las
 * recargas multiples (RSC + server actions) reusan.
 */
let cachedClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });
  }
  return cachedClient;
}

/**
 * Modelo default del proyecto. Decision arquitectonica fijada en ADR-0003
 * (Sonnet 4.6 por costo/calidad; Opus 4.7 explicitamente rechazado por ser
 * ~67% mas caro, inviable para Plan Pro USD 30).
 *
 * Sonnet 4.6 soporta:
 * - Prompt caching con ephemeral TTL (min 2048 tokens en el prefix).
 * - Adaptive thinking (no usado en T-020 — single-turn generate sin thinking).
 *
 * Si en T-021+ necesitamos tareas mas livianas (clasificacion, validacion
 * de input), evaluar Haiku 4.5 (`claude-haiku-4-5`).
 */
export const CLAUDE_MODEL = 'claude-sonnet-4-6' as const;
