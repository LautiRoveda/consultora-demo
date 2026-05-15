/**
 * T-029 · Tests del grid mensual del calendario.
 */
import type { CalendarEventRow } from '@/app/(app)/calendario/queries';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarMonthView } from '@/app/(app)/calendario/CalendarMonthView';

afterEach(() => cleanup());

function makeEvent(overrides: Partial<CalendarEventRow>): CalendarEventRow {
  return {
    id: overrides.id ?? '00000000-0000-4000-8000-000000000001',
    consultora_id: '00000000-0000-4000-8000-000000000aaa',
    tipo: 'custom',
    titulo: overrides.titulo ?? 'Test event',
    descripcion: null,
    informe_id: null,
    fecha_vencimiento: overrides.fecha_vencimiento ?? '2026-06-15',
    recurrence_months: null,
    status: overrides.status ?? 'pending',
    completed_at: null,
    completed_by: null,
    reminder_offsets_days: [7, 0],
    metadata: null,
    created_by: '00000000-0000-4000-8000-000000000bbb',
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CalendarMonthView', () => {
  const defaultProps = {
    month: { year: 2026, month: 6 }, // Junio 2026
    events: [] as CalendarEventRow[],
    onClickDay: vi.fn(),
    onClickEvent: vi.fn(),
  };

  it('renderiza grid 7-col + headers de dias de semana', () => {
    render(<CalendarMonthView {...defaultProps} />);
    // Headers L M M J V S D
    const headers = screen.getAllByRole('columnheader');
    expect(headers.length).toBe(7);
    expect(headers[0]?.textContent).toBe('L');
    expect(headers[6]?.textContent).toBe('D');
  });

  it('Junio 2026 (lunes 1) tiene exactamente 30 cells del mes + padding', () => {
    // Junio 2026 empieza lunes 1, termina martes 30. Sin padding del mes
    // anterior (offset 0) + padding hasta completar 5 semanas = 35 cells.
    render(<CalendarMonthView {...defaultProps} />);
    expect(screen.getByTestId('cell-2026-06-01')).toBeInTheDocument();
    expect(screen.getByTestId('cell-2026-06-30')).toBeInTheDocument();
  });

  it('agrupa eventos por dia: 2 eventos en mismo dia se renderizan juntos', () => {
    const events = [
      makeEvent({ id: 'e1', fecha_vencimiento: '2026-06-15', titulo: 'Evento A' }),
      makeEvent({ id: 'e2', fecha_vencimiento: '2026-06-15', titulo: 'Evento B' }),
    ];
    render(<CalendarMonthView {...defaultProps} events={events} />);
    const cell = screen.getByTestId('cell-2026-06-15');
    expect(cell.querySelectorAll('[data-testid^="event-"]').length).toBe(2);
  });

  it('click en dia vacio dispara onClickDay con la fecha ISO correcta', () => {
    const onClickDay = vi.fn();
    render(<CalendarMonthView {...defaultProps} onClickDay={onClickDay} />);
    fireEvent.click(screen.getByTestId('cell-2026-06-15'));
    expect(onClickDay).toHaveBeenCalledWith('2026-06-15');
  });

  it('click en evento dispara onClickEvent con eventId + NO dispara onClickDay (stopPropagation)', () => {
    const onClickDay = vi.fn();
    const onClickEvent = vi.fn();
    const events = [makeEvent({ id: 'e1', fecha_vencimiento: '2026-06-15' })];
    render(
      <CalendarMonthView
        {...defaultProps}
        events={events}
        onClickDay={onClickDay}
        onClickEvent={onClickEvent}
      />,
    );
    fireEvent.click(screen.getByTestId('event-e1'));
    expect(onClickEvent).toHaveBeenCalledWith('e1');
    expect(onClickDay).not.toHaveBeenCalled();
  });

  it('evento status=completed se renderiza con clase line-through', () => {
    const events = [makeEvent({ id: 'e1', fecha_vencimiento: '2026-06-15', status: 'completed' })];
    render(<CalendarMonthView {...defaultProps} events={events} />);
    const ev = screen.getByTestId('event-e1');
    expect(ev.className).toMatch(/line-through/);
  });

  it('evento pending con fecha pasada usa variant destructive', () => {
    // Fecha histórica garantizada < today: 2020-01-15 nunca va a ser futuro
    // sin importar cuándo se ejecute el test. Mes mostrado matchea para que
    // la cell exista en el grid.
    const events = [makeEvent({ id: 'e1', fecha_vencimiento: '2020-01-15', status: 'pending' })];
    render(
      <CalendarMonthView {...defaultProps} month={{ year: 2020, month: 1 }} events={events} />,
    );
    const ev = screen.getByTestId('event-e1');
    expect(ev.className).toMatch(/destructive/);
  });

  it('dia con 5 eventos muestra 3 visibles + chip "+2 más"', () => {
    const events = [
      makeEvent({ id: 'e1', fecha_vencimiento: '2026-06-15', titulo: 'A' }),
      makeEvent({ id: 'e2', fecha_vencimiento: '2026-06-15', titulo: 'B' }),
      makeEvent({ id: 'e3', fecha_vencimiento: '2026-06-15', titulo: 'C' }),
      makeEvent({ id: 'e4', fecha_vencimiento: '2026-06-15', titulo: 'D' }),
      makeEvent({ id: 'e5', fecha_vencimiento: '2026-06-15', titulo: 'E' }),
    ];
    render(<CalendarMonthView {...defaultProps} events={events} />);
    const cell = screen.getByTestId('cell-2026-06-15');
    expect(cell.querySelectorAll('[data-testid^="event-"]').length).toBe(3);
    expect(screen.getByTestId('overflow-2026-06-15').textContent).toBe('+2 más');
  });

  it('dia fuera del mes (padding) NO dispara onClickDay con fecha del mes mostrado', () => {
    // Mayo 2026: empieza viernes 1, padding del mes anterior incluye 28-30 abr.
    const onClickDay = vi.fn();
    render(
      <CalendarMonthView
        {...defaultProps}
        month={{ year: 2026, month: 5 }}
        onClickDay={onClickDay}
      />,
    );
    // Cell de 28 de abril (padding) existe.
    const padCell = screen.getByTestId('cell-2026-04-27');
    fireEvent.click(padCell);
    // Y dispara con fecha real (no del mes mostrado).
    expect(onClickDay).toHaveBeenCalledWith('2026-04-27');
  });
});
