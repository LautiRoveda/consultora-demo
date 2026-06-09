/**
 * T-117-FU3 · Tests del cliente del chat del asistente EPP (streaming SSE).
 *
 * jsdom + @testing-library. `fetch` mockeado devuelve un `Response`-like con
 * `body` = ReadableStream de bytes SSE. rAF stubeado SÍNCRONO → los flushes del
 * throttle son deterministas (cada delta se refleja al instante). next/navigation
 * y sonner mockeados.
 *
 * Cubre: render inicial, submit + acumulación de deltas + render markdown, chip de
 * tool, descarte de narración previa a un `tool`, error pre-stream (402/401),
 * error intra-stream (RATE_LIMITED), STREAM_ABORTED conserva el parcial, y el
 * botón Detener.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AsistenteChat } from '@/app/(app)/asistente/asistente-client';

const { pushMock, replaceMock, refreshMock, toastErrorMock, persistMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  persistMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock, refresh: refreshMock, back: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastErrorMock, info: vi.fn(), warning: vi.fn() },
}));

// T-126 · el chat persiste cada turno vía server action — la mockeamos (es
// 'use server' + server-only; el cliente sólo consume su resultado).
vi.mock('@/app/(app)/asistente/actions', () => ({
  persistChatTurnAction: persistMock,
  archiveChatConversacionAction: vi.fn(),
}));

const SUGGESTION = '¿Qué EPP se le entregó a Pérez?';

function sseChunk(type: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Response-like con un stream SSE ya completo (todos los eventos + close). */
function sseResponse(events: Array<[string, unknown]>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [type, data] of events) controller.enqueue(sseChunk(type, data));
      controller.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

/** Response-like con un stream SSE controlado a mano (push/close). */
function controlledSse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    res: { ok: true, status: 200, body } as unknown as Response,
    push: (type: string, data: unknown) => controller.enqueue(sseChunk(type, data)),
    close: () => controller.close(),
  };
}

function errorResponse(status: number, body: { code: string; message?: string }): Response {
  return { ok: false, status, json: () => Promise.resolve(body) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  persistMock.mockResolvedValue({ ok: true, conversacionId: 'conv-default' });
  // rAF síncrono → el flush del throttle ocurre al instante (test determinista).
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('AsistenteChat (streaming)', () => {
  it('render inicial: sugerencias + Enviar deshabilitado con input vacío', () => {
    render(<AsistenteChat />);
    expect(screen.getByText(SUGGESTION)).toBeInTheDocument();
    expect(
      screen.getByText('¿A quién le vence el EPP en los próximos 30 días?'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
  });

  it('submit por sugerencia: POST /api/asistente + render markdown del answer', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ['tool', { name: 'epp_entregado_a_empleado' }],
        ['delta', { text: 'A Pérez se le entregó un ' }],
        ['delta', { text: '**casco**.' }],
        ['stop', { reason: 'end_turn' }],
        ['usage', { inputTokens: 10, outputTokens: 5 }],
        ['done', {}],
      ]),
    );

    const { container } = render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/asistente',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // El body lleva el historial con el turno del usuario.
    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(sentBody.messages.at(-1)).toEqual({ role: 'user', content: SUGGESTION });

    // Answer renderizado con markdown (negrita), no crudo.
    await waitFor(() => expect(container.querySelector('strong')?.textContent).toBe('casco'));
    expect(container.textContent).not.toContain('**casco**');
  });

  it('muestra el chip de tool y lo oculta al llegar el answer', async () => {
    const stream = controlledSse();
    fetchMock.mockResolvedValueOnce(stream.res);

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    stream.push('tool', { name: 'buscar_empleado' });
    await waitFor(() => expect(screen.getByText('Buscando empleado…')).toBeInTheDocument());

    stream.push('delta', { text: 'Listo.' });
    stream.push('done', {});
    stream.close();

    await waitFor(() => expect(screen.queryByText('Buscando empleado…')).not.toBeInTheDocument());
    expect(screen.getByText('Listo.')).toBeInTheDocument();
  });

  it('descarta el texto previo a un evento tool (narración del modelo)', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ['delta', { text: 'Voy a fijarme...' }],
        ['tool', { name: 'buscar_empleado' }],
        ['delta', { text: 'Pérez tiene casco.' }],
        ['done', {}],
      ]),
    );

    const { container } = render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() => expect(screen.getByText('Pérez tiene casco.')).toBeInTheDocument());
    expect(container.textContent).not.toContain('Voy a fijarme');
  });

  it('error pre-stream 402 → toast y revierte el turno', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(402, { code: 'BILLING_GATED', message: 'Renová tu plan.' }),
    );

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Suscripción inactiva', expect.anything()),
    );
    // Revertido → vuelven las sugerencias (historial vacío otra vez).
    await waitFor(() =>
      expect(
        screen.getByText('¿A quién le vence el EPP en los próximos 30 días?'),
      ).toBeInTheDocument(),
    );
  });

  it('error pre-stream 401 → toast + redirect a /login', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, { code: 'UNAUTHENTICATED' }));

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/login'));
  });

  it('error intra-stream (SSE error RATE_LIMITED) → toast y revierte', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ['delta', { text: 'parcial' }],
        ['error', { code: 'RATE_LIMITED', message: 'La IA está saturada.' }],
      ]),
    );

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Demasiadas consultas', expect.anything()),
    );
    expect(screen.queryByText('parcial')).not.toBeInTheDocument();
  });

  it('STREAM_ABORTED conserva el texto parcial como turno assistant (sin toast)', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ['delta', { text: 'respuesta parcial' }],
        ['error', { code: 'STREAM_ABORTED', message: 'Generación cancelada.' }],
      ]),
    );

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() => expect(screen.getByText('respuesta parcial')).toBeInTheDocument());
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('muestra Detener durante el stream y aborta al click', async () => {
    const stream = controlledSse();
    fetchMock.mockResolvedValueOnce(stream.res);
    const abortSpy = vi.spyOn(AbortController.prototype, 'abort');

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    const detener = await screen.findByRole('button', { name: 'Detener' });
    expect(screen.queryByRole('button', { name: 'Enviar' })).not.toBeInTheDocument();

    fireEvent.click(detener);
    expect(abortSpy).toHaveBeenCalled();

    stream.close();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Detener' })).not.toBeInTheDocument(),
    );
    abortSpy.mockRestore();
  });
});

