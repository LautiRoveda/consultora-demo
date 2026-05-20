'use client';

import { AlertCircle, Bell, Smartphone } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { urlBase64ToUint8Array } from '@/shared/push/url-base64';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
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

/**
 * T-034 · Row de canal Web Push en Settings.
 *
 * Estados (state machine, deriva client-side al mount):
 *  - null: loading inicial (skeleton hasta que useEffect resuelva).
 *  - unsupported: browser sin service worker o sin PushManager (Safari iOS pre-PWA,
 *    Firefox sin push, etc). Badge + Alert info.
 *  - permission_denied: Notification.permission === 'denied'. Alert destructive
 *    con instrucción para reactivar desde browser settings.
 *  - not_subscribed: feature soportada + permission default/granted + no hay
 *    subscription para este device. Botón "Activar".
 *  - subscribed: hay subscription en este device. Badge + botón "Desactivar" con
 *    AlertDialog confirm.
 *
 * NOTA importante sobre `initialIsSubscribed`: el server pasa true si el user
 * tiene AL MENOS 1 sub en DB. Pero el `useEffect` valida la presencia de la sub
 * en el DEVICE ACTUAL via `pushManager.getSubscription()`. Es posible que el user
 * tenga 1 sub en otro device (desktop) y 0 en el device actual (mobile) — en
 * ese caso initialIsSubscribed=true pero el state real es not_subscribed.
 * El effect siempre tiene la última palabra.
 */

type PushRowState =
  | { kind: 'unsupported' }
  | { kind: 'permission_denied' }
  | { kind: 'not_subscribed' }
  | { kind: 'subscribed' };

