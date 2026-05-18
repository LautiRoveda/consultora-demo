'use client';

import type { ClienteRow } from './queries';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

import { ClienteListCard } from './ClienteListCard';
import { ClienteSearchBox } from './ClienteSearchBox';
import { IncludeArchivedToggle } from './IncludeArchivedToggle';

interface Props {
  clientes: ClienteRow[];
  initialQ: string;
  initialIncludeArchived: boolean;
}

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Filter cliente-side: matchea razon_social + nombre_fantasia + cuit (decision
 * Lautaro). CUIT normalize digits-only ambos lados para que tipear sin guiones
 * matchee con DB normalizada `XX-XXXXXXXX-X`. Helper inline (no exportado —
 * solo se usa acá; si T-050 lo necesita, se promueve).
 */
function matchesQuery(cliente: ClienteRow, q: string): boolean {
  const qTrim = q.trim();
  if (qTrim.length === 0) return true;
  const qLower = qTrim.toLowerCase();
  const qDigits = qTrim.replace(/[-\s]/g, '');

  if (cliente.razon_social.toLowerCase().includes(qLower)) return true;
  if (cliente.nombre_fantasia?.toLowerCase().includes(qLower) ?? false) return true;
  if (qDigits.length > 0 && cliente.cuit.replace(/-/g, '').includes(qDigits)) return true;
  return false;
}

export function ClientesList({ clientes, initialQ, initialIncludeArchived }: Props) {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);

  // Debounce URL state push. Solo emit cuando el q estable difiere del
  // initialQ — evita doble-push cuando el server respondio con el mismo q.
  useEffect(() => {
    if (q === initialQ) return;
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (initialIncludeArchived) params.set('archived', '1');
      const qs = params.toString();
      router.push(`/clientes${qs ? `?${qs}` : ''}`);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [q, initialQ, initialIncludeArchived, router]);

  const filtered = useMemo(() => clientes.filter((c) => matchesQuery(c, q)), [clientes, q]);

  // Empty state real: no hay clientes en el tenant. Distinto a "no hay matches
  // con el filtro actual" — ese caso se muestra debajo, después del search box.
  if (clientes.length === 0 && initialQ === '' && !initialIncludeArchived) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="space-y-1">
            <p className="text-foreground text-sm font-medium">Todavía no tenés clientes</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Cargá tus clientes una vez y después los seleccionás del listado al generar informes.
            </p>
          </div>
          <Button asChild>
            <Link href="/clientes/nuevo">Crear primer cliente</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ClienteSearchBox value={q} onChange={setQ} />
        <IncludeArchivedToggle checked={initialIncludeArchived} currentQ={q} />
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Ningún cliente coincide con la búsqueda actual.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((c) => (
            <li key={c.id}>
              <ClienteListCard cliente={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
