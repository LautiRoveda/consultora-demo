'use client';

import type { AgenteDisponible } from './queries';
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

import { assignAgenteAPuestoAction } from './actions';
import { TIPO_LABELS } from './labels';

interface Props {
  clienteId: string;
  puestoId: string;
  disponibles: AgenteDisponible[];
}

export function AssignAgenteButton({ clienteId, puestoId, disponibles }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [agenteId, setAgenteId] = useState<string>('');

  const noHayDisponibles = disponibles.length === 0;

  function handleConfirm() {
    if (!agenteId) return;
    startTransition(async () => {
      const result = await assignAgenteAPuestoAction({
        cliente_id: clienteId,
        puesto_id: puestoId,
        agente_id: agenteId,
      });

      if (result.ok) {
        toast.success('Agente asignado');
        setOpen(false);
        setAgenteId('');
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'CLIENTE_NOT_FOUND':
          toast.error('Cliente no disponible', { description: result.message });
          router.refresh();
          return;
        case 'AGENTE_NOT_FOUND':
          toast.error('Agente no disponible', { description: result.message });
          router.refresh();
          return;
        case 'PUESTO_NOT_FOUND':
          toast.error('Puesto no disponible', { description: result.message });
          router.refresh();
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
          toast.error('No se pudo asignar el agente', { description: result.message });
      }
    });
  }

  function handleOpenChange(next: boolean) {
    if (isPending) return;
    setOpen(next);
    if (!next) setAgenteId('');
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={noHayDisponibles}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          Asignar agente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar agente de riesgo</DialogTitle>
          <DialogDescription>
            Elegí un agente del catálogo para vincular a este puesto. Los agentes archivados o ya
            asignados no aparecen en la lista.
          </DialogDescription>
        </DialogHeader>
        {noHayDisponibles ? (
          <p className="text-muted-foreground text-sm">
            No hay agentes disponibles para asignar. Creá o sembrá agentes en{' '}
            <a href="/rar/agentes" className="underline">
              el catálogo
            </a>
            .
          </p>
        ) : (
          <Select value={agenteId} onValueChange={setAgenteId} disabled={isPending}>
            <SelectTrigger>
              <SelectValue placeholder="Elegí un agente" />
            </SelectTrigger>
            <SelectContent>
              {disponibles.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.codigo} · {a.nombre} ({TIPO_LABELS[a.agente_tipo]})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={isPending || !agenteId || noHayDisponibles}>
            {isPending ? 'Asignando…' : 'Asignar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
