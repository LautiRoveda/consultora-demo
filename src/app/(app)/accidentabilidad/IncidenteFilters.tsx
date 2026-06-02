'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { GRAVEDAD_INCIDENTE, TIPO_INCIDENTE } from './schema';

export type IncidenteFilterValues = {
  tipo?: string;
  clienteId?: string;
  gravedad?: string;
  desde?: string;
  hasta?: string;
};

type ClienteOption = { id: string; razon_social: string };

const ALL = '__all__';

/**
 * T-063 · Barra de filtros del listado. Los filtros estructurados (tipo /
 * cliente / fecha desde-hasta / gravedad) viven en la URL → el server component
 * re-fetcha. Mismo mecanismo de `router.push` que `IncludeArchivedToggle`.
 *
 * `gravedad` viaja en la URL pero `getIncidentes` no la soporta server-side: la
 * página la pasa a `IncidentesList` que filtra client-side sobre la página
 * devuelta (caveat MVP, documentado en el plan).
 */
export function IncidenteFilters({
  initial,
  clienteOptions,
}: {
  initial: IncidenteFilterValues;
  clienteOptions: ClienteOption[];
}) {
  const router = useRouter();

  function push(next: IncidenteFilterValues) {
    const params = new URLSearchParams();
    if (next.tipo) params.set('tipo', next.tipo);
    if (next.clienteId) params.set('cliente', next.clienteId);
    if (next.gravedad) params.set('gravedad', next.gravedad);
    if (next.desde) params.set('desde', next.desde);
    if (next.hasta) params.set('hasta', next.hasta);
    const qs = params.toString();
    router.push(`/accidentabilidad${qs ? `?${qs}` : ''}`);
  }

  const hasFilters = !!(
    initial.tipo ||
    initial.clienteId ||
    initial.gravedad ||
    initial.desde ||
    initial.hasta
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="space-y-1">
        <Label htmlFor="filtro-tipo" className="text-xs">
          Tipo
        </Label>
        <Select
          value={initial.tipo ?? ALL}
          onValueChange={(v) => push({ ...initial, tipo: v === ALL ? undefined : v })}
        >
          <SelectTrigger id="filtro-tipo">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            {TIPO_INCIDENTE.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filtro-gravedad" className="text-xs">
          Gravedad
        </Label>
        <Select
          value={initial.gravedad ?? ALL}
          onValueChange={(v) => push({ ...initial, gravedad: v === ALL ? undefined : v })}
        >
          <SelectTrigger id="filtro-gravedad">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas</SelectItem>
            {GRAVEDAD_INCIDENTE.map((g) => (
              <SelectItem key={g.value} value={g.value}>
                {g.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filtro-cliente" className="text-xs">
          Cliente
        </Label>
        <Select
          value={initial.clienteId ?? ALL}
          onValueChange={(v) => push({ ...initial, clienteId: v === ALL ? undefined : v })}
        >
          <SelectTrigger id="filtro-cliente">
            <SelectValue placeholder="Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            {clienteOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.razon_social}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="filtro-desde" className="text-xs">
          Desde
        </Label>
        <Input
          id="filtro-desde"
          type="date"
          value={initial.desde ?? ''}
          max={initial.hasta || undefined}
          onChange={(e) => push({ ...initial, desde: e.target.value || undefined })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="filtro-hasta" className="text-xs">
          Hasta
        </Label>
        <Input
          id="filtro-hasta"
          type="date"
          value={initial.hasta ?? ''}
          min={initial.desde || undefined}
          onChange={(e) => push({ ...initial, hasta: e.target.value || undefined })}
        />
      </div>

      {hasFilters && (
        <div className="sm:col-span-2 lg:col-span-5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => router.push('/accidentabilidad')}
          >
            Limpiar filtros
          </Button>
        </div>
      )}
    </div>
  );
}
