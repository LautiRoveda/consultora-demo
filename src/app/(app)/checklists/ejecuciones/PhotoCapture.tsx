'use client';

import { ImagePlus, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';

import { deleteAdjuntoAction, uploadAdjuntoAction } from './actions';

export type AdjuntoView = { id: string; src: string | null };

export type PhotoCaptureProps = {
  executionId: string;
  /** respuestaId actual (del save más reciente) o null si el ítem aún no se guardó. */
  getRespuestaId: () => string | null;
  /** Fuerza un save para obtener un respuestaId antes de subir (atar la foto al hallazgo). */
  ensureRespuesta: () => Promise<string | null>;
  initialAdjuntos: AdjuntoView[];
  disabled?: boolean;
  onFrozen: () => void;
};

const MAX_DIMENSION = 1600;

/** Downscale en canvas → JPEG 0.8: las fotos de cámara (3-8MB) bajan a ~cientos de KB,
 *  upload rápido en conexiones de campo y bien lejos del límite de 10MB del backend. */
async function downscaleToDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === 'string') resolve(r);
      else reject(new Error('read_error'));
    };
    reader.onerror = () => reject(new Error('read_error'));
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('decode_error'));
    i.src = dataUrl;
  });
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 1_500_000) return dataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

export function PhotoCapture({
  executionId,
  getRespuestaId,
  ensureRespuesta,
  initialAdjuntos,
  disabled,
  onFrozen,
}: PhotoCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [adjuntos, setAdjuntos] = useState<AdjuntoView[]>(initialAdjuntos);
  const [busy, setBusy] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-elegir la misma foto
    if (!file) return;
    setBusy(true);
    try {
      const respuestaId = getRespuestaId() ?? (await ensureRespuesta());
      const dataUrl = await downscaleToDataUrl(file);
      const result = await uploadAdjuntoAction({
        executionId,
        respuestaId: respuestaId ?? undefined,
        dataUrl,
      });
      if (result.ok) {
        setAdjuntos((prev) => [...prev, { id: result.adjuntoId, src: dataUrl }]);
      } else if (result.code === 'EXEC_NOT_DRAFT') {
        onFrozen();
      } else if (result.code === 'STORAGE_ERROR') {
        toast.error('No se pudo subir la foto', { description: 'Máximo 10 MB. Reintentá.' });
      } else {
        toast.error('No se pudo subir la foto', { description: result.message });
      }
    } catch {
      toast.error('No se pudo procesar la imagen');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(adjuntoId: string) {
    const result = await deleteAdjuntoAction({ adjuntoId });
    if (result.ok) {
      setAdjuntos((prev) => prev.filter((a) => a.id !== adjuntoId));
    } else if (result.code === 'EXEC_NOT_DRAFT') {
      onFrozen();
    } else {
      toast.error('No se pudo borrar la foto', { description: result.message });
    }
  }

  return (
    <div className="grid gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => void handleFile(e)}
        disabled={disabled || busy}
      />
      <div className="flex flex-wrap items-center gap-2">
        {adjuntos.map((a) => (
          <div key={a.id} className="relative h-16 w-16 overflow-hidden rounded-md border">
            {a.src ? (
              // eslint-disable-next-line @next/next/no-img-element -- signed URL / dataURL, no optimizar
              <img src={a.src} alt="Foto del hallazgo" className="h-full w-full object-cover" />
            ) : (
              <div className="bg-muted h-full w-full" />
            )}
            {!disabled && (
              <button
                type="button"
                onClick={() => void handleDelete(a.id)}
                aria-label="Quitar foto"
                className="bg-background/80 absolute top-0 right-0 rounded-bl-md p-0.5"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <ImagePlus className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {busy ? 'Subiendo…' : 'Agregar foto'}
        </Button>
      </div>
    </div>
  );
}
