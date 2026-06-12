import { CheckCircle2, FileText, HardHat, UserPlus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

type OnboardingWizardProps = {
  /** true si el tenant ya tiene ≥1 cliente activo (habilita el paso 2). */
  hasCliente: boolean;
};

/**
 * T-142 · Banner-wizard del dashboard. Guía los primeros pasos de un tenant
 * nuevo: (1) crear el primer cliente, (2) hacer la primera acción (generar un
 * informe o registrar EPP).
 *
 * T-142 · FU1 · Los botones SOLO navegan. El onboarding se marca completo cuando
 * el usuario realmente crea su primer informe / registra su primera entrega EPP
 * (`markOnboardingCompletedIfPending` en las acciones de esos módulos), no al
 * elegir el camino. Por eso el wizard volvió a ser server component sin estado.
 */
export function OnboardingWizard({ hasCliente }: OnboardingWizardProps) {
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-lg">Empezá en 2 pasos</CardTitle>
        <CardDescription>
          Te guiamos para que generes valor en tu primera sesión. Esto desaparece cuando lo
          completás.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Paso 1 — crear el primer cliente */}
        <div className="flex items-start gap-3">
          <div
            className={
              hasCliente
                ? 'text-primary mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center'
                : 'bg-primary text-primary-foreground mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold'
            }
            aria-hidden="true"
          >
            {hasCliente ? <CheckCircle2 className="h-7 w-7" /> : '1'}
          </div>
          <div className="space-y-1">
            <p className="font-medium leading-tight">
              Creá tu primer cliente
              {hasCliente ? <span className="text-muted-foreground"> · listo</span> : null}
            </p>
            {hasCliente ? (
              <p className="text-muted-foreground text-sm">Ya tenés al menos un cliente cargado.</p>
            ) : (
              <Button asChild variant="default" size="sm" className="mt-1">
                <Link href="/clientes/nuevo">
                  <UserPlus className="h-4 w-4" aria-hidden="true" />
                  Crear cliente
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Paso 2 — fork informe / EPP (sólo con ≥1 cliente) */}
        <div className="flex items-start gap-3">
          <div
            className={
              hasCliente
                ? 'bg-primary text-primary-foreground mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold'
                : 'bg-muted text-muted-foreground mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold'
            }
            aria-hidden="true"
          >
            2
          </div>
          <div className="w-full space-y-3">
            <div className="space-y-1">
              <p className="font-medium leading-tight">Hacé tu primera acción</p>
              {!hasCliente ? (
                <p className="text-muted-foreground text-sm">
                  Se habilita cuando cargues tu primer cliente.
                </p>
              ) : null}
            </div>

            {hasCliente ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="bg-card flex flex-col gap-2 rounded-lg border p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <FileText className="text-primary h-5 w-5" aria-hidden="true" />
                    Generar un informe
                  </div>
                  <p className="text-muted-foreground text-sm">
                    La IA genera el borrador en 5 minutos.
                  </p>
                  <Button asChild size="sm" className="mt-1 self-start">
                    <Link href="/informes/nuevo">Generar informe</Link>
                  </Button>
                </div>

                <div className="bg-card flex flex-col gap-2 rounded-lg border p-4">
                  <div className="flex items-center gap-2 font-medium">
                    <HardHat className="text-primary h-5 w-5" aria-hidden="true" />
                    Registrar EPP
                  </div>
                  <p className="text-muted-foreground text-sm">
                    Los vencimientos se crean automáticamente.
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-1 self-start">
                    <Link href="/epp/entregas/nueva">Registrar EPP</Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
