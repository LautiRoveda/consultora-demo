'use client';

import type { FormEvent, KeyboardEvent } from 'react';
import { Bot, Loader2, Send, Square, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { EPP_CHAT_MAX_HISTORY_MESSAGES } from '@/app/api/asistente/schema';
import { parseSseStream } from '@/shared/ai/sse-client';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Markdown } from '@/shared/ui/markdown';
import { Textarea } from '@/shared/ui/textarea';

import { persistChatTurnAction } from './actions';
import { type Turn } from './schema';
import { toolLabel } from './tool-labels';

/**
 * T-117 · Chat del asistente IA de EPP (client).
 *
 * El turno en curso vive en memoria del componente y el historial se manda en cada
 * POST a `/api/asistente` (capeado a EPP_CHAT_MAX_HISTORY_MESSAGES).
 *
 * T-126 · Persistencia (Option C). El componente se siembra con `initialMessages`
 * (mensajes de una conversación reabierta) e `initialConversacionId`. Cada turno
 * committeado (done -> answer completo; abort con parcial -> parcial) se guarda vía
 * `persistChatTurnAction` con el contenido EXACTO que se muestra. En error
 * intra-stream / abort sin texto NO se persiste (la UI ya revierte / no muestra
 * respuesta). Best-effort: 1 reintento + toast sutil si falla.
 *
 * T-117-FU3 · Streaming SSE. La respuesta del assistant aparece token por token
 * (eventos `delta`), con chips de estado mientras corren las queries de tools
 * (evento `tool`). Markdown incremental (throttle rAF para no re-parsear por token).
 * Botón "Detener" para cancelar mid-stream (conserva el parcial). Errores: los
 * gates (402/429/401/…) llegan como HTTP `!res.ok`; los errores post-200
 * (rate-limit del SDK, timeout, refusal) como evento SSE `error`.
 */

const SUGGESTIONS = [
  '¿A quién le vence el EPP en los próximos 30 días?',
  '¿Qué EPP se le entregó a Pérez?',
  '¿Cuándo le vence el EPP a Rodríguez?',
];

/** Fallback de flush si rAF pausa (tab en background). En foreground rAF gana. */
const STREAM_FLUSH_FALLBACK_MS = 250;

