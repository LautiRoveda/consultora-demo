import type { GetIncidentesFilters } from './queries';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { getClientesForConsultora } from '../clientes/queries';
import { IncidentesList } from './IncidentesList';
import { getIncidentes } from './queries';

type SearchParams = {
  tipo?: string;
  cliente?: string;
  gravedad?: string;
  desde?: string;
  hasta?: string;
};

/**
 * T-063 · Listado del libro de incidentes (registros vigentes del tenant).
 *
 * Server Component: filtros estructurados (tipo/cliente/desde/hasta) se aplican
 * server-side vía `getIncidentes`; `gravedad` + búsqueda libre se resuelven
 * client-side en `IncidentesList`. `getUser` defensivo (el layout `(app)` ya
 * guardea sesión).
 */
export default async function AccidentabilidadPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const tipo = sp.tipo === 'accidente' || sp.tipo === 'casi_accidente' ? sp.tipo : undefined;
  const clienteId = sp.cliente?.trim() || undefined;
  const gravedad =
    sp.gravedad === 'leve' || sp.gravedad === 'grave' || sp.gravedad === 'mortal'
      ? sp.gravedad
      : undefined;
  const desde = sp.desde?.trim() || undefined;
  const hasta = sp.hasta?.trim() || undefined;

  const filters: GetIncidentesFilters = { tipo, clienteId, desde, hasta };

  const [incidentes, clientes] = await Promise.all([
    getIncidentes(supabase, filters),
    getClientesForConsultora(supabase, { includeArchived: false }),
  ]);
  const clienteOptions = clientes.map((c) => ({ id: c.id, razon_social: c.razon_social }));

  const hasActiveFilters = !!(tipo || clienteId || gravedad || desde || hasta);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
            Accidentabilidad
          </h1>
          <p className="text-muted-foreground text-sm">
            Libro de incidentes — registrá casi-accidentes y accidentes, corregí errores sin perder
            la trazabilidad y anulá registros cargados por error.
          </p>
        </div>
        {(incidentes.length > 0 || hasActiveFilters) && (
          <Button asChild>
            <Link href="/accidentabilidad/nuevo">Registrar incidente</Link>
          </Button>
        )}
      </div>
      <IncidentesList
        incidentes={incidentes}
        clienteOptions={clienteOptions}
        initial={{ tipo, clienteId, gravedad, desde, hasta }}
        hasActiveFilters={hasActiveFilters}
      />
    </div>
  );
}
