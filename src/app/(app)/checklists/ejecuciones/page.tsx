import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { getClientesForConsultora } from '../../clientes/queries';
import { getChecklistTemplates } from '../queries';
import { EjecucionesList } from './EjecucionesList';
import { EmptyEjecucionesState } from './EmptyEjecucionesState';
import { getEjecucionesForConsultora } from './queries';

/**
 * T-061a · Listado de inspecciones (ejecuciones vigentes del tenant). Uso diario
 * en campo: cualquier member puede iniciar/continuar. El cierre con firma es del
 * owner (T-061b). El snapshot del establecimiento solo existe en cerradas, así que
 * para los borradores resolvemos el nombre del cliente con un mapa cliente_id→razón.
 */
export default async function EjecucionesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const [ejecuciones, clientes, templates] = await Promise.all([
    getEjecucionesForConsultora(supabase),
    getClientesForConsultora(supabase, { includeArchived: true, limit: 1000 }),
    getChecklistTemplates(supabase, {}),
  ]);

  const clienteNameById: Record<string, string> = {};
  for (const c of clientes) clienteNameById[c.id] = c.razon_social;

  const hasPublishedTemplate = templates.some((t) => t.latestVersionEstado === 'published');

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

      {ejecuciones.length === 0 ? (
        <EmptyEjecucionesState hasPublishedTemplate={hasPublishedTemplate} />
      ) : (
        <EjecucionesList ejecuciones={ejecuciones} clienteNameById={clienteNameById} />
      )}
    </div>
  );
}
