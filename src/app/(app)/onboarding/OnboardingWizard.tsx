'use client';

import { CheckCircle2, ChevronDown, FileText, HardHat, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';

type OnboardingWizardProps = {
  /** true si el tenant ya tiene ≥1 cliente activo (habilita el paso 2). */
  hasCliente: boolean;
  /** Estado de colapso recordado en cookie (leído por el server, evita el flash). */
  defaultCollapsed: boolean;
};

/**
 * T-142 · Banner-wizard del dashboard. Guía los primeros pasos de un tenant
 * nuevo: (1) crear el primer cliente, (2) hacer la primera acción (generar un
 * informe o registrar EPP).
 *
 * T-142 · FU1 · Los botones SOLO navegan. El onboarding se marca completo cuando
 * el usuario realmente crea su primer informe / registra su primera entrega EPP
 * (`markOnboardingCompletedIfPending` en las acciones de esos módulos), no al
 * elegir el camino.
 *
 * T-142 · FU2 · Diseño compacto, colapsable y no intrusivo (NN/G, Appcues, SIDP):
 * header + barra de progreso siempre visibles; el cuerpo (pasos) colapsa. El
 * colapso es estado de UI puro persistido en la cookie `onboarding_collapsed`
 * (sin server action); el server la lee y la pasa como `defaultCollapsed` para
 * SSR sin parpadeo. No toca la lógica de visibilidad/trigger de FU1.
 */
export function OnboardingWizard({ hasCliente, defaultCollapsed }: OnboardingWizardProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const completados = hasCliente ? 1 : 0;

  function onToggle(open: boolean) {
    setCollapsed(!open);
    document.cookie = `onboarding_collapsed=${open ? '0' : '1'}; path=/; max-age=31536000`;
  }

  return (
    <Card className="border-primary/30 bg-primary/5 gap-0 p-4">
      <Collapsible open={!collapsed} onOpenChange={onToggle}>
        {/* Header — siempre visible */}
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 font-medium leading-tight">Configurá tu cuenta</p>
          <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
            {completados} de 2
          </span>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              aria-label={collapsed ? 'Expandir' : 'Colapsar'}
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', !collapsed && 'rotate-180')}
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
        </div>

        {/* Barra de progreso — siempre visible. Paso 2 nunca se marca acá: al
            completarse, el banner deja de renderizarse (FU1). */}
        <div className="mt-2 flex gap-1" aria-hidden="true">
          <div
            className={cn('h-1 flex-1 rounded-full', hasCliente ? 'bg-primary' : 'bg-primary/20')}
          />
          <div className="bg-primary/20 h-1 flex-1 rounded-full" />
        </div>

        {/* Cuerpo colapsable — pasos */}
        <CollapsibleContent className="mt-3 space-y-3">
          {/* Paso 1 — crear el primer cliente, en una línea */}
          {hasCliente ? (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="text-primary h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Primer cliente <span className="text-muted-foreground">· listo</span>
              </span>
            </div>
          ) : (
            <Button asChild size="sm">
              <Link href="/clientes/nuevo">
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Crear cliente
              </Link>
            </Button>
          )}

          {/* Paso 2 — fork informe / EPP (sólo con ≥1 cliente) */}
          {hasCliente ? (
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm">Hacé tu primera acción</p>
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm">
                  <Link href="/informes/nuevo">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    Generar informe
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/epp/entregas/nueva">
                    <HardHat className="h-4 w-4" aria-hidden="true" />
                    Registrar EPP
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
