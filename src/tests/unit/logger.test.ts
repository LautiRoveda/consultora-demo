import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '@/shared/observability/logger';

// `logger.ts` empieza con `import 'server-only'`. En Node (Vitest unit) el
// paquete tira si lo importan; el mock lo neutraliza. Vitest hoist `vi.mock`
// al tope automáticamente, aunque visualmente quede después de los imports.
vi.mock('server-only', () => ({}));

// Mock de @sentry/nextjs — queremos asertar que el wrapper llama a captureX,
// no que el SDK real envíe nada al servidor.
const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
}));

describe('logger', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear();
    captureMessageMock.mockClear();
  });

  it('logger.error(Error) llama Sentry.captureException con el error', () => {
    const err = new Error('boom');
    logger.error(err);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(captureExceptionMock).toHaveBeenCalledWith(err, undefined);
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it('logger.error(Error, msg) pasa el msg como extra', () => {
    const err = new Error('boom');
    logger.error(err, 'contexto adicional');
    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(captureExceptionMock).toHaveBeenCalledWith(err, {
      extra: { msg: 'contexto adicional' },
    });
  });

  it('logger.error(string) llama Sentry.captureMessage como error', () => {
    logger.error('mensaje literal');
    expect(captureMessageMock).toHaveBeenCalledOnce();
    expect(captureMessageMock).toHaveBeenCalledWith('mensaje literal', 'error');
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('logger.error({ context }, msg) llama captureMessage con contexto', () => {
    logger.error({ requestId: 'abc' }, 'fallo en handler');
    expect(captureMessageMock).toHaveBeenCalledOnce();
    expect(captureMessageMock).toHaveBeenCalledWith('fallo en handler', {
      level: 'error',
      extra: { context: { requestId: 'abc' } },
    });
  });

  it('logger.fatal(Error) también captura en Sentry', () => {
    const err = new Error('catastrophic');
    logger.fatal(err);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
    expect(captureExceptionMock).toHaveBeenCalledWith(err, undefined);
  });

  it('logger.info NO llama a Sentry', () => {
    logger.info('hola');
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it('logger.warn NO llama a Sentry', () => {
    logger.warn('algo raro');
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });

  it('logger.debug NO llama a Sentry', () => {
    logger.debug({ step: 1 }, 'arrancando');
    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(captureMessageMock).not.toHaveBeenCalled();
  });
});
