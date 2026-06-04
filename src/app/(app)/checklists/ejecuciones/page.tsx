import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { getClientesForConsultora } from '../../clientes/queries';
import { getChecklistTemplates } from '../queries';
import { EjecucionesAnuladasToggle } from './EjecucionesAnuladasToggle';
import { EjecucionesList } from './EjecucionesList';
import { EmptyEjecucionesState } from './EmptyEjecucionesState';
import { getEjecucionesForConsultora } from './queries';

/**
 * T-061a · Listado de inspecciones del tenant. Uso diario en campo: cualquier
 * member puede iniciar/continuar. El cierre con firma es del owner (T-061b). El
 * snapshot del establecimiento solo existe en cerradas, así que para los borradores
 * resolvemos el nombre del cliente con un mapa cliente_id→razón.
 *
 * T-061-FU1 · `?anuladas=1` lee de `checklist_executions_heads` (incluye los
 * tombstones anulados); el toggle se renderiza SIEMPRE (salvo el onboarding puro)
 * para que un tenant cuya única inspección fue anulada pueda revelarla.
 */
export default async function EjecucionesPage({
  searchParams,
}: {
  searchParams: Promise<{ anuladas?: string }>;
}) {
  const sp = await searchParams;
  const includeAnuladas = sp.anuladas === '1';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const [ejecuciones, clientes, templates] = await Promise.all([
    getEjecucionesForConsultora(supabase, { includeAnuladas }),
    getClientesForConsultora(supabase, { includeArchived: true, limit: 1000 }),
    getChecklistTemplates(supabase, {}),
  ]);

  const clienteNameById: Record<string, string> = {};
  for (const c of clientes) clienteNameById[c.id] = c.razon_social;

  const hasPublishedTemplate = templates.some((t) => t.latestVersionEstado === 'published');

  // El toggle cuenta como "filtro activo" → no dispara el onboarding por sí solo.
  const hasActiveFilters = includeAnuladas;
  const showOnboarding = ejecuciones.length === 0 && !hasActiveFilters;

  return (
    <div className="max-w-5xl space-y-6">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inspecciones</h1>
          <p className="text-muted-foreground text-sm">
            Relevá un template publicado en obra y cerralo firmado. Las acciones correctivas entran
            al calendario.
          </p>
        </div>
        {hasPublishedTemplate && (
          <Button asChild>
            <Link href="/checklists/ejecuciones/nueva">Nueva inspección</Link>
          </Button>
        )}
      </header>

      {/* El toggle se renderiza SIEMPRE (incluso en onboarding) así un tenant cuya
          única inspección fue anulada puede revelarla — mismo criterio que incidentes. */}
      <div className="space-y-4">
        <EjecucionesAnuladasToggle includeAnuladas={includeAnuladas} />
        {showOnboarding ? (
          <EmptyEjecucionesState hasPublishedTemplate={hasPublishedTemplate} />
        ) : ejecuciones.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No hay inspecciones anuladas.
          </p>
        ) : (
          <EjecucionesList ejecuciones={ejecuciones} clienteNameById={clienteNameById} />
        )}
      </div>
    </div>
  );
}
