'use client';

import type { RelevamientoMetadata } from './schema';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Separator } from '@/shared/ui/separator';

import { PersonalizacionSummary } from '../common/PersonalizacionSummary';
import { provinciaName } from '../common/site';
import { formatFecha, Item, StatusBadge } from '../common/summary-ui';
import { agenteHysLabel } from './schema';
import { SECCION_LABEL_BY_ID_RELEVAMIENTO } from './secciones';

/**
 * T-022 · Summary read view para tipo='relevamiento'.
 *
 * Compacto siempre visible: razon_social, sitio (localidad + provincia), fecha,
 * areas count, agentes count. Collapsible: detalle completo + equipos.
 */

type Props = {
  metadata: RelevamientoMetadata;
};

export function RelevamientoMetadataSummary({ metadata: m }: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const effectiveOpen = open ?? isDesktop;

  const isComplete = m.equipos_medicion !== undefined;
  const areasShown = m.areas_relevadas.slice(0, 3);
  const areasMore = m.areas_relevadas.length - areasShown.length;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <h2 className="text-base font-semibold tracking-tight">Datos del relevamiento</h2>
                <StatusBadge complete={isComplete} />
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Item label="Razón social" value={m.razon_social} />
                <Item label="Sitio" value={`${m.localidad}, ${m.provincia}`} />
                <Item label="Fecha" value={formatFecha(m.fecha_relevamiento)} />
                <Item
                  label="Áreas relevadas"
                  value={
                    areasMore > 0
                      ? `${areasShown.join(', ')} +${areasMore} más`
                      : areasShown.join(', ')
                  }
                />
                <Item
                  label="Agentes"
                  value={m.agentes_a_relevar.map((a) => agenteHysLabel(a)).join(', ')}
                />
              </dl>
            </div>

            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                aria-label={effectiveOpen ? 'Ocultar datos completos' : 'Ver datos completos'}
              >
                <ChevronDown
                  className={`size-4 transition-transform ${effectiveOpen ? 'rotate-180' : ''}`}
                />
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="space-y-3 pt-4">
            <Separator />
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 pt-3 text-sm sm:grid-cols-2">
              <Item label="CUIT" value={m.cuit} />
              <Item label="Domicilio" value={m.domicilio} />
              <Item label="Provincia" value={`${provinciaName(m.provincia)} (${m.provincia})`} />
            </div>

            {m.areas_relevadas.length > areasShown.length && (
              <div className="pt-2 text-sm">
                <dt className="text-muted-foreground">Áreas relevadas (completas):</dt>
                <dd className="mt-1">
                  <ul className="ml-4 list-disc space-y-0.5">
                    {m.areas_relevadas.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}

            {m.equipos_medicion && (
              <div className="pt-2 text-sm">
                <dt className="text-muted-foreground">Equipos de medición:</dt>
                <dd className="mt-1 whitespace-pre-wrap">{m.equipos_medicion}</dd>
              </div>
            )}

            <PersonalizacionSummary
              campos={m.campos_personalizados}
              instrucciones={m.instrucciones_adicionales}
              secciones={m.secciones}
              seccionLabelById={SECCION_LABEL_BY_ID_RELEVAMIENTO}
            />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
