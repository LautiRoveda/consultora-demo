'use client';

import type { CapacitacionMetadata } from './schema';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Separator } from '@/shared/ui/separator';

import { formatFecha, Item, StatusBadge } from '../common/summary-ui';
import { modalidadCapacitacionLabel } from './schema';

/**
 * T-022 · Summary read view para tipo='capacitacion'.
 *
 * Compacto siempre visible: razon_social, fecha, tema, modalidad, capacitador,
 * asistentes. Collapsible: CUIT, domicilio, duracion, matricula, contenidos.
 */

type Props = {
  metadata: CapacitacionMetadata;
};

export function CapacitacionMetadataSummary({ metadata: m }: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const effectiveOpen = open ?? isDesktop;

  const isComplete = m.capacitador_matricula !== undefined && m.contenidos_resumen !== undefined;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">Datos de la capacitación</h2>
                <StatusBadge complete={isComplete} />
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Item label="Razón social" value={m.razon_social} />
                <Item label="Fecha" value={formatFecha(m.fecha_capacitacion)} />
                <Item label="Tema" value={m.tema_principal} />
                <Item label="Modalidad" value={modalidadCapacitacionLabel(m.modalidad)} />
                <Item label="Capacitador" value={m.capacitador_nombre} />
                <Item
                  label="Asistentes previstos"
                  value={m.cantidad_asistentes_prevista.toLocaleString('es-AR')}
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
              <Item label="Duración" value={`${m.duracion_horas} h`} />
              {m.capacitador_matricula && (
                <Item label="Matrícula" value={m.capacitador_matricula} />
              )}
            </div>

            {m.contenidos_resumen && (
              <div className="pt-2 text-sm">
                <dt className="text-muted-foreground">Contenidos resumidos:</dt>
                <dd className="mt-1 whitespace-pre-wrap">{m.contenidos_resumen}</dd>
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
