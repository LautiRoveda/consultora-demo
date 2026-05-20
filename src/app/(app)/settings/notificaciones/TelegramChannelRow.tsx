'use client';

import { AlertCircle, MessageSquare } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/shared/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/alert-dialog';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';

import { unlinkTelegramAction } from './telegram-actions';
import { TelegramLinkDialog } from './TelegramLinkDialog';

/**
 * T-033 · Row de canal Telegram en Settings.
 *
 * 3 estados:
 *  - unlinked: sin row, o sub.unlinked_at != null, o link_code expirado sin
 *    completar. UI: Badge "No conectado" + botón "Vincular Telegram".
 *  - pending: link_code activo + no linked todavía. UI: Badge "Esperando
 *    vinculación" + botón "Continuar vinculación" (reabre dialog).
 *  - linked: linked_at != null && unlinked_at IS NULL. UI: Badge "Conectado
 *    ✓ @username" + botón "Desvincular" con AlertDialog confirm. Si
 *    blocked_count >= 3 → Alert destructive "Bot bloqueado".
 */

export type TelegramRowState =
  | { kind: 'unlinked' }
  | { kind: 'pending' }
  | { kind: 'linked'; username: string | null; blocked: boolean };

export function TelegramChannelRow({ initialState }: { initialState: TelegramRowState }) {
  const [state, setState] = useState<TelegramRowState>(initialState);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onLinkSuccess() {
    // El dialog ya verificó via polling que el state cambió a 'linked'.
    // Hacemos un fetch del status para obtener username actual + reflejar
    // en la UI sin requerir reload de la página.
    void fetch('/api/telegram/status', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data: { state: string; username?: string | null; blocked?: boolean }) => {
        if (data.state === 'linked') {
          setState({
            kind: 'linked',
            username: data.username ?? null,
            blocked: data.blocked ?? false,
          });
        }
      })
      .catch(() => {
        // Fallback: marcar linked sin username (user puede reload para verlo).
        setState({ kind: 'linked', username: null, blocked: false });
      });
  }

  function handleUnlink() {
    startTransition(async () => {
      const res = await unlinkTelegramAction();
      if (res.ok) {
        toast.success('Telegram desvinculado.');
        setState({ kind: 'unlinked' });
      } else if (res.code === 'UNAUTHENTICATED') {
        toast.error('Tu sesión expiró. Iniciá sesión de nuevo.');
      } else {
        toast.error(res.message);
      }
    });
  }

  return (
    <div
      className="space-y-2 rounded-md border p-3"
      data-testid="row-telegram"
      data-state={state.kind}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <MessageSquare className="text-muted-foreground mt-0.5 h-4 w-4" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Telegram</span>
              {state.kind === 'unlinked' && (
                <Badge variant="secondary" data-testid="telegram-badge-unlinked">
                  No conectado
                </Badge>
              )}
              {state.kind === 'pending' && (
                <Badge data-testid="telegram-badge-pending">Esperando vinculación</Badge>
              )}
              {state.kind === 'linked' && (
                <Badge
                  className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400"
                  data-testid="telegram-badge-linked"
                >
                  Conectado ✓ {state.username ? `@${state.username}` : ''}
                </Badge>
              )}
            </div>
            {state.kind === 'unlinked' && (
              <p className="text-muted-foreground text-xs">
                Vinculá tu cuenta para recibir avisos por el bot.
              </p>
            )}
            {state.kind === 'pending' && (
              <p className="text-muted-foreground text-xs">
                Continuá la vinculación o cancelá para generar un código nuevo.
              </p>
            )}
            {state.kind === 'linked' && (
              <p className="text-muted-foreground text-xs">
                Recibís recordatorios al chat con el bot.
              </p>
            )}
          </div>
        </div>

        {state.kind !== 'linked' ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setLinkDialogOpen(true)}
            data-testid="telegram-link-btn"
          >
            {state.kind === 'pending' ? 'Continuar' : 'Vincular Telegram'}
          </Button>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                data-testid="telegram-unlink-btn"
              >
                Desvincular
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Desvincular Telegram?</AlertDialogTitle>
                <AlertDialogDescription>
                  Vas a dejar de recibir notificaciones en el bot. Podés volver a vincular generando
                  un código nuevo desde acá.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleUnlink} data-testid="telegram-unlink-confirm">
                  Sí, desvincular
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {state.kind === 'linked' && state.blocked && (
        <Alert variant="destructive" data-testid="telegram-blocked-alert">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Tu bot fue bloqueado en Telegram. Regenerá la vinculación para volver a recibir.
          </AlertDescription>
        </Alert>
      )}

      <TelegramLinkDialog
        open={linkDialogOpen}
        onOpenChange={setLinkDialogOpen}
        onLinked={onLinkSuccess}
      />
    </div>
  );
}
