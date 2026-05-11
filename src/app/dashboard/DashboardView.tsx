import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { signOutAction } from './actions';

interface ConsultoraSummary {
  id: string;
  slug: string;
  name: string;
  plan_tier: string;
  trial_ends_at: string | null;
}

interface DashboardViewProps {
  email: string;
  role: string;
  consultora: ConsultoraSummary;
}

/**
 * Vista del dashboard stub (T-013). T-017 va a reemplazar esto con el
 * dashboard productivo (sidebar + módulos del roadmap Fase 1).
 *
 * Server Component — el botón de logout invoca `signOutAction` via form
 * action, sin necesitar interactividad cliente.
 */
export function DashboardView({ email, role, consultora }: DashboardViewProps) {
  const trialEnds = consultora.trial_ends_at ? new Date(consultora.trial_ends_at) : null;
  const trialEndsLabel = trialEnds
    ? trialEnds.toLocaleDateString('es-AR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Hola, {email}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Estás logueado como <strong className="font-medium">{role}</strong> de{' '}
            <strong className="font-medium">{consultora.name}</strong> (
            <code className="bg-muted rounded px-1 py-0.5 text-xs">{consultora.slug}</code>
            ).
          </p>
          <p>
            Plan actual: <strong className="font-medium">{consultora.plan_tier}</strong>
            {consultora.plan_tier === 'trial' && trialEndsLabel
              ? `. Trial vence el ${trialEndsLabel}.`
              : '.'}
          </p>
          <p className="text-muted-foreground border-t pt-3">
            La app productiva (informes, calendario, EPP, …) llega a partir de T-017. Por ahora
            estás viendo el dashboard stub que confirma que login + RLS funcionan.
          </p>
          <form action={signOutAction} className="pt-2">
            <Button type="submit" variant="outline">
              Cerrar sesión
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
