import 'server-only';

import type { CalendarEventRow } from '../calendario/queries';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertTriangle, Bell, Calendar as CalIcon, CheckCircle2, Clock } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/shared/lib/utils';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { groupEventsByBucket } from '../calendario/agenda-buckets';
import { civilIsoToDate } from '../calendario/event-form-helpers';
import { getOverdueEvents, getUpcomingEvents } from '../calendario/queries';

/**
 * T-030 · Panel "Proximos vencimientos" del dashboard.
 *
 * T-097 · Mixed layout redesign: 3 stat cards arriba (counts grandes con
 * jerarquia visual) + lista top-3 eventos accionables abajo + CTA "Ver agenda
 * completa". Misma data layer (queries paralelas + groupEventsByBucket).
 *
 * Empty state: CheckCircle verde + copy motivacional + CTA hacia /calendario.
 */
export async function ProximosVencimientosPanel() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  // Top 3 ordenados por urgencia: overdue/hoy primero (groupEventsByBucket
  // ya ubica overdue en `hoy`), despues siete, despues treinta.
  const topEvents = [...buckets.hoy, ...buckets.siete, ...buckets.treinta].slice(0, 3);

  if (totalCount === 0) {
    return (
      <Card data-testid="vencimientos-panel-empty">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalIcon className="h-4 w-4" aria-hidden="true" />
            Próximos vencimientos
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 py-6 text-center">
          <span className="bg-severity-ok/10 text-severity-ok mx-auto flex size-12 items-center justify-center rounded-full">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="text-foreground font-medium">Todo al día</p>
            <p className="text-muted-foreground text-sm">
              No tenés vencimientos próximos. Aprovechá para sumar uno nuevo.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
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
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
            count={hoyCount}
            label="Hoy"
            sublabel={hoyCount === 1 ? 'urgente' : 'urgentes'}
            variant="destructive"
            testId="stat-hoy"
          />
          <StatCard
            icon={<Bell className="h-5 w-5" aria-hidden="true" />}
            count={sieteCount}
            label="Esta semana"
            sublabel={sieteCount === 1 ? 'próximo' : 'próximos'}
            variant="primary"
            testId="stat-siete"
          />
          <StatCard
            icon={<Clock className="h-5 w-5" aria-hidden="true" />}
            count={treintaCount}
            label="Este mes"
            sublabel="a futuro"
            variant="muted"
            testId="stat-treinta"
          />
        </div>

        {topEvents.length > 0 && (
          <div className="space-y-2">
            <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Lo más urgente
            </div>
            <ul className="space-y-1">
              {topEvents.map((ev) => {
                const isUrgent = buckets.hoy.includes(ev);
                return (
                  <li key={ev.id}>
                    <Link
                      href={`/calendario/agenda?event=${ev.id}`}
                      className="group bg-card hover:border-border/80 hover:bg-accent/40 flex items-start justify-between gap-3 rounded-md border px-3 py-2.5 transition-colors"
                      data-testid={`urgent-event-${ev.id}`}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        {isUrgent ? (
                          <AlertTriangle
                            className="text-destructive mt-0.5 h-4 w-4 shrink-0"
                            aria-hidden="true"
                          />
                        ) : (
                          <Bell
                            className="text-primary mt-0.5 h-4 w-4 shrink-0"
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{ev.titulo}</p>
                          <p className="text-muted-foreground text-xs">{formatEventDate(ev)}</p>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <Link
          href="/calendario/agenda"
          className="text-primary inline-flex items-center text-sm font-medium hover:underline"
          data-testid="panel-ver-todos"
        >
          Ver agenda completa →
        </Link>
      </CardContent>
    </Card>
  );
}

type StatVariant = 'destructive' | 'primary' | 'muted';

function StatCard({
  icon,
  count,
  label,
  sublabel,
  variant,
  testId,
}: {
  icon: React.ReactNode;
  count: number;
  label: string;
  sublabel: string;
  variant: StatVariant;
  testId: string;
}) {
  const isEmpty = count === 0;
  const containerClasses = cn(
    'flex flex-col items-start gap-1 rounded-lg border p-3 transition-opacity',
    isEmpty && 'opacity-50',
    variant === 'destructive' && !isEmpty && 'bg-destructive/5 border-destructive/30',
    variant === 'primary' && !isEmpty && 'bg-primary/5 border-primary/30',
    variant === 'muted' && 'bg-muted/30',
  );
  const iconClasses = cn(
    'flex items-center justify-center rounded-md p-1.5',
    variant === 'destructive' && 'bg-destructive/15 text-destructive',
    variant === 'primary' && 'bg-primary/15 text-primary',
    variant === 'muted' && 'bg-muted text-muted-foreground',
  );
  return (
    <div className={containerClasses} data-testid={testId} data-count={count}>
      <span className={iconClasses}>{icon}</span>
      <div className="mt-1">
        <div className="text-2xl font-bold leading-tight">{count}</div>
        <div className="text-muted-foreground text-xs">
          <span className="text-foreground font-medium">{label}</span> · {sublabel}
        </div>
      </div>
    </div>
  );
}

function formatEventDate(ev: CalendarEventRow): string {
  const eventDate = civilIsoToDate(ev.fecha_vencimiento);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = eventDate.getTime() - today.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    const abs = Math.abs(diffDays);
    return `Venció hace ${abs} ${abs === 1 ? 'día' : 'días'}`;
  }
  if (diffDays === 0) return 'Vence hoy';
  if (diffDays === 1) return 'Vence mañana';
  if (diffDays <= 7) return `Vence en ${diffDays} días`;
  return format(eventDate, "d 'de' LLLL", { locale: es });
}
