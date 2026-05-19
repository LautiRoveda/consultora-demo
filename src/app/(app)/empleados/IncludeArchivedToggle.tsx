'use client';

import { useRouter } from 'next/navigation';

import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';

interface Props {
  clienteId: string;
  checked: boolean;
  currentQ: string;
}

export function IncludeArchivedToggle({ clienteId, checked, currentQ }: Props) {
  const router = useRouter();

  function handleChange(next: boolean) {
    const params = new URLSearchParams();
    params.set('cliente_id', clienteId);
    if (currentQ) params.set('q', currentQ);
    if (next) params.set('archived', '1');
    router.push(`/empleados?${params.toString()}`);
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Switch id="include-archived" checked={checked} onCheckedChange={handleChange} />
      <Label htmlFor="include-archived" className="cursor-pointer text-sm">
        Ver archivados
      </Label>
    </div>
  );
}
