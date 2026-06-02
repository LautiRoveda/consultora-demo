'use client';

import type { IncidenteFilterValues } from './IncidenteFilters';
import type { IncidenteVigente } from './queries';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Input } from '@/shared/ui/input';

import { IncidenteFilters } from './IncidenteFilters';
import { IncidenteListCard } from './IncidenteListCard';

type ClienteOption = { id: string; razon_social: string };

interface Props {
  incidentes: IncidenteVigente[];
  clienteOptions: ClienteOption[];
  initial: IncidenteFilterValues;
  /** true si hay algún filtro estructurado activo (tipo/cliente/fecha/gravedad). */
  hasActiveFilters: boolean;
}

/**
 * T-063 · Listado de incidentes vigentes. Los filtros estructurados se resuelven
 * server-side (la `incidentes` prop ya viene filtrada); acá aplicamos sólo el
 * filtro client-side de gravedad (no soportado por `getIncidentes`) + búsqueda
 * libre por descripción/lugar. Dos empty-states distintos, como `ClientesList`.
 */
export function IncidentesList({ incidentes, clienteOptions, initial, hasActiveFilters }: Props) {
  const [q, setQ] = useState('');

  const clienteById = useMemo(
    () => new Map(clienteOptions.map((c) => [c.id, c.razon_social])),
    [clienteOptions],
  );

  // Sólo free-text client-side: tipo/cliente/fecha/gravedad se filtran server-side
  // (la prop `incidentes` ya viene filtrada por `getIncidentes`).
  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    if (qLower.length === 0) return incidentes;
    return incidentes.filter((i) => {
      const haystack = `${i.descripcion ?? ''} ${i.lugar_especifico ?? ''}`.toLowerCase();
      return haystack.includes(qLower);
    });
  }, [incidentes, q]);

  // Empty-state real: no hay incidentes en el tenant y no hay filtros activos.
  // Distinto a "ningún incidente coincide con los filtros".
  if (incidentes.length === 0 && !hasActiveFilters) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="space-y-1">
            <p className="text-foreground text-sm font-medium">Todavía no registraste incidentes</p>
            <p className="text-muted-foreground max-w-md text-sm">
              Llevá el libro de incidentes: registrá casi-accidentes y accidentes para tener la
              trazabilidad al día.
            </p>
          </div>
          <Button asChild>
            <Link href="/accidentabilidad/nuevo">Registrar primer incidente</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <IncidenteFilters initial={initial} clienteOptions={clienteOptions} />

      <div className="relative w-full sm:max-w-sm">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden="true"
        />
        <Input
          type="search"
          placeholder="Buscar por descripción o lugar…"
          className="pl-9"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Buscar incidentes"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">
          Ningún incidente coincide con los filtros actuales.
        </p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((i) => (
            <li key={i.id ?? ''}>
              <IncidenteListCard
                incidente={i}
                clienteNombre={i.cliente_id ? clienteById.get(i.cliente_id) : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
