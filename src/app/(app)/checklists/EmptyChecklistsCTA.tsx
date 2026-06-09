'use client';

import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { CloneSystemButton } from './CloneSystemButton';

interface Props {
  /** RGRL de sistema a clonar (null si no hay seed cargada). */
  systemTemplateId: string | null;
}

export function EmptyChecklistsCTA({ systemTemplateId }: Props) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
            <ClipboardCheck className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle>Todavía no tenés checklists propios</CardTitle>
            <CardDescription>
              Arrancá personalizando el RGRL de sistema o creá un template desde cero.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          Un checklist es una plantilla de inspección con secciones e ítems (cumple / no aplica, sí
          / no, texto o numérico), criterios críticos y referencias normativas. Publicá una versión
          y después ejecutala en obra.
        </p>
        <div className="flex flex-wrap gap-2">
          {systemTemplateId && (
            <CloneSystemButton
              systemTemplateId={systemTemplateId}
              size="default"
              label="Personalizar RGRL"
            />
          )}
          <Button asChild variant="outline">
            <Link href="/checklists/nuevo">Crear template desde cero</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
