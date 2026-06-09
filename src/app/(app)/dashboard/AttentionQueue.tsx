import type { AttentionEntry } from './queries';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/shared/lib/utils';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';

import { EVENT_TIPO_LABELS } from '../calendario/labels';
import { drillToAction } from './drill-to-action';
import { formatEventDate } from './format';

/**
 * T-131 · "Lo que necesita tu atención" — la sección estrella del tablero.
 *
 * Cola priorizada por urgencia (vencido → rojo; por vencer → ámbar), cada ítem
 * con su CTA drill-to-action según el tipo de evento. Semáforo con ícono + texto
 * (no solo color, accesibilidad). Heading semántico real (`<h2>`), NO `CardTitle`
 * (que es un `<div>`).
 */
export function AttentionQueue({ items }: { items: AttentionEntry[] }) {
  if (items.length === 0) {
    return (
      <Card data-testid="attention-queue-empty">
        <CardHeader>
          <h2 className="text-base font-semibold">Lo que necesita tu atención</h2>
        </CardHeader>
        <CardContent className="space-y-4 py-6 text-center">
          <span className="bg-severity-ok/10 text-severity-ok mx-auto flex size-12 items-center justify-center rounded-full">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="text-foreground font-medium">Todo al día</p>
            <p className="text-muted-foreground text-sm">
              No tenés vencimientos próximos ni vencidos. Aprovechá para sumar uno nuevo.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href="/calendario">Ir al calendario</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="attention-queue">
      <CardHeader>
        <h2 className="text-base font-semibold">Lo que necesita tu atención</h2>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {items.map(({ ev, severity }) => {
            const action = drillToAction(ev);
            const overdue = severity === 'overdue';
            return (
              <li
                key={ev.id}
                data-testid={`attention-item-${ev.id}`}
                className="flex flex-col gap-3 rounded-md border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    className={cn(
                      'inline-flex w-fit items-center gap-1 text-xs font-medium',
                      overdue ? 'text-destructive' : 'text-amber-600 dark:text-amber-500',
                    )}
                  >
                    {overdue ? (
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {overdue ? 'Vencido' : 'Por vencer'}
                  </span>
                  <p className="truncate text-sm font-medium">{ev.titulo}</p>
                  <p className="text-muted-foreground text-xs">
                    {EVENT_TIPO_LABELS[ev.tipo as keyof typeof EVENT_TIPO_LABELS] ?? ev.tipo} ·{' '}
                    {formatEventDate(ev)}
                  </p>
                </div>
                <Button
                  asChild
                  size="sm"
                  variant={action.kind === 'pilar' ? 'default' : 'outline'}
                  className="shrink-0 sm:w-auto"
                >
                  <Link href={action.href}>{action.label}</Link>
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
