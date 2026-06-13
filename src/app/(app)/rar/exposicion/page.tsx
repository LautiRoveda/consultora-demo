import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getClientesForConsultora } from '@/app/(app)/clientes/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { ClienteSelect } from '../ClienteSelect';
import { PuestoAgentesCard } from '../PuestoAgentesCard';
import { PuestoSelect } from '../PuestoSelect';
import {
  listAgentesDeClientePuesto,
  listAgentesDisponiblesParaPuesto,
  listPuestosDeCliente,
} from '../queries';
import { RarTabsNav } from '../RarTabsNav';

type SearchParams = { cliente?: string; puesto?: string };

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

  const clientes = await getClientesForConsultora(supabase);
  const selectedCliente = clientes.find((c) => c.id === sp.cliente);

  const puestos = selectedCliente ? await listPuestosDeCliente(supabase, selectedCliente.id) : [];
  const selectedPuesto = puestos.find((p) => p.id === sp.puesto);

  const [asignados, disponibles] =
    selectedCliente && selectedPuesto
      ? await Promise.all([
          listAgentesDeClientePuesto(supabase, selectedCliente.id, selectedPuesto.id),
          listAgentesDisponiblesParaPuesto(
            supabase,
            selectedCliente.id,
            selectedPuesto.id,
            consultora.id,
          ),
        ])
      : [[], []];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Exposición a agentes de riesgo</h1>
        <p className="text-muted-foreground text-sm">
          El RAR es por establecimiento. Elegí un cliente y declará a qué agentes de riesgo está
          expuesto cada puesto en ese establecimiento — los empleados heredan la exposición de su
          cliente × sus puestos.
        </p>
      </div>

      <RarTabsNav activeKey="exposicion" />

      {clientes.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          No tenés clientes activos. Creá clientes en{' '}
          <Link href="/clientes" className="underline">
            el módulo de Clientes
          </Link>{' '}
          antes de declarar la exposición.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm font-medium">Cliente / establecimiento</p>
            <ClienteSelect
              clientes={clientes}
              selectedId={selectedCliente?.id}
              basePath="/rar/exposicion"
            />
          </div>

          {selectedCliente ? (
            puestos.length === 0 ? (
              <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
                {selectedCliente.razon_social} no tiene puestos con empleados activos. Asigná
                puestos a sus empleados en{' '}
                <Link href="/empleados" className="underline">
                  el módulo de Empleados
                </Link>{' '}
                para declarar la exposición.
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-sm font-medium">Puesto</p>
                  <PuestoSelect
                    puestos={puestos}
                    selectedId={selectedPuesto?.id}
                    clienteId={selectedCliente.id}
                  />
                </div>

                {selectedPuesto ? (
                  <PuestoAgentesCard
                    clienteId={selectedCliente.id}
                    clienteNombre={selectedCliente.razon_social}
                    puestoId={selectedPuesto.id}
                    puestoNombre={selectedPuesto.nombre}
                    asignados={asignados}
                    disponibles={disponibles}
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Elegí un puesto para ver y gestionar sus agentes de riesgo en este
                    establecimiento.
                  </p>
                )}
              </>
            )
          ) : (
            <p className="text-muted-foreground text-sm">
              Elegí un cliente para ver sus puestos y declarar la exposición.
            </p>
          )}
        </>
      )}
    </div>
  );
}
