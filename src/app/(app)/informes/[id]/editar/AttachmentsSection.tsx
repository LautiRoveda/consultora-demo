'use client';

import { ArrowDown, ArrowUp, Download, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { humanBytes, humanMime } from '@/shared/storage/format';
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
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Separator } from '@/shared/ui/separator';

import {
  deleteInformeAttachmentAction,
  reorderInformeAttachmentsAction,
  updateAttachmentCaptionAction,
} from '../attachments/actions';

export type AttachmentClientRow = {
  id: string;
  kind: 'image' | 'file';
  filename: string;
  mime_type: string;
  size_bytes: number;
  caption: string | null;
  position: number;
  signedUrl: string | null;
};

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp';
const FILE_ACCEPT =
  'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function handleErrorCode(code: string | undefined, message?: string): void {
  switch (code) {
    case 'UNSUPPORTED_MIME':
    case 'MAGIC_BYTES_MISMATCH':
      toast.error('Tipo de archivo no permitido', { description: message });
      break;
    case 'PAYLOAD_TOO_LARGE':
      toast.error('Archivo demasiado grande', { description: message });
      break;
    case 'QUOTA_EXCEEDED':
      toast.error('Limite de adjuntos alcanzado', { description: message });
      break;
    case 'FORBIDDEN':
      toast.error('Sin permiso', { description: message });
      break;
    case 'NOT_FOUND':
      toast.error('Informe no encontrado', { description: message });
      break;
    case 'STORAGE_ERROR':
      toast.error('Error de almacenamiento', { description: message });
      break;
    case 'UNAUTHENTICATED':
      toast.error('Sesión vencida', { description: message });
      break;
    default:
      toast.error('Error inesperado', { description: message });
  }
}

