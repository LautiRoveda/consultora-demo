'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

export type ClienteOption = { id: string; razon_social: string };

interface Props {
  clientes: ClienteOption[];
  selectedId?: string;
}

/** T-144 · Selector de cliente/establecimiento para la planilla RAR. Navega via
 * searchParam `?cliente=` (molde `PuestoSelect`). */
export function ClienteSelect({ clientes, selectedId }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleChange(id: string) {
    startTransition(() => {
      router.push(`/rar/planilla?cliente=${id}`);
    });
  }

  return (
    <Select value={selectedId ?? ''} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger className="sm:w-80">
        <SelectValue placeholder="Elegí un cliente" />
      </SelectTrigger>
      <SelectContent>
        {clientes.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.razon_social}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
