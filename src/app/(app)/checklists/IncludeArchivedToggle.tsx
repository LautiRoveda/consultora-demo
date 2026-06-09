'use client';

import { useRouter } from 'next/navigation';

import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';

interface Props {
  checked: boolean;
}

/**
 * Toggle "Ver archivados" del listado de checklists. URL state `?archived=1`
 * dispara re-render del server component padre. (Calca el de catálogo EPP.)
 */
export function IncludeArchivedToggle({ checked }: Props) {
  const router = useRouter();

  function handleChange(next: boolean) {
    router.push(next ? '/checklists?archived=1' : '/checklists');
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
