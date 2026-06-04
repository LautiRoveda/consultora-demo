'use client';

import type { FormEvent, KeyboardEvent } from 'react';
import { Bot, Loader2, Send, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Textarea } from '@/shared/ui/textarea';

/**
 * T-117 · Chat del asistente IA de EPP (client).
 *
 * Stateless: el historial vive en memoria del componente y se manda completo en
 * cada POST a `/api/asistente`. MVP sin streaming — la respuesta llega entera tras
 * el loop de tools del servidor. Errores (402/429/401/…) se mapean a toasts.
 */

type Turn = { role: 'user' | 'assistant'; content: string };

const SUGGESTIONS = [
  '¿A quién le vence el EPP en los próximos 30 días?',
  '¿Qué EPP se le entregó a Pérez?',
  '¿Cuándo le vence el EPP a Rodríguez?',
];

export function AsistenteChat() {
  const router = useRouter();
  const [messages, setMessages] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const prev = messages;
    const next: Turn[] = [...prev, { role: 'user', content: trimmed }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/asistente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ messages: next }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        handleErrorCode(body.code, res.status, body.message);
        // Revertimos el turno del usuario para que pueda reintentar limpio.
        setMessages(prev);
        setInput(trimmed);
        return;
      }

      const data = (await res.json()) as { answer: string };
      setMessages([...next, { role: 'assistant', content: data.answer }]);
    } catch {
      toast.error('Error de red', {
        description: 'No pudimos conectar con el asistente. Reintentá.',
      });
      setMessages(prev);
      setInput(trimmed);
    } finally {
      setLoading(false);
    }
  }

  function handleErrorCode(code: string | undefined, status: number, message?: string) {
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
      default:
        toast.error('No se pudo responder', { description: message ?? `Error ${status}.` });
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

  return (
    <div className="flex flex-col gap-4">
      <div
        className="min-h-[320px] space-y-4 rounded-md border p-4"
        aria-live="polite"
        aria-busy={loading}
      >
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

        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} />
        ))}

        {loading && (
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
        <Button type="submit" size="icon" disabled={loading || input.trim().length === 0}>
          <Send className="h-4 w-4" aria-hidden />
          <span className="sr-only">Enviar</span>
        </Button>
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
          'max-w-[80%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
        )}
      >
        {content}
      </div>
    </div>
  );
}
