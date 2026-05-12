'use client';

import type { AccidenteMetadata } from './schema';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Separator } from '@/shared/ui/separator';

import { formatFecha, Item, StatusBadge } from '../common/summary-ui';
import { gravedadLabel, parteCuerpoLabel, tipoLesionLabel } from './schema';

/**
 * T-022 · Summary read view para tipo='accidente'.
 *
 * Compacto siempre visible: razon_social, fecha+hora, lugar, puesto, gravedad,
 * lesion (resumen). Collapsible: CUIT, domicilio, partes_cuerpo, dias_baja,
 * testigos, descripcion.
 */

type Props = {
  metadata: AccidenteMetadata;
};

export function AccidenteMetadataSummary({ metadata: m }: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const effectiveOpen = open ?? isDesktop;

  // El descripcion_inicial es obligatorio; el opcional es dias_baja_estimados.
  const isComplete = m.dias_baja_estimados !== undefined;
  const lesionesLabel = m.tipo_lesion.map(tipoLesionLabel).join(', ');

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">Datos del accidente</h2>
                <StatusBadge complete={isComplete} />
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Item label="Razón social" value={m.razon_social} />
                <Item
                  label="Fecha y hora"
                  value={`${formatFecha(m.fecha_accidente)} ${m.hora_accidente}`}
                />
                <Item label="Lugar" value={m.lugar_especifico} />
                <Item label="Puesto afectado" value={m.puesto_afectado} />
                <Item label="Gravedad" value={gravedadLabel(m.gravedad)} />
                <Item label="Lesión" value={lesionesLabel} />
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
              <Item
                label="Partes afectadas"
                value={m.partes_cuerpo_afectadas.map(parteCuerpoLabel).join(', ')}
              />
              <Item label="Testigos presentes" value={m.testigos_presentes ? 'Sí' : 'No'} />
              {typeof m.dias_baja_estimados === 'number' && (
                <Item
                  label="Días de baja estimados"
                  value={m.dias_baja_estimados.toLocaleString('es-AR')}
                />
              )}
            </div>

            <div className="pt-2 text-sm">
              <dt className="text-muted-foreground">Descripción inicial:</dt>
              <dd className="mt-1 whitespace-pre-wrap">{m.descripcion_inicial}</dd>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
