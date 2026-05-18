import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';

/**
 * T-081 · Rate limiting helper compartido.
 *
 * Wrapper sobre @upstash/ratelimit con 3 garantías:
 *  1. **No-op stub en dev local** sin Upstash configurado (env vars vacías).
 *     Permite testear flujos auth/AI sin crear cuenta Upstash. En producción
 *     las env vars siempre seteadas — ver docs/operations/rate-limiting.md.
 *  2. **Singleton lazy del Redis client** (pool HTTP) + factory por-call para
 *     `Ratelimit` (cheap-to-construct según docs Upstash).
 *  3. **Fail open** si Upstash devuelve error transient: el helper retorna
 *     `success: true` + logger.warn a Sentry. Razón: rate limit es defense in
 *     depth — Supabase Auth tiene throttle interno (30 emails/h free tier),
 *     fail-closed durante outage Upstash rompería login a usuarios legítimos.
 *     Reevaluar split per-endpoint cuando userbase crezca > 1000 (T-081-FU5).
 */

export type RateLimitConfig = {
  /** Stable identifier — Redis key prefix `rl:<identifier>`. */
  identifier: string;
  /** Max requests permitidos en el window. */
  limit: number;
  /**
   * Sliding window — formato @upstash/ratelimit.
   * Ej: `'5 m'` | `'1 h'` | `'15 m'` | `'1 d'`.
   */
  window: `${number} ${'s' | 'm' | 'h' | 'd'}`;
};

export type RateLimitResult = {
  success: boolean;
  /** Requests restantes en el window actual. */
  remaining: number;
  /** Epoch ms cuando el window resetea. */
  reset: number;
  /** Segundos hasta retry. Computed: `max(1, ceil((reset - now) / 1000))`. */
  retryAfterSeconds: number;
};

export type RateLimiter = {
  limit(key: string): Promise<RateLimitResult>;
};

// Singleton lazy del Redis client. El cliente abre socket HTTP con state interno
// (auth, retries) — singleton ahorra connection churn entre invocaciones warm.
let redisClient: Redis | null = null;

function getRedisClient(): Redis | null {
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  if (!redisClient) {
    redisClient = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return redisClient;
}

/**
 * Helper de tests: resetea el singleton entre tests. NO usar en código real.
 */
export function _resetRedisClientForTests(): void {
  redisClient = null;
}

/**
 * No-op limiter — siempre allows. Usado en dev local sin Upstash configurado.
 *
 * Exportado para tests que necesitan mockear con shape conocido.
 */
export const noopRateLimiter: RateLimiter = {
  limit() {
    return Promise.resolve({
      success: true,
      remaining: 999,
      reset: Date.now() + 60_000,
      retryAfterSeconds: 0,
    });
  },
};

/**
 * Factory por-call: devuelve un `RateLimiter` configured contra Upstash, o el
 * `noopRateLimiter` si env vars no presentes (dev local).
 *
 * **Patrón de uso**: declarar el limiter a NIVEL DE MÓDULO (no per-request) en
 * el archivo que lo consume, ej:
 *
 * ```ts
 * const signupIpLimiter = getRateLimiter({ identifier: 'signup-ip', limit: 5, window: '1 h' });
 *
 * export async function signupAction(input: unknown) {
 *   // ...post-Zod parse...
 *   const ip = getClientIpFromHeaders(await headers());
 *   const rl = await signupIpLimiter.limit(ip);
 *   if (!rl.success) {
 *     return { ok: false, code: 'RATE_LIMITED', message: `Reintentá en ${rl.retryAfterSeconds}s.`, retryAfterSeconds: rl.retryAfterSeconds };
 *   }
 *   // ...supabase call...
 * }
 * ```
 */
export function getRateLimiter(config: RateLimitConfig): RateLimiter {
  const redis = getRedisClient();
  if (!redis) {
    return noopRateLimiter;
  }

  const inner = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.limit, config.window),
    prefix: `rl:${config.identifier}`,
    // analytics: false → ahorra requests al free tier 10k/day. Si necesitamos
    // visibility de uso, sumar T-081-FU4 con webhook Upstash → Sentry.
    analytics: false,
  });

  return {
    async limit(key: string): Promise<RateLimitResult> {
      try {
        const result = await inner.limit(key);
        const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
        // FIX-DEBUG T-081 (temporal): diagnóstico de bug productivo con
        // Writes=0 en Upstash. Muestra qué identifier/key se usa + qué devuelve
        // Upstash (success+remaining+reset). REMOVER cuando se identifique
        // root cause + se aplique fix definitivo.
        logger.warn(
          {
            identifier: config.identifier,
            key,
            success: result.success,
            remaining: result.remaining,
            reset: result.reset,
            retryAfterSeconds,
          },
          'rate_limit_check_debug',
        );
        return {
          success: result.success,
          remaining: result.remaining,
          reset: result.reset,
          retryAfterSeconds: result.success ? 0 : retryAfterSeconds,
        };
      } catch (err) {
        // FAIL OPEN: Upstash caído → allow. Log a Sentry para visibility del
        // outage. Decisión MVP — ver doc operativo + T-081-FU5.
        logger.warn(
          { err, identifier: config.identifier, key },
          'rate_limit_check_failed_failing_open',
        );
        return {
          success: true,
          remaining: 999,
          reset: Date.now() + 60_000,
          retryAfterSeconds: 0,
        };
      }
    },
  };
}
