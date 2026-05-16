'use client';

import { ImageOff, Loader2, Trash2, Upload } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Switch } from '@/shared/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/shared/ui/tooltip';

import { removeConsultoraLogoAction, updateAutoCreateEventToggleAction } from './actions';

const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

function handleErrorCode(code: string | undefined, message?: string): void {
  switch (code) {
    case 'UNSUPPORTED_MIME':
    case 'MAGIC_BYTES_MISMATCH':
      toast.error('Tipo de archivo no permitido', { description: message });
      break;
    case 'PAYLOAD_TOO_LARGE':
      toast.error('Archivo demasiado grande', { description: message });
      break;
    case 'FORBIDDEN':
      toast.error('Sin permiso', { description: message });
      break;
    case 'STORAGE_ERROR':
      toast.error('Error de almacenamiento', { description: message });
      break;
    default:
      toast.error('Error inesperado', { description: message });
  }
}

export function ConsultoraSettingsView({
  consultoraName,
  consultoraRole,
  logoSignedUrl,
  hasLogo,
  autoCreateEventOnSign,
}: {
  consultoraName: string;
  consultoraRole: 'owner' | 'member';
  logoSignedUrl: string | null;
  hasLogo: boolean;
  /** T-036: estado actual del toggle "auto-crear vencimiento al firmar". */
  autoCreateEventOnSign: boolean;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  // T-036: state local del toggle. Sync con prop al recibir refresh + pending
  // mientras la action corre (useTransition).
  const [toggleValue, setToggleValue] = useState(autoCreateEventOnSign);
  const [togglePending, startToggleTransition] = useTransition();
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOwner = consultoraRole === 'owner';
  const disabled = !isOwner || uploading || removing;

  async function uploadLogo(file: File): Promise<void> {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/settings/consultora/logo', { method: 'POST', body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
        handleErrorCode(body.code, body.message);
        return;
      }
      toast.success('Logo cargado');
      startTransition(() => router.refresh());
    } catch (err) {
      toast.error('Error de red', { description: String(err) });
    } finally {
      setUploading(false);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void uploadLogo(file);
  }

  async function onRemove(): Promise<void> {
    setRemoving(true);
    try {
      const result = await removeConsultoraLogoAction();
      if (!result.ok) {
        handleErrorCode(result.code, result.message);
        return;
      }
      toast.success('Logo eliminado');
      startTransition(() => router.refresh());
    } finally {
      setRemoving(false);
    }
  }

  // T-036: handler del toggle workflow. Owner-only por gate UI + server-side.
  function handleToggle(next: boolean): void {
    // Optimistic update con rollback en error.
    setToggleValue(next);
    startToggleTransition(async () => {
      const result = await updateAutoCreateEventToggleAction(next);
      if (!result.ok) {
        setToggleValue(!next); // rollback
        switch (result.code) {
          case 'FORBIDDEN':
            toast.error('Sin permiso', { description: result.message });
            return;
          case 'UNAUTHENTICATED':
            toast.error('Sesión vencida', { description: result.message });
            router.push('/login');
            return;
          case 'INVALID_INPUT':
          case 'NO_CONSULTORA':
          case 'INTERNAL_ERROR':
            toast.error('Error', { description: result.message });
            return;
        }
      }
      toast.success(next ? 'Auto-creación activada' : 'Auto-creación desactivada');
      startTransition(() => router.refresh());
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Logo de la consultora</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Aparece en el header de cada PDF generado. Si no cargás uno, se usa el nombre de la
              consultora como wordmark. Solo PNG/JPG/WEBP, máx 2 MB.
            </p>
          </div>

          {!isOwner && (
            <Alert>
              <AlertTitle>Solo el owner puede editar</AlertTitle>
              <AlertDescription>
                Sos member de <strong>{consultoraName}</strong>. Pedile al owner que actualice el
                branding.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <div className="border-border bg-muted/30 flex h-32 w-64 shrink-0 items-center justify-center overflow-hidden rounded-md border">
              {logoSignedUrl ? (
                <Image
                  src={logoSignedUrl}
                  alt={`Logo de ${consultoraName}`}
                  width={256}
                  height={128}
                  className="max-h-full max-w-full object-contain"
                  unoptimized
                />
              ) : (
                <div className="text-muted-foreground flex flex-col items-center gap-1.5 text-xs">
                  <ImageOff className="h-5 w-5" />
                  Sin logo
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <input
                type="file"
                accept={LOGO_ACCEPT}
                ref={fileInputRef}
                hidden
                onChange={onFileChange}
              />
              <Button
                type="button"
                variant="default"
                disabled={disabled}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                {hasLogo ? 'Reemplazar logo' : 'Cargar logo'}
              </Button>

              {hasLogo && isOwner && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" disabled={disabled}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Eliminar logo
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Eliminar logo</AlertDialogTitle>
                      <AlertDialogDescription>
                        Vas a eliminar el logo de <strong>{consultoraName}</strong>. Los PDFs
                        futuros usarán el wordmark en su lugar.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void onRemove()}>
                        Eliminar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* T-036: Card Workflow con toggle auto-crear vencimiento al firmar.
          Owner-only edit: si !isOwner, Switch disabled + Tooltip explica.
          Lectura visible para todos los members. */}
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Workflow</h2>
            <p className="text-muted-foreground mt-1 text-sm">Comportamiento al firmar informes.</p>
          </div>

          {!isOwner && (
            <Alert>
              <AlertTitle>Workflow administrado por el owner</AlertTitle>
              <AlertDescription>
                Sos member de <strong>{consultoraName}</strong>. Pedile al owner que ajuste el
                workflow si lo necesitás.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-start justify-between gap-4 rounded-md border p-3">
            <div className="space-y-1">
              <span className="text-sm font-medium">Auto-crear vencimiento al firmar</span>
              <p className="text-muted-foreground text-xs">
                Al publicar un informe recurrente (RGRL, relevamiento, capacitación) se crea
                automáticamente el vencimiento del próximo año sin preguntar. Si está desactivado,
                te preguntamos cada vez con un modal.
              </p>
            </div>
            {isOwner ? (
              <Switch
                checked={toggleValue}
                onCheckedChange={handleToggle}
                disabled={togglePending}
                data-testid="toggle-auto-create-event"
                aria-label="Auto-crear vencimiento al firmar"
              />
            ) : (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Switch
                        checked={toggleValue}
                        disabled
                        data-testid="toggle-auto-create-event"
                        aria-label="Auto-crear vencimiento al firmar"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Solo el owner puede modificar el workflow de la consultora
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
