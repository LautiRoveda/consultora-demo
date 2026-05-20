'use client';

import { useRouter } from 'next/navigation';

import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';

interface Props {
  clienteId: string;
  checked: boolean;
  currentQ: string;
  /**
   * T-055 · Permite reusar el toggle desde el tab Empleados del detail cliente
   * (`/clientes/[id]/empleados`). Si `basePath === '/empleados'` (default),
   * `cliente_id` va en query. Si distinto, asumimos que `cliente_id` ya está
   * en el path → solo `q` y `archived` en query.
   */
  basePath?: string;
}

export function IncludeArchivedToggle({
  clienteId,
  checked,
  currentQ,
  basePath = '/empleados',
}: Props) {
  const router = useRouter();

  function handleChange(next: boolean) {
    const params = new URLSearchParams();
    if (basePath === '/empleados') params.set('cliente_id', clienteId);
    if (currentQ) params.set('q', currentQ);
    if (next) params.set('archived', '1');
    const qs = params.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
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
