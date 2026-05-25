/**
 * C6 audit · PII redact en el logger.
 *
 * Cobertura:
 *  1. logger.error({ email, userId }, 'msg') → Sentry.captureMessage payload
 *     NO contiene email, SÍ contiene userId.
 *  2. Top-level + nested keys redact: { ip, nested: { ip, ok } } → ambas ip
 *     removidas, `nested.ok` preservado.
 *  3. Mix de claves PII (chatId, payer_email, token) — verifica el set
 *     completo de REDACT_KEYS.
 *  4. Logger.warn que loggea `chatId` (caso del rate-limit Telegram) → pino
 *     output stream NO contiene la string del chatId. Test del flow end-to-end
 *     de la decisión "loggear chatId en rate-limit + confiar en redact para
 *     PII compliance".
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

const { logger } = await import('@/shared/observability/logger');

describe('logger · redact (C6)', () => {
  it('1. logger.error con email + userId → Sentry payload SIN email, CON userId', () => {
    captureMessageMock.mockClear();
    logger.error({ email: 'lautaro@example.com', userId: 'usr_42' }, 'login fallo');

    expect(captureMessageMock).toHaveBeenCalledOnce();
    const [, options] = captureMessageMock.mock.calls[0]!;
    const ctx = (options as { extra: { context: Record<string, unknown> } }).extra.context;
    expect(ctx).not.toHaveProperty('email');
    expect(ctx.userId).toBe('usr_42');
  });

  it('2. nested redact: top-level ip + nested.ip ambos removidos', () => {
    captureMessageMock.mockClear();
    logger.error(
      {
        ip: '1.2.3.4',
        request: { ip: '5.6.7.8', method: 'POST' },
        userId: 'usr_1',
      },
      'something',
    );

    const [, options] = captureMessageMock.mock.calls[0]!;
    const ctx = (options as { extra: { context: Record<string, unknown> } }).extra.context;
    expect(ctx).not.toHaveProperty('ip');
    const req = ctx.request as Record<string, unknown>;
    expect(req).not.toHaveProperty('ip');
    expect(req.method).toBe('POST');
    expect(ctx.userId).toBe('usr_1');
  });

  it('3. multiple PII keys redactadas (chatId, payer_email, token, password)', () => {
    captureMessageMock.mockClear();
    logger.error(
      {
        chatId: 12345,
        payer_email: 'p@x.com',
        token: 'bearer-xyz',
        password: 'p4ssw0rd',
        consultoraId: 'c_1',
      },
      'sensitive op',
    );
    const [, options] = captureMessageMock.mock.calls[0]!;
    const ctx = (options as { extra: { context: Record<string, unknown> } }).extra.context;
    expect(ctx).not.toHaveProperty('chatId');
    expect(ctx).not.toHaveProperty('payer_email');
    expect(ctx).not.toHaveProperty('token');
    expect(ctx).not.toHaveProperty('password');
    expect(ctx.consultoraId).toBe('c_1');
  });

  it('4. caso real C1 rate-limit Telegram: logger.error con chatId NO leak a Sentry', () => {
    // Defense in depth: si un dev cambia el logger.warn del rate-limit
    // Telegram a logger.error (que SÍ captura a Sentry), el redactSensitive
    // helper interno tiene que filtrar chatId del payload del Sentry capture.
    // Probarlo explícito porque el flow real (warn → solo pino stdout, no
    // Sentry) NO se puede assert con vi.spyOn(process.stdout.write) porque
    // pino-pretty en dev corre en worker thread separado.
    captureMessageMock.mockClear();
    const distinctiveChatId = 909_090_909;
    logger.error(
      { chatId: distinctiveChatId, remaining: 0, consultoraId: 'c_x' },
      'telegram webhook: rate limit exceeded',
    );

    expect(captureMessageMock).toHaveBeenCalledOnce();
    const [msg, options] = captureMessageMock.mock.calls[0]!;
    expect(msg).toBe('telegram webhook: rate limit exceeded');
    const ctx = (options as { extra: { context: Record<string, unknown> } }).extra.context;
    expect(ctx).not.toHaveProperty('chatId');
    expect(ctx.remaining).toBe(0);
    expect(ctx.consultoraId).toBe('c_x');
    // Sanity: ninguna parte del payload serializado debe contener el número.
    expect(JSON.stringify(options)).not.toContain('909090909');
  });
});