export function AttachmentsSection({
  informeId,
  initialAttachments,
  canEdit,
}: {
  informeId: string;
  initialAttachments: AttachmentClientRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const images = initialAttachments
    .filter((a) => a.kind === 'image')
    .sort((a, b) => a.position - b.position);
  const files = initialAttachments.filter((a) => a.kind === 'file');

  async function uploadFile(file: File): Promise<void> {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/informes/${informeId}/attachments`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        handleErrorCode(body.code, body.message);
        return;
      }
      toast.success('Adjunto cargado');
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error('Error de red', { description: String(err) });
    } finally {
      setUploading(false);
    }
  }

  function onImageInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = ''; // permitir re-seleccionar mismo archivo
    if (file) void uploadFile(file);
  }
  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void uploadFile(file);
  }

  async function onUpdateCaption(attachmentId: string, caption: string): Promise<void> {
    setPendingId(attachmentId);
    try {
      const result = await updateAttachmentCaptionAction(attachmentId, {
        caption: caption.length > 0 ? caption : null,
      });
      if (!result.ok) {
        handleErrorCode(result.code, result.message);
        return;
      }
      toast.success('Caption guardado');
      startTransition(() => router.refresh());
    } finally {
      setPendingId(null);
    }
  }

  async function onReorder(attachmentId: string, direction: 'up' | 'down'): Promise<void> {
    const idx = images.findIndex((a) => a.id === attachmentId);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= images.length) return;

    const orderedIds = images.map((a) => a.id);
    const tmp = orderedIds[idx]!;
    orderedIds[idx] = orderedIds[swapIdx]!;
    orderedIds[swapIdx] = tmp;

    setPendingId(attachmentId);
    try {
      const result = await reorderInformeAttachmentsAction(informeId, { orderedIds });
      if (!result.ok) {
        handleErrorCode(result.code, result.message);
        return;
      }
      startTransition(() => router.refresh());
    } finally {
      setPendingId(null);
    }
  }

  async function onDelete(attachmentId: string): Promise<void> {
    setPendingId(attachmentId);
    try {
      const result = await deleteInformeAttachmentAction(attachmentId);
      if (!result.ok) {
        handleErrorCode(result.code, result.message);
        return;
      }
      toast.success('Adjunto eliminado');
      startTransition(() => router.refresh());
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Adjuntos</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              {canEdit
                ? 'Imágenes (JPG/PNG/WEBP, max 10 MB) y archivos (PDF/DOC/XLS) que se incluyen como anexo del PDF.'
                : 'Adjuntos incluidos en el PDF descargable.'}
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                ref={imageInputRef}
                hidden
                onChange={onImageInputChange}
              />
              <input
                type="file"
                accept={FILE_ACCEPT}
                ref={fileInputRef}
                hidden
                onChange={onFileInputChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => imageInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-1.5 h-4 w-4" />
                )}
                Subir imagen
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="mr-1.5 h-4 w-4" />
                Subir archivo
              </Button>
            </div>
          )}
        </div>

        {images.length === 0 && files.length === 0 && (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No hay adjuntos todavía.
          </div>
        )}

        {images.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">
                Imágenes ({images.length})
              </p>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                {images.map((img, idx) => (
                  <ImageCard
                    key={img.id}
                    img={img}
                    isFirst={idx === 0}
                    isLast={idx === images.length - 1}
                    canEdit={canEdit}
                    isPending={pendingId === img.id}
                    onUpdateCaption={onUpdateCaption}
                    onReorder={onReorder}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {files.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">
                Archivos ({files.length})
              </p>
              <ul className="space-y-2">
                {files.map((f) => (
                  <FileRow
                    key={f.id}
                    file={f}
                    canEdit={canEdit}
                    isPending={pendingId === f.id}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ImageCard({
  img,
  isFirst,
  isLast,
  canEdit,
  isPending,
  onUpdateCaption,
  onReorder,
  onDelete,
}: {
  img: AttachmentClientRow;
  isFirst: boolean;
  isLast: boolean;
  canEdit: boolean;
  isPending: boolean;
  onUpdateCaption: (id: string, caption: string) => Promise<void>;
  onReorder: (id: string, dir: 'up' | 'down') => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [caption, setCaption] = useState(img.caption ?? '');

  return (
    <div className="border-border bg-card overflow-hidden rounded-md border">
      {/* T-024-FU0.5: thumbnail wrappeado en Dialog. Click abre lightbox con
          la imagen full-size + caption. Aplica para canEdit=true y false —
          el lightbox es solo visual, no toca permisos. */}
      {img.signedUrl ? (
        <Dialog>
          <DialogTrigger asChild>
            <button
              type="button"
              className="bg-muted relative block aspect-video w-full cursor-zoom-in overflow-hidden"
              aria-label={`Ampliar imagen ${img.filename}`}
            >
              <Image
                src={img.signedUrl}
                alt={img.filename}
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-contain"
                unoptimized
              />
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-screen-lg p-4 sm:p-6">
            <DialogTitle className="truncate text-base">{img.filename}</DialogTitle>
            <DialogDescription className="sr-only">
              Vista ampliada del adjunto {img.filename}
            </DialogDescription>
            {/* eslint-disable-next-line @next/next/no-img-element -- Lightbox de signed URL externa; mantenemos <img> simple sin Next/Image. */}
            <img
              src={img.signedUrl}
              alt={img.filename}
              className="mx-auto h-auto max-h-[80vh] w-full object-contain"
            />
            {img.caption && (
              <p className="text-muted-foreground mt-2 text-center text-sm">{img.caption}</p>
            )}
          </DialogContent>
        </Dialog>
      ) : (
        <div className="bg-muted relative aspect-video">
          <div className="text-muted-foreground flex h-full items-center justify-center text-xs">
            Sin preview
          </div>
        </div>
      )}
      <div className="space-y-2 p-3">
        <p className="text-foreground truncate text-xs" title={img.filename}>
          {img.filename}
        </p>
        <p className="text-muted-foreground text-xs">{humanBytes(img.size_bytes)}</p>
        {canEdit ? (
          <Input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 500))}
            onBlur={() => {
              if (caption !== (img.caption ?? '')) void onUpdateCaption(img.id, caption);
            }}
            placeholder="Caption opcional"
            disabled={isPending}
            className="h-8 text-xs"
            maxLength={500}
          />
        ) : (
          img.caption && <p className="text-muted-foreground text-xs italic">{img.caption}</p>
        )}
        {canEdit && (
          <div className="flex items-center justify-between gap-1 pt-1">
            <div className="flex gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={isFirst || isPending}
                onClick={() => void onReorder(img.id, 'up')}
                className="h-7 w-7"
                aria-label="Mover arriba"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={isLast || isPending}
                onClick={() => void onReorder(img.id, 'down')}
                className="h-7 w-7"
                aria-label="Mover abajo"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </Button>
            </div>
            <DeleteAttachmentButton
              filename={img.filename}
              isPending={isPending}
              onDelete={() => onDelete(img.id)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  canEdit,
  isPending,
  onDelete,
}: {
  file: AttachmentClientRow;
  canEdit: boolean;
  isPending: boolean;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <li className="border-border bg-card flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-medium" title={file.filename}>
          {file.filename}
        </p>
        <p className="text-muted-foreground text-xs">
          {humanMime(file.mime_type)} · {humanBytes(file.size_bytes)}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {file.signedUrl && (
          <Button type="button" size="sm" variant="outline" asChild>
            <a href={file.signedUrl} download={file.filename} target="_blank" rel="noreferrer">
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Descargar
            </a>
          </Button>
        )}
        {canEdit && (
          <DeleteAttachmentButton
            filename={file.filename}
            isPending={isPending}
            onDelete={() => onDelete(file.id)}
          />
        )}
      </div>
    </li>
  );
}

function DeleteAttachmentButton({
  filename,
  isPending,
  onDelete,
}: {
  filename: string;
  isPending: boolean;
  onDelete: () => Promise<void>;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          disabled={isPending}
          className="text-destructive hover:bg-destructive/10 h-7 w-7"
          aria-label="Eliminar adjunto"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Eliminar adjunto</AlertDialogTitle>
          <AlertDialogDescription>
            Vas a eliminar <strong>{filename}</strong>. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => void onDelete()}>Eliminar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
