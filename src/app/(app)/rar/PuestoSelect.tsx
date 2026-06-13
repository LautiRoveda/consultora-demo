'use client';

import type { PuestoOption } from './queries';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

interface Props {
  puestos: PuestoOption[];
  selectedId?: string;
}

export function PuestoSelect({ puestos, selectedId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(id: string) {
    startTransition(() => {
      router.push(`/rar/exposicion?puesto=${id}`);
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
