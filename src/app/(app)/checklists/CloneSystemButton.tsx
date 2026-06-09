'use client';

import { Copy } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';

import { cloneSystemTemplateAction } from './actions';

interface Props {
  systemTemplateId: string;
  /** 'sm' para la fila del listado, 'default' para el CTA del empty-state. */
  size?: 'sm' | 'default';
  label?: string;
}

/**
 * "Usar / Personalizar" un template de sistema (RGRL). Sin nombre → la action
 * auto-sufija "(copia)"; con nombre explícito → DUPLICATE_NAME si colisiona. Tras
 * clonar navega al nuevo draft propio.
 */
export function CloneSystemButton({
  systemTemplateId,
  size = 'sm',
  label = 'Usar / Personalizar',
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [nombreError, setNombreError] = useState<string | null>(null);

  function clone(withName: boolean) {
    setNombreError(null);
    startTransition(async () => {
      const result = await cloneSystemTemplateAction(
        withName && nombre.trim() !== ''
          ? { systemTemplateId, nombre: nombre.trim() }
          : { systemTemplateId },
      );

      if (result.ok) {
        toast.success('Template creado a partir del de sistema');
        setOpen(false);
        router.push(`/checklists/${result.templateId}`);
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'DUPLICATE_NAME':
          setNombreError(result.fieldErrors.nombre[0] ?? 'Nombre duplicado.');
          toast.error('Nombre duplicado', { description: result.message });
          return;
        case 'INVALID_INPUT':
          setNombreError(result.fieldErrors.nombre?.[0] ?? null);
          toast.error('Datos inválidos', { description: result.message });
          return;
        case 'NOT_FOUND':
          toast.error('No se encontró el template de sistema');
          router.refresh();
          return;
        case 'FORBIDDEN_NOT_OWNER':
          toast.error('Permisos insuficientes', { description: result.message });
          return;
        case 'BILLING_GATED':
          toast.error('Suscripción requerida', { description: result.message });
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        default:
          toast.error('Error inesperado', { description: result.message });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={size === 'sm' ? 'outline' : 'default'} size={size} disabled={isPending}>
          <Copy className="mr-2 size-4" aria-hidden />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Usar el template de sistema</DialogTitle>
          <DialogDescription>
            Se crea una copia editable en tu cuenta. Podés dejar el nombre por defecto (se agrega
            «(copia)» si hace falta) o ponerle uno propio.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="clone-nombre">Nombre (opcional)</Label>
          <Input
            id="clone-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: RGRL planta norte"
            disabled={isPending}
            aria-invalid={nombreError ? true : undefined}
          />
          {nombreError && <p className="text-destructive text-sm">{nombreError}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => clone(false)} disabled={isPending}>
            Usar nombre por defecto
          </Button>
          <Button type="button" onClick={() => clone(true)} disabled={isPending}>
            {isPending ? 'Creando…' : 'Crear copia'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
