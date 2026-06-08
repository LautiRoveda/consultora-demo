import {
  Bot,
  Calendar,
  ClipboardCheck,
  FileText,
  HardHat,
  ListChecks,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react';
import Link from 'next/link';

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Card, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { ProximosVencimientosPanel } from './ProximosVencimientosPanel';

type DashboardViewProps = {
  showResetSuccess?: boolean;
};

const QUICK_LINKS = [
  {
    href: '/informes',
    icon: FileText,
    title: 'Informes',
    description: 'Generá informes técnicos con IA.',
  },
  {
    href: '/clientes',
    icon: Users,
    title: 'Clientes',
    description: 'Gestioná tu cartera de empresas.',
  },
  {
    href: '/empleados',
    icon: UserCheck,
    title: 'Empleados',
    description: 'Empleados por cliente con tracking.',
  },
  {
    href: '/epp',
    icon: HardHat,
    title: 'EPP',
    description: 'Catálogo, entregas y padrón de EPP.',
  },
  {
    href: '/asistente',
    icon: Bot,
    title: 'Asistente',
    description: 'Consultá tus datos en lenguaje natural.',
  },
  {
    href: '/checklists',
    icon: ClipboardCheck,
    title: 'Checklists',
    description: 'Plantillas de inspección reutilizables.',
  },
  {
    href: '/checklists/ejecuciones',
    icon: ListChecks,
    title: 'Inspecciones',
    description: 'Ejecutá inspecciones en campo.',
  },
  {
    href: '/accidentabilidad',
    icon: ShieldAlert,
    title: 'Accidentabilidad',
    description: 'Incidentes y acciones correctivas.',
  },
  {
    href: '/calendario',
    icon: Calendar,
    title: 'Calendario',
    description: 'Vencimientos y alertas proactivas.',
  },
] as const;

/**
 * Contenido del dashboard.
 *
 * El nombre de la consultora, el plan tier y el menú de cuenta los muestra
 * el `<AppShell>` aguas arriba — acá va el contenido específico de la página:
 *  - Banner post-recovery (T-014).
 *  - Panel "Próximos vencimientos" (T-030) — server async child embedido.
 *  - Sección "Accesos rápidos" con 9 cards a los módulos live (T-095).
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
          Gestioná tus informes, clientes y vencimientos desde un solo lugar.
        </p>
      </header>

      <section aria-labelledby="accesos-rapidos-heading" className="space-y-3">
        <h2
          id="accesos-rapidos-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Accesos rápidos
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {QUICK_LINKS.map(({ href, icon: Icon, title, description }) => (
            <Link
              key={href}
              href={href}
              className="group block rounded-lg outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-all group-hover:border-primary/40 group-hover:shadow-sm">
                <CardHeader>
                  <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-md">
                    <Icon className="size-5" aria-hidden="true" />
                  </div>
                  <CardTitle className="mt-3 text-base">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
