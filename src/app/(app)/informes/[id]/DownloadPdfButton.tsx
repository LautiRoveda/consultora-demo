'use client';

import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

/**
 * T-023 · Boton de descarga del PDF del informe.
 *
 * Aparece en /informes/[id] al lado de "Editar". Permisos: cualquier member
 * de la consultora (mismo gate que SELECT) — exportar es lectura.
 *
 * State machine: idle | downloading. El error se muestra como toast sin
 * cambiar el state — al fin del fetch volvemos a idle independientemente.
 *
 * Disabled si !hasContent con tooltip explicativo. Mismo gate que el route
 * handler (devuelve 422 EMPTY_CONTENT), pero defendemos en UI para no
 * gastar un round-trip si el user ya sabe que no hay contenido.
 *
 * Download trigger: Blob + URL.createObjectURL + anchor.click(). Limpiamos
 * el ObjectURL en `finally` para no leakear memoria del browser.
 */
export function DownloadPdfButton({
  informeId,
  hasContent,
}: {
  informeId: string;
  hasContent: boolean;
}) {
  const [downloading, setDownloading] = useState(false);

  async function handleClick() {
    if (downloading || !hasContent) return;
    setDownloading(true);

    let objectUrl: string | null = null;
    try {
      const res = await fetch(`/api/informes/${informeId}/pdf`, {
        method: 'GET',
        credentials: 'same-origin',
      });

      if (!res.ok) {
        // Parseamos el discriminated union del endpoint. Si la response no
        // es JSON (raro: middleware crashea antes del handler), caemos al
        // mensaje generico.
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        handleError(body.code, res.status);
        return;
      }

      const blob = await res.blob();
      objectUrl = URL.createObjectURL(blob);

      const filename =
        parseContentDispositionFilename(res.headers.get('content-disposition')) ??
        `informe-${informeId}.pdf`;

      triggerDownload(objectUrl, filename);
      toast.success('PDF descargado.');
    } catch {
      // Network error o body parse error inesperado.
      toast.error('Error de red descargando el PDF.');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setDownloading(false);
    }
  }

  const button = (
    <Button
      variant="outline"
      onClick={() => {
        void handleClick();
      }}
      disabled={!hasContent || downloading}
      aria-label="Descargar PDF del informe"
    >
      {downloading ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Generando…
        </>
      ) : (
        <>
          <Download className="size-4" aria-hidden="true" />
          Descargar PDF
        </>
      )}
    </Button>
  );

  // Tooltip solo cuando el boton esta disabled por !hasContent. Sin contenido
  // queremos guiar al user a generar primero; con contenido el boton se
  // explica solo.
  if (!hasContent) {
    return (
      <TooltipProvider>
        <Tooltip>
          {/* `asChild` no funciona sobre <button disabled> en Radix —
              el browser swallows el pointer event. Envolvemos en un span
              focusable que mantiene el hover trigger. */}
          <TooltipTrigger asChild>
            <span tabIndex={0}>{button}</span>
          </TooltipTrigger>
          <TooltipContent>Generá contenido antes de descargar</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
}

/**
 * Mapea el `code` del discriminated union del endpoint a un toast acorde.
 * Cubre los codes que un user puede gatillar; los `INVALID_INPUT` /
 * `INTERNAL_ERROR` caen al mensaje generico.
 */
function handleError(code: string | undefined, status: number): void {
  switch (code) {
    case 'UNAUTHENTICATED':
      toast.error('Tu sesión expiró.', {
        action: {
          label: 'Iniciar sesión',
          onClick: () => {
            window.location.href = '/login';
          },
        },
      });
      return;
    case 'EMPTY_CONTENT':
      toast.warning('Generá contenido antes de descargar.');
      return;
    case 'RENDER_TIMEOUT':
      toast.error('El PDF tardó demasiado. Reintentá.');
      return;
    case 'NOT_FOUND':
      toast.error('No se encontró el informe.');
      return;
    case 'NO_CONSULTORA':
      toast.error('Tu cuenta no tiene una consultora vinculada.');
      return;
    default:
      toast.error(`Error generando el PDF${status ? ` (${status})` : ''}.`);
  }
}

/**
 * Extrae el `filename` (o `filename*` UTF-8) de un header Content-Disposition.
 * Prefiere `filename*` (RFC 5987) si esta presente para soportar acentos.
 *
 * Format esperado del endpoint:
 *   attachment; filename="ascii.pdf"; filename*=UTF-8''percent%20encoded.pdf
 */
function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;

  // filename* (RFC 5987) tiene prioridad — es UTF-8 percent-encoded.
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (star?.[2]) {
    try {
      return decodeURIComponent(star[2].trim());
    } catch {
      // Fallback al filename ascii.
    }
  }

  const ascii = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return ascii?.[1]?.trim() ?? null;
}

/**
 * Disparo de descarga via anchor temporario. Compatible con todos los
 * browsers modernos (Chrome, Firefox, Safari, Edge).
 */
function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Append → click → remove evita que el browser dispare nav navigation
  // si el blob URL no tiene `Content-Disposition` (cosa que no controlamos
  // desde JS).
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
