'use client';

import type { CalendarEventRow } from './queries';
import { useState } from 'react';

import { formatCivilDateLongAR } from '@/shared/lib/format-date';
import { cn } from '@/shared/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';

import { dateToCivilIso } from './event-form-helpers';

const VISIBLE_LIMIT = 3;

/**
 * T-029 · Variant del badge segun estado del evento + comparacion con today.
 *
 * pending + fecha < today  → destructive (vencido)
 * completed                → success con line-through
 * cancelled                → muted con line-through y opacity
 * pending                  → primary (default)
 */
function badgeClassesFor(ev: CalendarEventRow, todayIso: string): string {
  if (ev.status === 'completed') {
    return 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 line-through dark:text-emerald-400';
  }
  if (ev.status === 'cancelled') {
    return 'bg-muted text-muted-foreground border-border line-through opacity-60';
  }
  if (ev.status === 'pending' && ev.fecha_vencimiento < todayIso) {
    return 'bg-destructive/15 text-destructive border-destructive/30';
  }
  return 'bg-primary/15 text-primary border-primary/30';
}

type Props = {
  date: Date;
  eventsOfDay: CalendarEventRow[];
  isCurrentMonth: boolean;
  todayIso: string;
  onClickDay: (fechaIso: string) => void;
  onClickEvent: (eventId: string) => void;
};

export function CalendarMonthCell({
  date,
  eventsOfDay,
  isCurrentMonth,
  todayIso,
  onClickDay,
  onClickEvent,
}: Props) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const cellIso = dateToCivilIso(date);
  const isToday = cellIso === todayIso;
  const visible = eventsOfDay.slice(0, VISIBLE_LIMIT);
  const hidden = eventsOfDay.slice(VISIBLE_LIMIT);

  // Click background: solo crea si no hay eventos en el dia (preserva expectativa
  // del wireframe 8.1 — eventos se previenen con stopPropagation).
  function onCellClick() {
    if (eventsOfDay.length === 0) onClickDay(cellIso);
  }

  return (
    <div
      role={eventsOfDay.length === 0 ? 'button' : undefined}
      tabIndex={eventsOfDay.length === 0 ? 0 : -1}
      onClick={onCellClick}
      onKeyDown={(e) => {
        if (eventsOfDay.length === 0 && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClickDay(cellIso);
        }
      }}
      data-testid={`cell-${cellIso}`}
      className={cn(
        'flex min-h-[88px] flex-col gap-1 border border-border bg-background p-1 text-left transition-colors',
        !isCurrentMonth && 'bg-muted/30 text-muted-foreground',
        isToday && 'ring-2 ring-primary ring-inset',
        eventsOfDay.length === 0 &&
          'hover:bg-accent/40 focus:bg-accent/40 focus:outline-none cursor-pointer',
      )}
      aria-label={`${formatCivilDateLongAR(cellIso)}, ${eventsOfDay.length} vencimientos`}
    >
      <span className={cn('text-xs font-medium', isToday && 'text-primary font-bold')}>
        {date.getDate()}
      </span>
      <ul className="flex flex-col gap-0.5">
        {visible.map((ev) => (
          <li key={ev.id}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClickEvent(ev.id);
              }}
              data-testid={`event-${ev.id}`}
              className={cn(
                'flex w-full items-center gap-1 truncate rounded border px-1 py-0.5 text-[11px]',
                badgeClassesFor(ev, todayIso),
              )}
              title={ev.titulo}
            >
              <span className="truncate">{ev.titulo}</span>
            </button>
          </li>
        ))}
        {hidden.length > 0 && (
          <li>
            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] text-muted-foreground hover:underline focus:outline-none focus:underline"
                  data-testid={`overflow-${cellIso}`}
                >
                  +{hidden.length} más
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="start">
                <p className="text-muted-foreground mb-2 text-xs font-medium">
                  {formatCivilDateLongAR(cellIso)}
                </p>
                <ul className="flex flex-col gap-1">
                  {hidden.map((ev) => (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPopoverOpen(false);
                          onClickEvent(ev.id);
                        }}
                        className={cn(
                          'flex w-full items-center gap-1 truncate rounded border px-2 py-1 text-xs text-left',
                          badgeClassesFor(ev, todayIso),
                        )}
                      >
                        <span className="truncate">{ev.titulo}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          </li>
        )}
      </ul>
    </div>
  );
}
