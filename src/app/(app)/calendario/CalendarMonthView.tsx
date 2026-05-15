'use client';

import type { CalendarEventRow } from './queries';
import { addDays, eachDayOfInterval, endOfMonth, getDay, startOfMonth } from 'date-fns';
import { useMemo } from 'react';

import { CalendarMonthCell } from './CalendarMonthCell';
import { dateToCivilIso } from './event-form-helpers';

const WEEKDAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

type Props = {
  month: { year: number; month: number };
  events: CalendarEventRow[];
  onClickDay: (fechaIso: string) => void;
  onClickEvent: (eventId: string) => void;
};

export function CalendarMonthView({ month, events, onClickDay, onClickEvent }: Props) {
  // Grid days: padding del mes anterior + dias del mes + padding del siguiente
  // hasta completar multiplo de 7. Lunes-inicio (L M M J V S D).
  const gridDays = useMemo(() => {
    const first = startOfMonth(new Date(month.year, month.month - 1, 1));
    const last = endOfMonth(first);
    // getDay: domingo=0, lunes=1... Convertimos a "dias desde el lunes".
    const offsetMonday = (getDay(first) + 6) % 7;
    const gridStart = addDays(first, -offsetMonday);
    const totalCells = Math.ceil((offsetMonday + last.getDate()) / 7) * 7;
    return eachDayOfInterval({ start: gridStart, end: addDays(gridStart, totalCells - 1) });
  }, [month]);

  // Agrupar eventos por dia (key = fecha_vencimiento YYYY-MM-DD).
  // Sort intra-dia: vencidos primero (los que mas atencion necesitan), despues
  // pending por id (estable), despues completed/cancelled al final.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventRow[]>();
    for (const ev of events) {
      const list = map.get(ev.fecha_vencimiento) ?? [];
      list.push(ev);
      map.set(ev.fecha_vencimiento, list);
    }
    const todayIso = dateToCivilIso(new Date());
    for (const list of map.values()) {
      list.sort((a, b) => {
        const aOver = a.status === 'pending' && a.fecha_vencimiento < todayIso;
        const bOver = b.status === 'pending' && b.fecha_vencimiento < todayIso;
        if (aOver !== bOver) return aOver ? -1 : 1;
        const order = { pending: 0, completed: 1, cancelled: 2 } as const;
        const aOrd = order[a.status as keyof typeof order] ?? 9;
        const bOrd = order[b.status as keyof typeof order] ?? 9;
        if (aOrd !== bOrd) return aOrd - bOrd;
        return a.id.localeCompare(b.id);
      });
    }
    return map;
  }, [events]);

  const todayIso = dateToCivilIso(new Date());

  return (
    <div className="overflow-hidden rounded-md border border-border">
      <div
        className="grid grid-cols-7 border-b border-border bg-muted/40"
        role="row"
        aria-label="Días de la semana"
      >
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={i}
            role="columnheader"
            className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
          >
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7" role="grid" aria-label="Calendario mensual">
        {gridDays.map((date) => {
          const iso = dateToCivilIso(date);
          const isCurrentMonth = date.getMonth() === month.month - 1;
          const eventsOfDay = eventsByDay.get(iso) ?? [];
          return (
            <CalendarMonthCell
              key={iso}
              date={date}
              eventsOfDay={eventsOfDay}
              isCurrentMonth={isCurrentMonth}
              todayIso={todayIso}
              onClickDay={onClickDay}
              onClickEvent={onClickEvent}
            />
          );
        })}
      </div>
    </div>
  );
}
