import type { PuestoAsignado, PuestoDisponible } from './puestos/queries';

import { cn } from '@/shared/lib/utils';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { AssignPuestoButton } from './AssignPuestoButton';
import { RemovePuestoButton } from './RemovePuestoButton';

const MAX_RIESGOS_VISIBLES = 5;

interface Props {
  empleadoId: string;
  empleadoFullName: string;
  asignados: PuestoAsignado[];
  disponibles: PuestoDisponible[];
}

/**
 * T-103 · Card "Puestos laborales" en el detail del empleado. Lista puestos
 * asignados (M:N empleados_puestos) con CTA Asignar/Quitar. Puestos archivados
 * que siguen asignados se muestran con badge "archivado" + nombre dim — el
 * consultor puede limpiar la asignación huérfana manualmente.
 *
 * Alimenta T-106 (IA sugerencia EPP por puesto). NO bloquea por billing —
 * matchea el resto del detail empleado (any-member del tenant).
 */
export function PuestosCard({ empleadoId, empleadoFullName, asignados, disponibles }: Props) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle>Puestos laborales</CardTitle>
          <CardDescription>
            Vinculá puestos del catálogo. Habilita la IA de sugerencia de EPP por puesto
            (próximamente).
          </CardDescription>
        </div>
        <AssignPuestoButton empleadoId={empleadoId} disponibles={disponibles} />
      </CardHeader>
      <CardContent>
        {asignados.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Sin puestos asignados. Asigná uno para que la IA pueda sugerir EPP recomendado
            (próximamente).
          </p>
        ) : (
          <ul className="space-y-3">
            {asignados.map((p) => {
              const archived = p.archived_at !== null;
              const riesgos = p.riesgos_asociados ?? [];
              const visibles = riesgos.slice(0, MAX_RIESGOS_VISIBLES);
              const restantes = riesgos.length - visibles.length;
              return (
                <li
                  key={p.puesto_id}
                  className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          'font-medium',
                          archived && 'text-muted-foreground line-through',
                        )}
                      >
                        {p.nombre}
                      </span>
                      {archived && <Badge variant="secondary">Archivado</Badge>}
                    </div>
                    {p.descripcion && (
                      <p className="text-muted-foreground line-clamp-2 text-sm">{p.descripcion}</p>
                    )}
                    {visibles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {visibles.map((r) => (
                          <Badge key={r} variant="outline">
                            {r}
                          </Badge>
                        ))}
                        {restantes > 0 && <Badge variant="outline">+{restantes} más</Badge>}
                      </div>
                    )}
                  </div>
                  <RemovePuestoButton
                    empleadoId={empleadoId}
                    puestoId={p.puesto_id}
                    puestoNombre={p.nombre}
                    empleadoFullName={empleadoFullName}
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
