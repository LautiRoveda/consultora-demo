'use client';

import type { OtrosMetadata } from './schema';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Separator } from '@/shared/ui/separator';

import { PersonalizacionSummary } from '../common/PersonalizacionSummary';
import { Item, StatusBadge } from '../common/summary-ui';
import { SECCION_LABEL_BY_ID_OTROS } from './secciones';

/**
 * T-022 · Summary read view para tipo='otros' (wildcard).
 *
 * Compacto: razon_social, cuit, tema. Collapsible: objetivos.
 */

type Props = {
  metadata: OtrosMetadata;
};

export function OtrosMetadataSummary({ metadata: m }: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState<boolean | undefined>(undefined);
  const effectiveOpen = open ?? isDesktop;

  const isComplete = m.objetivos !== undefined;
  // El Collapsible solo existe si hay detalle que mostrar (objetivos y/o
  // personalizacion T-138) — sin detalle, el resumen compacto es todo.
  const hasPersonalizacion =
    (m.campos_personalizados !== undefined && m.campos_personalizados.length > 0) ||
    m.instrucciones_adicionales !== undefined ||
    (m.secciones !== undefined && m.secciones.length > 0);
  const hasDetalle = m.objetivos !== undefined || hasPersonalizacion;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <h2 className="text-base font-semibold tracking-tight">Datos del informe</h2>
                <StatusBadge complete={isComplete} />
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Item label="Razón social" value={m.razon_social} />
                <Item label="CUIT" value={m.cuit} />
                <Item label="Tema" value={m.tema_informe} />
              </dl>
            </div>

            {hasDetalle && (
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
            )}
          </div>

          {hasDetalle && (
            <CollapsibleContent className="space-y-3 pt-4">
              <Separator />
              {m.objetivos && (
                <div className="pt-2 text-sm">
                  <dt className="text-muted-foreground">Objetivos / contexto:</dt>
                  <dd className="mt-1 whitespace-pre-wrap">{m.objetivos}</dd>
                </div>
              )}

              <PersonalizacionSummary
                campos={m.campos_personalizados}
                instrucciones={m.instrucciones_adicionales}
                secciones={m.secciones}
                seccionLabelById={SECCION_LABEL_BY_ID_OTROS}
              />
            </CollapsibleContent>
          )}
        </Collapsible>
      </CardContent>
    </Card>
  );
}
