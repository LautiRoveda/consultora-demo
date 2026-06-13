import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { PuestoAgentesCard } from '../PuestoAgentesCard';
import { PuestoSelect } from '../PuestoSelect';
import {
  listAgentesDePuesto,
  listAgentesDisponiblesParaPuesto,
  listPuestosActivos,
} from '../queries';
import { RarTabsNav } from '../RarTabsNav';

type SearchParams = { puesto?: string };

export const metadata = { title: 'Exposición · RAR' };

export default async function ExposicionPage({
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

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const puestos = await listPuestosActivos(supabase, consultora.id);
  const selected = puestos.find((p) => p.id === sp.puesto);

  const [asignados, disponibles] = selected
    ? await Promise.all([
        listAgentesDePuesto(supabase, selected.id),
        listAgentesDisponiblesParaPuesto(supabase, selected.id, consultora.id),
      ])
    : [[], []];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exposición a agentes de riesgo</h1>
        <p className="text-muted-foreground text-sm">
          Declará a qué agentes de riesgo está expuesto cada puesto. Es la base del Relevamiento de
          Agentes de Riesgo (RAR) — los empleados heredan la exposición de sus puestos.
        </p>
      </div>

      <RarTabsNav activeKey="exposicion" />

      {puestos.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No tenés puestos activos. Creá puestos en{' '}
          <Link href="/epp/catalogo/puestos" className="underline">
            el catálogo de puestos
          </Link>{' '}
          antes de declarar la exposición.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">Puesto</p>
            <PuestoSelect puestos={puestos} selectedId={selected?.id} />
          </div>

          {selected ? (
            <PuestoAgentesCard
              puestoId={selected.id}
              puestoNombre={selected.nombre}
              asignados={asignados}
              disponibles={disponibles}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Elegí un puesto para ver y gestionar sus agentes de riesgo.
            </p>
          )}
        </>
      )}
    </div>
  );
}
