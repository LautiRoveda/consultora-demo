import type { AgenteAsignado, AgenteDisponible } from './queries';

import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { AssignAgenteButton } from './AssignAgenteButton';
import { TIPO_LABELS } from './labels';
import { RemoveAgenteButton } from './RemoveAgenteButton';

interface Props {
  clienteId: string;
  clienteNombre: string;
  puestoId: string;
  puestoNombre: string;
  asignados: AgenteAsignado[];
  disponibles: AgenteDisponible[];
}

export function PuestoAgentesCard({
  clienteId,
  clienteNombre,
  puestoId,
  puestoNombre,
  asignados,
  disponibles,
}: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Agentes de riesgo de {puestoNombre}</CardTitle>
          <CardDescription>
            Agentes a los que está expuesto este puesto en {clienteNombre} (Dto 658/96). Los
            empleados de este establecimiento que ocupan el puesto heredan esta exposición.
          </CardDescription>
        </div>
        <AssignAgenteButton clienteId={clienteId} puestoId={puestoId} disponibles={disponibles} />
      </CardHeader>
      <CardContent>
        {asignados.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Sin agentes de riesgo asignados. Usá «Asignar agente» para declarar la exposición.
          </p>
        ) : (
          <ul className="space-y-3">
            {asignados.map((a) => {
              const archived = a.archived_at !== null;
              return (
                <li
                  key={a.agente_id}
                  className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono text-xs">
                        {a.codigo}
                      </Badge>
                      <span
                        className={cn(
                          'font-medium',
                          archived && 'text-muted-foreground line-through',
                        )}
                      >
                        {a.nombre}
                      </span>
                      <Badge variant="secondary">{TIPO_LABELS[a.agente_tipo]}</Badge>
                      {archived && <Badge variant="secondary">Archivado</Badge>}
                    </div>
                    {a.enfermedad_asociada && (
                      <p className="text-muted-foreground text-sm">{a.enfermedad_asociada}</p>
                    )}
                  </div>
                  <RemoveAgenteButton
                    clienteId={clienteId}
                    puestoId={puestoId}
                    agenteId={a.agente_id}
                    agenteNombre={a.nombre}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
