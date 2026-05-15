/**
 * T-029 · Tests del input de chips de recordatorios.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReminderOffsetsInput } from '@/app/(app)/calendario/ReminderOffsetsInput';

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
  },
}));

afterEach(() => cleanup());

describe('ReminderOffsetsInput', () => {
  it('renderiza chips iniciales [60, 30, 7, 0]', () => {
    render(<ReminderOffsetsInput value={[60, 30, 7, 0]} onChange={vi.fn()} />);
    expect(screen.getByTestId('reminder-chip-60')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-chip-30')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-chip-7')).toBeInTheDocument();
    expect(screen.getByTestId('reminder-chip-0')).toBeInTheDocument();
  });

  it('click en X de un chip dispara onChange sin ese offset', () => {
    const onChange = vi.fn();
    render(<ReminderOffsetsInput value={[60, 30, 0]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Quitar recordatorio 30 días'));
    expect(onChange).toHaveBeenCalledWith([60, 0]);
  });

  it('Enter en input agrega chip + dispara onDirtyChange(true) + ordena descendente', () => {
    const onChange = vi.fn();
    const onDirtyChange = vi.fn();
    render(
      <ReminderOffsetsInput value={[7, 0]} onChange={onChange} onDirtyChange={onDirtyChange} />,
    );
    const input = screen.getByLabelText('Días antes del vencimiento');
    fireEvent.change(input, { target: { value: '14' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([14, 7, 0]);
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it('duplicado NO agrega + warning toast', async () => {
    const sonner = await import('sonner');
    const onChange = vi.fn();
    render(<ReminderOffsetsInput value={[7, 0]} onChange={onChange} />);
    const input = screen.getByLabelText('Días antes del vencimiento');
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(sonner.toast.warning).toHaveBeenCalled();
  });

  it('valor fuera de rango (-5) NO agrega + error toast', async () => {
    const sonner = await import('sonner');
    const onChange = vi.fn();
    render(<ReminderOffsetsInput value={[]} onChange={onChange} />);
    const input = screen.getByLabelText('Días antes del vencimiento');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(sonner.toast.error).toHaveBeenCalled();
  });

  it('cap REMINDER_OFFSETS_MAX_COUNT (6): input disabled cuando se alcanza', () => {
    render(<ReminderOffsetsInput value={[60, 30, 14, 7, 3, 0]} onChange={vi.fn()} />);
    const input = screen.getByLabelText('Días antes del vencimiento');
    expect(input).toBeDisabled();
  });

  it('prepop al cambiar tipo con dirty=false reemplaza chips', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ReminderOffsetsInput
        value={[7, 0]}
        onChange={onChange}
        defaultsForCurrentTipo={[7, 0]}
        dirty={false}
      />,
    );
    rerender(
      <ReminderOffsetsInput
        value={[7, 0]}
        onChange={onChange}
        defaultsForCurrentTipo={[60, 14, 0]}
        dirty={false}
      />,
    );
    expect(onChange).toHaveBeenCalledWith([60, 14, 0]);
  });

  it('prepop al cambiar tipo con dirty=true NO reemplaza chips', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ReminderOffsetsInput
        value={[5, 1]}
        onChange={onChange}
        defaultsForCurrentTipo={[7, 0]}
        dirty={true}
      />,
    );
    rerender(
      <ReminderOffsetsInput
        value={[5, 1]}
        onChange={onChange}
        defaultsForCurrentTipo={[60, 14, 0]}
        dirty={true}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lista vacia muestra mensaje "Sin recordatorios"', () => {
    render(<ReminderOffsetsInput value={[]} onChange={vi.fn()} />);
    expect(screen.getByText('Sin recordatorios.')).toBeInTheDocument();
  });
});
