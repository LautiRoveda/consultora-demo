'use client';

import type { OtrosMetadata } from './schema';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Separator } from '@/shared/ui/separator';

import { Item, StatusBadge } from '../common/summary-ui';

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

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">Datos del informe</h2>
                <StatusBadge complete={isComplete} />
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Item label="Razón social" value={m.razon_social} />
                <Item label="CUIT" value={m.cuit} />
                <Item label="Tema" value={m.tema_informe} />
              </dl>
            </div>

            {m.objetivos && (
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  aria-label={effectiveOpen ? 'Ocultar objetivos' : 'Ver objetivos'}
                >
                  <ChevronDown
                    className={`size-4 transition-transform ${effectiveOpen ? 'rotate-180' : ''}`}
                  />
                </Button>
              </CollapsibleTrigger>
            )}
          </div>

          {m.objetivos && (
            <CollapsibleContent className="space-y-3 pt-4">
              <Separator />
              <div className="pt-2 text-sm">
                <dt className="text-muted-foreground">Objetivos / contexto:</dt>
                <dd className="mt-1 whitespace-pre-wrap">{m.objetivos}</dd>
              </div>
            </CollapsibleContent>
          )}
        </Collapsible>
      </CardContent>
    </Card>
  );
}
