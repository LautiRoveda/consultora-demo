'use client';

import type { PuestoDisponible } from './puestos/queries';
import { Plus } from 'lucide-react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { assignPuestoAction } from './puestos/actions';

interface Props {
  empleadoId: string;
  disponibles: PuestoDisponible[];
}

export function AssignPuestoButton({ empleadoId, disponibles }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [puestoId, setPuestoId] = useState<string>('');

  const noHayDisponibles = disponibles.length === 0;

  function handleConfirm() {
    if (!puestoId) return;
    startTransition(async () => {
      const result = await assignPuestoAction({
        empleado_id: empleadoId,
        puesto_id: puestoId,
      });

      if (result.ok) {
        toast.success('Puesto asignado');
        setOpen(false);
        setPuestoId('');
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'PUESTO_NOT_FOUND':
          toast.error('Puesto no disponible', { description: result.message });
          router.refresh();
          return;
        case 'EMPLEADO_NOT_FOUND':
          toast.error('Empleado no encontrado');
          router.push('/empleados');
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        case 'NO_CONSULTORA':
          toast.error('Cuenta sin consultora', { description: result.message });
          return;
        case 'INVALID_INPUT':
          toast.error('Datos inválidos', { description: result.message });
          return;
        default:
          toast.error('No se pudo asignar el puesto', { description: result.message });
      }
    });
  }

  function handleOpenChange(next: boolean) {
    if (isPending) return;
    setOpen(next);
    if (!next) setPuestoId('');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={noHayDisponibles}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Asignar puesto
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar puesto</DialogTitle>
          <DialogDescription>
            Elegí un puesto del catálogo para vincular al empleado. Los puestos archivados o ya
            asignados no aparecen en la lista.
          </DialogDescription>
        </DialogHeader>
        {noHayDisponibles ? (
          <p className="text-muted-foreground text-sm">
            No hay puestos disponibles para asignar. Creá un puesto nuevo en{' '}
            <a href="/epp/catalogo/puestos" className="underline">
              el catálogo
            </a>
            .
          </p>
        ) : (
          <Select value={puestoId} onValueChange={setPuestoId} disabled={isPending}>
            <SelectTrigger>
              <SelectValue placeholder="Elegí un puesto" />
            </SelectTrigger>
            <SelectContent>
              {disponibles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !puestoId || noHayDisponibles}>
            {isPending ? 'Asignando…' : 'Asignar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
