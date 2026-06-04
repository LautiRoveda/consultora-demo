'use client';

import type { SaveStatus } from './useAutoSaveRespuesta';
import { AlertCircle, Check, Loader2 } from 'lucide-react';

/**
 * T-061a · Indicador de auto-save por ítem. `aria-live="polite"` para que el
 * lector de pantalla anuncie "Guardado" sin robar el foco. No bloquea el resto.
 */
export function SaveStatusIndicator({
  status,
  onRetry,
}: {
  status: SaveStatus;
  onRetry: () => void;
}) {
  return (
    <div className="text-muted-foreground flex h-5 items-center gap-1 text-xs" aria-live="polite">
      {status === 'saving' && (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span>Guardando…</span>
        </>
      )}
      {status === 'saved' && (
        <>
          <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
          <span>Guardado</span>
        </>
      )}
      {status === 'error' && (
        <>
          <AlertCircle className="text-destructive h-3.5 w-3.5" aria-hidden="true" />
          <span className="text-destructive">Error.</span>
          <button
            type="button"
            onClick={onRetry}
            className="text-destructive font-medium underline underline-offset-2"
          >
            Reintentar
          </button>
        </>
      )}
    </div>
  );
}
