'use client';

import { useRouter } from 'next/navigation';

import { Label } from '@/shared/ui/label';
import { Switch } from '@/shared/ui/switch';

/**
 * T-061-FU1 · Toggle "Ver anuladas" del listado de inspecciones. Empuja
 * `?anuladas=1` a la URL → el server component re-fetcha desde
 * `checklist_executions_heads` (incluye tombstones). Mismo mecanismo de
 * `router.push` que el toggle de incidentes (T-063-FU2). El listado no tiene
 * otros params, así que la URL se arma directo.
 */
export function EjecucionesAnuladasToggle({ includeAnuladas }: { includeAnuladas: boolean }) {
  const router = useRouter();

  return (
    <div className="flex items-center gap-2">
      <Switch
        id="ver-anuladas"
        checked={includeAnuladas}
        onCheckedChange={(checked) =>
          router.push(`/checklists/ejecuciones${checked ? '?anuladas=1' : ''}`)
        }
      />
      <Label htmlFor="ver-anuladas" className="cursor-pointer text-sm">
        Ver anuladas
      </Label>
    </div>
  );
}
