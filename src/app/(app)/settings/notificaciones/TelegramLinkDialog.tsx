'use client';

import { ExternalLink, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';

import { generateTelegramLinkCodeAction } from './telegram-actions';

/**
 * T-033 · Modal para vincular Telegram.
 *
 * State machine:
 *  - loading: generando código vía server action.
 *  - code_ready: muestra el código + deep-link "Abrir Telegram" + spinner
 *    "Esperando confirmación...". Polling a /api/telegram/status cada 3s
 *    detecta cuando user completó /start (state=linked).
 *  - linked: transient antes de cerrar (1.5s) → llama onLinked() + cierra.
 *  - error: muestra mensaje + botón "Reintentar".
 *  - timeout: tras 5 min sin completar → "Generá uno nuevo" botón.
 *
 * Cleanup garantizado en 3 places:
 *  1. useEffect del polling: clearInterval + abort en unmount.
 *  2. useEffect que watch del `open` prop: aborta si dialog se cierra.
 *  3. Cleanup al transición a estado terminal (linked/timeout/error).
 */

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_DURATION_MS = 5 * 60_000; // 5 min
const MAX_TICKS = Math.floor(MAX_POLL_DURATION_MS / POLL_INTERVAL_MS); // 100

type DialogState =
  | { kind: 'loading' }
  | { kind: 'code_ready'; code: string; deepLink: string; expiresAt: string }
  | { kind: 'linked'; username: string | null }
  | { kind: 'error'; message: string }
  | { kind: 'timeout' };

type StatusResponse =
  | { state: 'unlinked' }
  | { state: 'pending'; expiresAt: string }
  | { state: 'linked'; username: string | null; since: string; blocked: boolean }
  | { state: 'unauthenticated' };

export function TelegramLinkDialog({
  open,
  onOpenChange,
  onLinked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked: () => void;
}) {
  const [state, setState] = useState<DialogState>({ kind: 'loading' });
  const abortRef = useRef<AbortController | null>(null);
  const tickCountRef = useRef(0);

  const startGenerate = useCallback(() => {
    setState({ kind: 'loading' });
    tickCountRef.current = 0;
    void generateTelegramLinkCodeAction().then((res) => {
      if (res.ok) {
        setState({
          kind: 'code_ready',
          code: res.code,
          deepLink: res.deepLink,
          expiresAt: res.expiresAt,
        });
      } else {
        setState({ kind: 'error', message: res.message });
      }
    });
  }, []);

  // Cuando se abre el dialog → generar código.
  // `react-hooks/set-state-in-effect` disabled inline: el state se actualiza
  // SOLO en transición open=false → true (cuando user clickea "Vincular");
  // no genera render loop porque el `if (open)` lo guarda.
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      startGenerate();
    } else if (abortRef.current) {
      // Al cerrar: abortar polling pendiente. Sin setState acá.
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, [open, startGenerate]);

  // Polling cuando state === 'code_ready'.
  useEffect(() => {
    if (state.kind !== 'code_ready') return;

    const controller = new AbortController();
    abortRef.current = controller;

    const intervalId = setInterval(() => {
      tickCountRef.current += 1;
      if (tickCountRef.current >= MAX_TICKS) {
        clearInterval(intervalId);
        setState({ kind: 'timeout' });
        return;
      }

      void fetch('/api/telegram/status', {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: StatusResponse | null) => {
          if (!data) return;
          if (data.state === 'linked') {
            clearInterval(intervalId);
            setState({ kind: 'linked', username: data.username });
            // Auto-close + callback tras 1.5s para que user vea el ✓.
            setTimeout(() => {
              onLinked();
              onOpenChange(false);
            }, 1500);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === 'AbortError') return;
          // Otros errores de fetch: skip tick (sigue intentando).
        });
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      controller.abort();
    };
  }, [state, onLinked, onOpenChange]);

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code).then(
      () => toast.success('Código copiado.'),
      () => toast.error('No pudimos copiar. Copialo a mano.'),
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="telegram-link-dialog">
        <DialogHeader>
          <DialogTitle>Conectá tu Telegram</DialogTitle>
          <DialogDescription>
            Para recibir notificaciones por Telegram, vinculá tu cuenta con el bot.
          </DialogDescription>
        </DialogHeader>

        {state.kind === 'loading' && (
          <div className="flex items-center justify-center py-8" data-testid="dialog-loading">
            <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
          </div>
        )}

        {state.kind === 'code_ready' && (
          <div className="space-y-4" data-testid="dialog-code-ready">
            <ol className="text-muted-foreground space-y-2 text-sm">
              <li>1. Abrí Telegram y buscá nuestro bot.</li>
              <li>
                2. Tocá <strong>Iniciar</strong> o enviá <code>/start {state.code}</code>.
              </li>
              <li>3. Esta ventana se actualiza sola cuando termines.</li>
            </ol>

            <div
              className="bg-muted flex items-center justify-between gap-3 rounded-md p-4"
              data-testid="link-code-display"
            >
              <span className="font-mono text-2xl font-semibold tracking-widest">{state.code}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => copyCode(state.code)}
                data-testid="copy-code-btn"
              >
                Copiar
              </Button>
            </div>

            <Button asChild className="w-full" data-testid="open-telegram-btn">
              <a href={state.deepLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Abrir Telegram
              </a>
            </Button>

            <p
              className="text-muted-foreground flex items-center justify-center gap-2 text-xs"
              data-testid="polling-indicator"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              Esperando confirmación...
            </p>
          </div>
        )}

        {state.kind === 'linked' && (
          <div className="py-8 text-center" data-testid="dialog-linked">
            <p className="text-lg font-semibold text-emerald-600">✅ Conectado!</p>
            {state.username && (
              <p className="text-muted-foreground mt-2 text-sm">@{state.username}</p>
            )}
          </div>
        )}

        {state.kind === 'timeout' && (
          <div className="space-y-3" data-testid="dialog-timeout">
            <Alert>
              <AlertDescription>
                Tardamos demasiado en confirmar. Generá un código nuevo y volvé a intentar.
              </AlertDescription>
            </Alert>
            <Button onClick={startGenerate} data-testid="retry-btn" className="w-full">
              Generar código nuevo
            </Button>
          </div>
        )}

        {state.kind === 'error' && (
          <div className="space-y-3" data-testid="dialog-error">
            <Alert variant="destructive">
              <AlertDescription>{state.message}</AlertDescription>
            </Alert>
            <Button onClick={startGenerate} data-testid="retry-btn" className="w-full">
              Reintentar
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
