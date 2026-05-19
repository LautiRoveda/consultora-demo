'use client';

import type { EmpleadoRow } from './queries';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { normalizeDni } from '@/shared/templates/common/dni';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

import { EmpleadoListCard } from './EmpleadoListCard';
import { EmpleadoSearchBox } from './EmpleadoSearchBox';
import { IncludeArchivedToggle } from './IncludeArchivedToggle';

interface Props {
  clienteId: string;
  empleados: EmpleadoRow[];
  initialQ: string;
  initialIncludeArchived: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Filter cliente-side: matchea apellido OR nombre OR DNI digits-only. DNI
 * normaliza ambos lados (input + row) para que tipear con/sin puntos matchee.
 */
function matchesQuery(empleado: EmpleadoRow, q: string): boolean {
  const qTrim = q.trim();
  if (qTrim.length === 0) return true;
  const qLower = qTrim.toLowerCase();
  const qDigits = normalizeDni(qTrim);

  if (empleado.apellido.toLowerCase().includes(qLower)) return true;
  if (empleado.nombre.toLowerCase().includes(qLower)) return true;
  if (qDigits.length > 0 && empleado.dni.includes(qDigits)) return true;
  return false;
}

function buildHref(clienteId: string, q: string, includeArchived: boolean): string {
  const params = new URLSearchParams();
  params.set('cliente_id', clienteId);
  if (q) params.set('q', q);
  if (includeArchived) params.set('archived', '1');
  return `/empleados?${params.toString()}`;
}

export function EmpleadosList({ clienteId, empleados, initialQ, initialIncludeArchived }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);

  useEffect(() => {
    if (q === initialQ) return;
    const handle = setTimeout(() => {
      router.push(buildHref(clienteId, q, initialIncludeArchived));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [q, initialQ, initialIncludeArchived, clienteId, router]);

  const filtered = useMemo(() => empleados.filter((e) => matchesQuery(e, q)), [empleados, q]);

  // Empty state primario: ningún empleado en el cliente (sin filtros). Muestra
  // CTA + toggle "Ver archivados" visible (cierra T-049-FU2 — toggle accesible
  // desde empty state).
  if (empleados.length === 0 && initialQ === '' && !initialIncludeArchived) {
    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <IncludeArchivedToggle
            clienteId={clienteId}
            checked={initialIncludeArchived}
            currentQ=""
          />
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="space-y-1">
              <p className="text-foreground text-sm font-medium">
                Todavía no tenés empleados en este cliente
              </p>
              <p className="text-muted-foreground max-w-md text-sm">
                Cargá los empleados del cliente una vez y después los seleccionás del listado al
                generar planillas de EPP o capacitaciones.
              </p>
            </div>
            <Button asChild>
              <Link href={`/empleados/nuevo?cliente_id=${clienteId}`}>Crear primer empleado</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <EmpleadoSearchBox value={q} onChange={setQ} />
        <IncludeArchivedToggle
          clienteId={clienteId}
          checked={initialIncludeArchived}
          currentQ={q}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Ningún empleado coincide con la búsqueda actual.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((e) => (
            <li key={e.id}>
              <EmpleadoListCard empleado={e} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