describe('AsistenteChat · persistencia (T-126)', () => {
  it('persiste el turno al done y, si es conversación nueva, sincroniza URL + refresh', async () => {
    persistMock.mockResolvedValueOnce({ ok: true, conversacionId: 'conv-1' });
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ['delta', { text: 'Hola, ' }],
        ['delta', { text: 'mundo.' }],
        ['done', {}],
      ]),
    );

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() => expect(persistMock).toHaveBeenCalledTimes(1));
    expect(persistMock).toHaveBeenCalledWith({
      conversacionId: null,
      userMessage: SUGGESTION,
      assistantMessage: 'Hola, mundo.',
    });
    // Conversación nueva → URL reload-safe + sidebar refrescado.
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith('/asistente?c=conv-1', { scroll: false }),
    );
    expect(refreshMock).toHaveBeenCalled();
  });

  it('persiste el texto parcial en STREAM_ABORTED', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ['delta', { text: 'respuesta parcial' }],
        ['error', { code: 'STREAM_ABORTED', message: 'Generación cancelada.' }],
      ]),
    );

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() =>
      expect(persistMock).toHaveBeenCalledWith({
        conversacionId: null,
        userMessage: SUGGESTION,
        assistantMessage: 'respuesta parcial',
      }),
    );
  });

  it('NO persiste en error intra-stream (RATE_LIMITED): la UI revierte', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ['delta', { text: 'parcial' }],
        ['error', { code: 'RATE_LIMITED', message: 'saturada' }],
      ]),
    );

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Demasiadas consultas', expect.anything()),
    );
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('NO persiste en gate pre-stream (402)', async () => {
    fetchMock.mockResolvedValueOnce(
      errorResponse(402, { code: 'BILLING_GATED', message: 'Renová tu plan.' }),
    );

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('NO persiste en abort sin texto (no hubo answer)', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([['error', { code: 'STREAM_ABORTED', message: 'Generación cancelada.' }]]),
    );

    render(<AsistenteChat />);
    fireEvent.click(screen.getByText(SUGGESTION));

    // El stream se consumió y loading terminó (vuelve el botón Enviar).
    await screen.findByRole('button', { name: 'Enviar' });
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('siembra initialMessages y reusa initialConversacionId (sin tocar la URL)', async () => {
    persistMock.mockResolvedValueOnce({ ok: true, conversacionId: 'conv-existing' });
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        ['delta', { text: 'ok' }],
        ['done', {}],
      ]),
    );

    render(
      <AsistenteChat
        initialConversacionId="conv-existing"
        initialMessages={[
          { role: 'user', content: 'pregunta previa' },
          { role: 'assistant', content: 'respuesta previa' },
        ]}
      />,
    );
    // Mensajes sembrados desde la conversación reabierta.
    expect(screen.getByText('respuesta previa')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Escribí tu pregunta'), {
      target: { value: 'nueva pregunta' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    await waitFor(() =>
      expect(persistMock).toHaveBeenCalledWith({
        conversacionId: 'conv-existing',
        userMessage: 'nueva pregunta',
        assistantMessage: 'ok',
      }),
    );
    // Conversación ya existente → no se reescribe la URL.
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
