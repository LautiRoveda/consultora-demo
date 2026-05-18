'use client';

import { useRouter } from 'next/navigation';

import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';

interface Props {
  checked: boolean;
  currentQ: string;
}

export function IncludeArchivedToggle({ checked, currentQ }: Props) {
  const router = useRouter();

  function handleChange(next: boolean) {
    const params = new URLSearchParams();
    if (currentQ) params.set('q', currentQ);
    if (next) params.set('archived', '1');
    const qs = params.toString();
    router.push(`/clientes${qs ? `?${qs}` : ''}`);
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
