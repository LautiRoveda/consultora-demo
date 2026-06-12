'use client';

import type { OnboardingDestination } from './schema';
import { CheckCircle2, FileText, HardHat, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { completeOnboardingAction } from './actions';

type OnboardingWizardProps = {
  /** true si el tenant ya tiene ≥1 cliente activo (habilita el paso 2). */
  hasCliente: boolean;
};

/**
 * T-142 · Banner-wizard del dashboard. Guía los primeros pasos de un tenant
 * nuevo: (1) crear el primer cliente, (2) elegir el primer camino (informe o
 * EPP). Al elegir, marca `onboarding_completado_at` y redirige — desde ahí el
 * banner no vuelve a renderizar (el dashboard lo gatea con `showOnboarding`).
 */
export function OnboardingWizard({ hasCliente }: OnboardingWizardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function choose(destination: OnboardingDestination) {
    startTransition(async () => {
      const result = await completeOnboardingAction({ destination });
      if (result.ok) {
        router.push(result.redirectTo);
        return;
      }
      if (result.code === 'ALREADY_DONE') {
        // Idempotente: ya estaba completo, igual llevamos al destino elegido.
        router.push(destination);
        return;
      }
      toast.error('No se pudo continuar', { description: result.message });
    });
  }

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
                  <Button
                    type="button"
                    size="sm"
                    className="mt-1 self-start"
                    disabled={isPending}
                    onClick={() => choose('/informes/nuevo')}
                  >
                    Generar informe
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1 self-start"
                    disabled={isPending}
                    onClick={() => choose('/epp/entregas/nueva')}
                  >
                    Registrar EPP
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
