import 'server-only';

import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, Bell, Calendar as CalIcon, Clock } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/shared/lib/utils';
import { createClient } from '@/shared/supabase/server';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { groupEventsByBucket } from '../calendario/agenda-buckets';
import { civilIsoToDate } from '../calendario/event-form-helpers';
import { getOverdueEvents, getUpcomingEvents } from '../calendario/queries';

/**
 * T-030 · Panel "Proximos vencimientos" del dashboard.
 *
 * Server component embebido en DashboardView. Hace fetch directo en server
 * (2 queries paralelas) + reusa `groupEventsByBucket` del modulo Calendario
 * para derivar counts + "mas urgente" sin duplicar logica de rangos.
 *
 * Visual:
 *  - 3 CountRow: Hoy (destructive) / 7d (primary) / 30d (muted)
 *  - "Mas urgente": primer evento del primer bucket no-vacio. Link al drawer
 *    via `?event=<uuid>` en /calendario/agenda.
 *  - "Ver todos →" link a /calendario/agenda.
 *
 * Empty state: si totalCount=0 → fallback con CTA "Crear vencimiento" hacia
 * /calendario (vista mensual, landing canonico del modulo).
 */
export async function ProximosVencimientosPanel() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensa: el layout `(app)` ya valida sesion. Si llegamos aca sin user es
  // un edge case; no renderizamos para evitar exception en runtime.
  if (!user) return null;

  const [upcoming, overdue] = await Promise.all([
    getUpcomingEvents(supabase, 30),
    getOverdueEvents(supabase),
  ]);

  const buckets = groupEventsByBucket([...overdue, ...upcoming], new Date());
  const hoyCount = buckets.hoy.length;
  const sieteCount = buckets.siete.length;
  const treintaCount = buckets.treinta.length;
  const totalCount = hoyCount + sieteCount + treintaCount;

  // "Mas urgente" sale del primer bucket no-vacio. Los buckets ya estan sort
  // ASC; en hoy[0] el primero es el overdue mas viejo (mas vencido = mas urgente).
  const masUrgente = buckets.hoy[0] ?? buckets.siete[0] ?? buckets.treinta[0] ?? null;

  if (totalCount === 0) {
    return (
      <Card data-testid="vencimientos-panel-empty">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalIcon className="h-4 w-4" aria-hidden="true" />
            Próximos vencimientos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">No hay vencimientos próximos.</p>
          <Button asChild size="sm">
            <Link href="/calendario">Crear vencimiento</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="vencimientos-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalIcon className="h-4 w-4" aria-hidden="true" />
          Próximos vencimientos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-1.5">
          <CountRow
            icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            label="Hoy"
            count={hoyCount}
            variant="destructive"
            testId="count-hoy"
          />
          <CountRow
            icon={<Bell className="h-4 w-4" aria-hidden="true" />}
            label="En 7 días"
            count={sieteCount}
            variant="primary"
            testId="count-siete"
          />
          <CountRow
            icon={<Clock className="h-4 w-4" aria-hidden="true" />}
            label="En 30 días"
            count={treintaCount}
            variant="muted"
            testId="count-treinta"
          />
        </ul>

        {masUrgente && (
          <div className="border-t pt-3">
            <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Más urgente
            </div>
            <Link
              href={`/calendario/agenda?event=${masUrgente.id}`}
              className="hover:underline mt-1 block text-sm font-medium"
              data-testid="panel-mas-urgente"
            >
              {masUrgente.titulo}
              <span className="text-muted-foreground ml-1 font-normal">
                ·{' '}
                {format(civilIsoToDate(masUrgente.fecha_vencimiento), "d 'de' LLLL", {
                  locale: es,
                })}
              </span>
            </Link>
          </div>
        )}

        <Link
          href="/calendario/agenda"
          className="text-primary inline-flex items-center text-sm font-medium hover:underline"
          data-testid="panel-ver-todos"
        >
          Ver todos →
        </Link>
      </CardContent>
    </Card>
  );
}

type CountVariant = 'destructive' | 'primary' | 'muted';

function CountRow({
  icon,
  label,
  count,
  variant,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  variant: CountVariant;
  testId: string;
}) {
  const badgeClasses = cn(
    'text-xs',
    variant === 'destructive' && 'bg-destructive/15 text-destructive border-destructive/30 border',
    variant === 'primary' && 'bg-primary/15 text-primary border-primary/30 border',
    variant === 'muted' && 'bg-muted text-muted-foreground border-border border',
  );
  return (
    <li
      className="flex items-center justify-between text-sm"
      data-testid={testId}
      data-count={count}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      <Badge className={badgeClasses}>{count}</Badge>
    </li>
  );
}