export function AsistenteChat({
  initialMessages = [],
  initialConversacionId = null,
}: {
  initialMessages?: Turn[];
  initialConversacionId?: string | null;
} = {}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Turn[]>(initialMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  // Texto del answer en progreso (volcado por rAF desde bufferRef) + chip de la
  // tool corriendo. Ambos transitorios: al `done` el texto se commitea a `messages`.
  const [streamingText, setStreamingText] = useState('');
  const [toolChip, setToolChip] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Refs para el throttle del stream + cleanup al unmount. Sin el abort en
  // cleanup, navegar mid-stream filtra el fetch y el SDK sigue gastando tokens.
  const abortRef = useRef<AbortController | null>(null);
  const bufferRef = useRef('');
  const rafIdRef = useRef<number | null>(null);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // T-126 · id de la conversación actual (null = nueva). Ref para leerlo fresco
  // dentro de `send`/`persistTurn` sin re-render; se setea al primer turno persistido.
  const conversacionIdRef = useRef<string | null>(initialConversacionId);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, toolChip, loading]);

  // Cleanup al unmount: abort fetch + cancelar rAF/timeout.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, []);

  function scheduleFlush(): void {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
      setStreamingText(bufferRef.current);
    });
    // Fallback: si la pestaña está en background rAF pausa indefinido.
    if (timeoutIdRef.current === null) {
      timeoutIdRef.current = setTimeout(() => {
        timeoutIdRef.current = null;
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
        }
        setStreamingText(bufferRef.current);
      }, STREAM_FLUSH_FALLBACK_MS);
    }
  }

  function flushAndStopThrottle(): void {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (timeoutIdRef.current !== null) {
      clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    setStreamingText(bufferRef.current);
  }

  function resetStreamUi(): void {
    bufferRef.current = '';
    flushAndStopThrottle(); // setStreamingText('')
    setToolChip(null);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const prev = messages;
    const next: Turn[] = [...prev, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setLoading(true);
    bufferRef.current = '';
    setStreamingText('');
    setToolChip(null);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        // T-126 R7: capeamos el historial al límite del route (Zod). Reabrir una
        // conversación con >20 mensajes y enviar excedería el cap -> 400 -> revert.
        // La persistencia es turno-a-turno, no la afecta este recorte de contexto.
        body: JSON.stringify({ messages: next.slice(-EPP_CHAT_MAX_HISTORY_MESSAGES) }),
        signal: ac.signal,
      });

      // Error pre-stream (4xx/5xx con JSON body). Después del 200 el body es SSE.
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        handleErrorCode(body.code, body.message, res.status);
        setMessages(prev);
        setInput(trimmed);
        return;
      }
      if (!res.body) {
        toast.error('Error de red', { description: 'Respuesta sin cuerpo. Reintentá.' });
        setMessages(prev);
        setInput(trimmed);
        return;
      }

      let errored: { code: string; message: string } | null = null;
      let answering = false;

      for await (const event of parseSseStream(res.body)) {
        if (event.type === 'tool') {
          // Nueva fase de tools: descartamos cualquier texto de answer en progreso
          // (narración del modelo, si la hubo) y mostramos el chip de estado.
          const { name } = JSON.parse(event.data) as { name: string };
          bufferRef.current = '';
          flushAndStopThrottle();
          setToolChip(toolLabel(name));
          answering = false;
        } else if (event.type === 'delta') {
          const { text } = JSON.parse(event.data) as { text: string };
          if (!answering) {
            answering = true;
            setToolChip(null); // primer delta → terminó la fase de tools
          }
          bufferRef.current += text;
          scheduleFlush();
        } else if (event.type === 'error') {
          errored = JSON.parse(event.data) as { code: string; message: string };
          break;
        } else if (event.type === 'done') {
          break;
        }
        // `stop` y `usage` son telemetría server-side — el cliente los ignora.
      }

      flushAndStopThrottle();

      if (errored) {
        // STREAM_ABORTED (abort server-side) es silencioso: conservamos el parcial.
        if (errored.code === 'STREAM_ABORTED') {
          finalizePartial(next, trimmed);
          return;
        }
        // Resto de errores intra-stream → toast + revertir el turno para reintentar.
        handleErrorCode(errored.code, errored.message);
        setMessages(prev);
        setInput(trimmed);
        resetStreamUi();
        return;
      }

      // Éxito: commit del buffer como turno assistant.
      const answer = bufferRef.current;
      setMessages([...next, { role: 'assistant', content: answer }]);
      bufferRef.current = '';
      setStreamingText('');
      setToolChip(null);
      // T-126: persistimos el turno EXACTO que mostramos (user + answer).
      void persistTurn(trimmed, answer);
    } catch (err) {
      // Abort del usuario (botón Detener) o navegación: conservamos el parcial.
      if (err instanceof DOMException && err.name === 'AbortError') {
        finalizePartial(next, trimmed);
        return;
      }
      toast.error('Error de red', {
        description: 'No pudimos conectar con el asistente. Reintentá.',
      });
      setMessages(prev);
      setInput(trimmed);
      resetStreamUi();
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  /** Cierra un stream cancelado conservando el texto parcial (si lo hay). */
  function finalizePartial(next: Turn[], userText: string): void {
    const partial = bufferRef.current;
    if (partial.trim()) {
      setMessages([...next, { role: 'assistant', content: partial }]);
      // T-126: el parcial mostrado se persiste igual que un answer completo.
      void persistTurn(userText, partial);
    }
    bufferRef.current = '';
    setStreamingText('');
    setToolChip(null);
  }

  /**
   * T-126 · Persiste un turno (user + assistant) vía server action, en los puntos
   * de commit del cliente. Best-effort: 1 reintento, toast sutil si falla (sin
   * revertir lo mostrado). Al crear una conversación nueva, sincroniza la URL
   * (`?c=<id>`) y refresca el sidebar.
   */
  async function persistTurn(userText: string, assistantText: string): Promise<void> {
    const assistant = assistantText.trim();
    if (!assistant) return; // nada que guardar (no debería pasar: se llama con texto)

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await persistChatTurnAction({
          conversacionId: conversacionIdRef.current,
          userMessage: userText,
          assistantMessage: assistant,
        });
        if (res.ok) {
          const wasNew = conversacionIdRef.current === null;
          conversacionIdRef.current = res.conversacionId;
          if (wasNew) {
            // URL reload-safe + sidebar con la conversación nueva. El remount por
            // cambio de `key` re-hidrata desde la DB (mismo contenido) -> imperceptible.
            router.replace(`/asistente?c=${res.conversacionId}`, { scroll: false });
            router.refresh();
          }
          return;
        }
      } catch {
        // Reintenta una vez (fallo de red transitorio).
      }
    }
    toast.error('No se pudo guardar', {
      description: 'El mensaje se mostró pero no quedó guardado. Reintentá más tarde.',
    });
  }

  function stop(): void {
    abortRef.current?.abort();
  }

  function handleErrorCode(code: string | undefined, message?: string, status?: number) {
    switch (code) {
      case 'BILLING_GATED':
        toast.error('Suscripción inactiva', {
          description: message ?? 'Renová tu plan para usar la IA.',
        });
        return;
      case 'RATE_LIMITED':
        toast.error('Demasiadas consultas', {
          description: message ?? 'Esperá un minuto y reintentá.',
        });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida');
        router.push('/login');
        return;
      case 'CONTENT_FILTER':
        toast.error('No pude responder eso', {
          description: message ?? 'Probá reformular la pregunta.',
        });
        return;
      default:
        toast.error('No se pudo responder', {
          description: message ?? (status ? `Error ${status}.` : undefined),
        });
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  const isEmpty = messages.length === 0;
  // Indicador "Pensando…" sólo en el hueco inicial (antes del primer tool/delta).
  const showThinking = loading && toolChip === null && streamingText === '';

  return (
    <div className="flex flex-col gap-4">
      <div className="min-h-[320px] space-y-4 rounded-md border p-4" aria-busy={loading}>
        {isEmpty && !loading && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Probá con una de estas preguntas o escribí la tuya:
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-start text-left"
                  onClick={() => void send(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Turnos confirmados: región live polite → cada turno nuevo se anuncia
            UNA vez (no token por token). El preview en progreso queda afuera. */}
        <div className="space-y-4" aria-live="polite">
          {messages.map((m, i) => (
            <MessageBubble key={i} role={m.role} content={m.content} />
          ))}
        </div>

        {/* Preview en progreso (fuera de la región live para no spamear al SR). */}
        {streamingText !== '' && <MessageBubble role="assistant" content={streamingText} />}

        {toolChip !== null && <ToolStatus label={toolChip} />}

        {showThinking && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Pensando…
          </div>
        )}

        <div ref={endRef} />
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2">
        <label htmlFor="asistente-input" className="sr-only">
          Escribí tu pregunta
        </label>
        <Textarea
          id="asistente-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Escribí tu pregunta… (Enter para enviar, Shift+Enter para salto de línea)"
          rows={2}
          maxLength={2000}
          disabled={loading}
          className="resize-none"
        />
        {loading ? (
          <Button type="button" variant="outline" size="icon" onClick={stop}>
            <Square className="h-4 w-4" aria-hidden />
            <span className="sr-only">Detener</span>
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={input.trim().length === 0}>
            <Send className="h-4 w-4" aria-hidden />
            <span className="sr-only">Enviar</span>
          </Button>
        )}
      </form>
    </div>
  );
}

function MessageBubble({ role, content }: { role: Turn['role']; content: string }) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
        )}
        aria-hidden
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          'max-w-[80%] rounded-md px-3 py-2 text-sm',
          isUser ? 'bg-primary text-primary-foreground whitespace-pre-wrap' : 'bg-muted',
        )}
      >
        {isUser ? content : <Markdown content={content} />}
      </div>
    </div>
  );
}

function ToolStatus({ label }: { label: string }) {
  return (
    <div className="flex gap-3">
      <div
        className="bg-muted text-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
        aria-hidden
      >
        <Bot className="h-4 w-4" />
      </div>
      <div className="bg-muted text-muted-foreground flex items-center gap-2 rounded-md px-3 py-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        {label}
      </div>
    </div>
  );
}
