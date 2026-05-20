import { FileText, HardHat, Users } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Card, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { ProximosVencimientosPanel } from './ProximosVencimientosPanel';

type DashboardViewProps = {
  showResetSuccess?: boolean;
};

/**
 * Contenido del dashboard.
 *
 * El nombre de la consultora, el plan tier y el menú de cuenta los muestra
 * el `<AppShell>` aguas arriba — acá va el contenido específico de la página:
 *  - Banner post-recovery (T-014).
 *  - Panel "Próximos vencimientos" (T-030) — server async child embedido.
 *  - Cards "Próximamente" de features faltantes (Informes ya live; Clientes/
 *    EPP siguen pending — drift legacy fuera de scope T-030).
 *
 * Server component sync con async child: React Server Components soporta
 * embed async children sin convertir el padre a async.
 */
export function DashboardView({ showResetSuccess }: DashboardViewProps) {
  return (
    <div className="space-y-8">
      {showResetSuccess ? (
        <Alert>
          <AlertTitle>Contraseña actualizada</AlertTitle>
          <AlertDescription>Tu nueva contraseña ya está activa.</AlertDescription>
        </Alert>
      ) : null}

      <ProximosVencimientosPanel />

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-balance break-words">
          Bienvenido a ConsultoraDemo
        </h1>
        <p className="text-muted-foreground text-sm">
          Pronto vas a poder gestionar informes técnicos, clientes, EPP y vencimientos desde acá.
        </p>
      </header>

      <section aria-labelledby="proximamente-heading" className="space-y-3">
        <h2
          id="proximamente-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Próximamente
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<FileText className="size-5" aria-hidden="true" />}
            title="Informes"
            description="Generá informes técnicos en minutos con IA."
            ticket="T-019"
          />
          <FeatureCard
            icon={<Users className="size-5" aria-hidden="true" />}
            title="Clientes"
            description="Tu cartera de empresas con todos sus datos."
            ticket="T-020"
          />
          <FeatureCard
            icon={<HardHat className="size-5" aria-hidden="true" />}
            title="EPP"
            description="Tracking de entregas y planilla Res. 299/11."
            ticket="T-022"
          />
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  ticket,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  ticket: string;
}) {
  return (
    <Card className="opacity-80">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-md">
            {icon}
          </div>
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {ticket}
          </span>
        </div>
        <CardTitle className="mt-3 text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
