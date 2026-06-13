'use client';

import type { PuestoOption } from './queries';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

interface Props {
  puestos: PuestoOption[];
  selectedId?: string;
  /** Cliente/establecimiento activo — se preserva en la URL al elegir puesto
   * (T-145: la exposición es cliente×puesto). */
  clienteId: string;
}

export function PuestoSelect({ puestos, selectedId, clienteId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(id: string) {
    startTransition(() => {
      router.push(`/rar/exposicion?cliente=${clienteId}&puesto=${id}`);
    });
  }

  return (
    <Select value={selectedId ?? ''} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="sm:w-80">
        <SelectValue placeholder="Elegí un puesto" />
      </SelectTrigger>
      <SelectContent>
        {puestos.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
