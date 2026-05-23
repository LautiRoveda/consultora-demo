'use client';

import { useRouter } from 'next/navigation';

import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';

interface Props {
  checked: boolean;
  basePath: string;
}

/**
 * Toggle "Ver archivados" reusado en las 3 listas del catálogo EPP. URL state
 * `?archived=1` dispara re-render del server component padre.
 */
export function IncludeArchivedToggle({ checked, basePath }: Props) {
  const router = useRouter();

  function handleChange(next: boolean) {
    const params = new URLSearchParams();
    if (next) params.set('archived', '1');
    const qs = params.toString();
    router.push(`${basePath}${qs ? `?${qs}` : ''}`);
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