export function PushChannelRow({
  vapidPublicKey,
}: {
  // initialIsSubscribed lo dejamos por hooks futuros — la fuente de verdad
  // del DEVICE actual es siempre el useEffect del mount, no este prop.
  vapidPublicKey: string;
}) {
  const [state, setState] = useState<PushRowState | null>(null);
  const [pending, startTransition] = useTransition();

  // Mount: feature detect + permission + sub lookup del device actual.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (typeof window === 'undefined') return;
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setState({ kind: 'unsupported' });
        return;
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setState({ kind: 'permission_denied' });
        return;
      }

      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (cancelled) return;
        setState(sub ? { kind: 'subscribed' } : { kind: 'not_subscribed' });
      } catch {
        // Edge case: getRegistration/getSubscription pueden rechazar en browsers
        // con SW deshabilitado por user policy. Treat como not_subscribed.
        if (!cancelled) setState({ kind: 'not_subscribed' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function activate(): void {
    startTransition(async () => {
      try {
        // 1. Request permission (browser muestra dialog nativo).
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          setState({ kind: 'permission_denied' });
          toast.error('Permiso de notificaciones denegado.');
          return;
        }

        // 2. SW register (idempotente — re-registro del mismo path es no-op).
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;

        // 3. Push subscribe.
        // Cast a BufferSource: TS strict (noUncheckedIndexedAccess) complica
        // la unión Uint8Array<ArrayBufferLike> vs ArrayBuffer estándar; el
        // browser acepta Uint8Array sin problema (Push API spec).
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        });

        // 4. POST al server.
        const subJson = subscription.toJSON();
        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: subJson.endpoint,
            keys: { p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth },
          }),
        });

        if (!res.ok) {
          // Rollback: unsubscribe local (no quedó persistido server-side).
          await subscription.unsubscribe().catch(() => {});
          toast.error('No se pudo registrar la suscripción.');
          return;
        }

        setState({ kind: 'subscribed' });
        toast.success('Notificaciones del navegador activadas.');
      } catch (err) {
        toast.error('Error activando notificaciones.');
        console.error('[push] subscribe failed', err);
      }
    });
  }

  function deactivate(): void {
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        const endpoint = sub?.endpoint;

        if (sub && endpoint) {
          // 1. Server first: si falla, NO unsubscribe local (consistency).
          const res = await fetch('/api/push/unsubscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
          });
          if (!res.ok) {
            toast.error('No se pudo desactivar la suscripción.');
            return;
          }
          // 2. Local unsubscribe.
          await sub.unsubscribe().catch(() => {});
        }

        setState({ kind: 'not_subscribed' });
        toast.success('Notificaciones desactivadas en este dispositivo.');
      } catch (err) {
        toast.error('Error desactivando notificaciones.');
        console.error('[push] unsubscribe failed', err);
      }
    });
  }

  // Loading.
  if (state === null) {
    return (
      <div
        className="flex items-center justify-between gap-4 rounded-md border p-3"
        data-testid="row-push"
        data-state="loading"
      >
        <div className="flex items-start gap-3">
          <Smartphone className="text-muted-foreground mt-0.5 h-4 w-4" />
          <div className="space-y-0.5">
            <span className="text-sm font-medium">Push web</span>
            <p className="text-muted-foreground text-xs">Cargando…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border p-3" data-testid="row-push" data-state={state.kind}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Smartphone className="text-muted-foreground mt-0.5 h-4 w-4" />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Push web</span>
              {state.kind === 'unsupported' && (
                <Badge variant="secondary" data-testid="push-badge-unsupported">
                  Tu navegador no soporta notificaciones push
                </Badge>
              )}
              {state.kind === 'permission_denied' && (
                <Badge variant="destructive" data-testid="push-badge-denied">
                  Bloqueado
                </Badge>
              )}
              {state.kind === 'not_subscribed' && (
                <Badge variant="secondary" data-testid="push-badge-unsubscribed">
                  No activadas
                </Badge>
              )}
              {state.kind === 'subscribed' && (
                <Badge
                  className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400"
                  data-testid="push-badge-subscribed"
                >
                  Activadas en este dispositivo
                </Badge>
              )}
            </div>
            {state.kind === 'unsupported' && (
              <p className="text-muted-foreground text-xs">
                Usá Chrome, Firefox o Edge en desktop, o Chrome en Android.
              </p>
            )}
            {state.kind === 'permission_denied' && (
              <p className="text-muted-foreground text-xs">
                Bloqueaste notificaciones para este sitio.
              </p>
            )}
            {state.kind === 'not_subscribed' && (
              <p className="text-muted-foreground text-xs">
                Recibí los recordatorios directamente en este navegador.
              </p>
            )}
            {state.kind === 'subscribed' && (
              <p className="text-muted-foreground text-xs">
                Recibís notificaciones nativas del navegador en este dispositivo.
              </p>
            )}
          </div>
        </div>

        {state.kind === 'not_subscribed' && (
          <Button
            type="button"
            size="sm"
            onClick={activate}
            disabled={pending}
            data-testid="push-activate-btn"
          >
            Activar
          </Button>
        )}

        {state.kind === 'subscribed' && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                data-testid="push-deactivate-btn"
              >
                Desactivar en este dispositivo
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Desactivar notificaciones en este dispositivo?</AlertDialogTitle>
                <AlertDialogDescription>
                  Vas a dejar de recibir notificaciones push en este navegador. Podés volver a
                  activarlas cuando quieras.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={deactivate} data-testid="push-deactivate-confirm">
                  Sí, desactivar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {state.kind === 'permission_denied' && (
        <Alert variant="destructive" data-testid="push-denied-alert">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Permiso bloqueado</AlertTitle>
          <AlertDescription>
            Activá notificaciones desde la configuración de tu navegador (ícono del candado a la
            izquierda de la URL) y recargá la página.
          </AlertDescription>
        </Alert>
      )}

      {state.kind === 'unsupported' && (
        <Alert data-testid="push-unsupported-alert">
          <Bell className="h-4 w-4" />
          <AlertTitle>Navegador incompatible</AlertTitle>
          <AlertDescription>
            Las notificaciones push requieren un navegador con soporte de Service Workers y Push
            API. iOS/Safari no las soporta sin instalar la app como PWA (próximamente).
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
