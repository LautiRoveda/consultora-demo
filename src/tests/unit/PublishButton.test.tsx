/**
 * T-036 · Tests del PublishButton.
 *
 * - 3 estados (draft / published / archived).
 * - Permission gate creator OR owner → button disabled + tooltip.
 * - AlertDialog confirm dispara la action y maneja todos los paths.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PublishButton } from '@/app/(app)/informes/[id]/editar/PublishButton';

vi.mock('server-only', () => ({}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
  ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

const routerPush = vi.fn();
const routerRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    refresh: routerRefresh,
  }),
}));

const publishMock = vi.fn();
const unpublishMock = vi.fn();

vi.mock('@/app/(app)/informes/actions', () => ({
  publishInformeAction: (...args: unknown[]) => publishMock(...args),
  unpublishInformeAction: (...args: unknown[]) => unpublishMock(...args),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (msg: string, opts?: unknown) => toastSuccess(msg, opts),
    error: (msg: string, opts?: unknown) => toastError(msg, opts),
  },
}));

const INFORME_ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  publishMock.mockReset();
  unpublishMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  routerPush.mockReset();
  routerRefresh.mockReset();
});

afterEach(() => cleanup());

describe('PublishButton', () => {
  it('1. status=draft + canPublish=true -> muestra "Publicar"', () => {
    render(
      <PublishButton
        informeId={INFORME_ID}
        status="draft"
        informeTipo="rgrl"
        canPublish={true}
        autoCreateEventOnSign={false}
        hasLinkedEvent={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeInTheDocument();
  });

  it('2. status=published + canPublish=true -> muestra "Volver a borrador"', () => {
    render(
      <PublishButton
        informeId={INFORME_ID}
        status="published"
        informeTipo="rgrl"
        canPublish={true}
        autoCreateEventOnSign={false}
        hasLinkedEvent={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Volver a borrador' })).toBeInTheDocument();
  });

  it('3. status=archived -> NO renderiza nada', () => {
    const { container } = render(
      <PublishButton
        informeId={INFORME_ID}
        status="archived"
        informeTipo="rgrl"
        canPublish={true}
        autoCreateEventOnSign={false}
        hasLinkedEvent={false}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('4. permission gate: status=draft + canPublish=false -> button disabled + Tooltip wrapper', () => {
    render(
      <PublishButton
        informeId={INFORME_ID}
        status="draft"
        informeTipo="rgrl"
        canPublish={false}
        autoCreateEventOnSign={false}
        hasLinkedEvent={false}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Publicar' });
    expect(btn).toBeDisabled();
  });

  it('5. click "Publicar" abre AlertDialog -> confirm dispara publishInformeAction', async () => {
    publishMock.mockResolvedValue({
      ok: true,
      informeId: INFORME_ID,
      autoCreatedEventId: null,
    });

    render(
      <PublishButton
        informeId={INFORME_ID}
        status="draft"
        informeTipo="rgrl"
        canPublish={true}
        autoCreateEventOnSign={false}
        hasLinkedEvent={false}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    // AlertDialog se abre.
    expect(screen.getByText(/¿Publicar el informe\?/)).toBeInTheDocument();

    // El AlertDialogAction tiene el texto "Publicar" también (segunda aparicion).
    const dialogActions = screen.getAllByRole('button', { name: 'Publicar' });
    // Clickeamos el último que vive dentro del dialog footer.
    await user.click(dialogActions[dialogActions.length - 1]!);

    // useTransition wraps, asi que esperamos a que la promise asentile.
    await vi.waitFor(() => expect(publishMock).toHaveBeenCalledWith(INFORME_ID));
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it('6. silent path: autoCreatedEventId populado -> toast con CTA "Ver vencimiento"', async () => {
    publishMock.mockResolvedValue({
      ok: true,
      informeId: INFORME_ID,
      autoCreatedEventId: 'event-uuid-abc',
    });

    render(
      <PublishButton
        informeId={INFORME_ID}
        status="draft"
        informeTipo="rgrl"
        canPublish={true}
        autoCreateEventOnSign={true}
        hasLinkedEvent={false}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    const dialogActions = screen.getAllByRole('button', { name: 'Publicar' });
    await user.click(dialogActions[dialogActions.length - 1]!);

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [msg, opts] = toastSuccess.mock.calls[0]!;
    expect(msg).toContain('publicado');
    expect((opts as { action: { label: string } }).action.label).toBe('Ver vencimiento');
  });

  it('7. modal path: toggle OFF + tipo recurrente + sin evento previo -> callback dispara', async () => {
    publishMock.mockResolvedValue({
      ok: true,
      informeId: INFORME_ID,
      autoCreatedEventId: null,
    });

    const onPostPublishModalRequested = vi.fn();
    render(
      <PublishButton
        informeId={INFORME_ID}
        status="draft"
        informeTipo="rgrl"
        canPublish={true}
        autoCreateEventOnSign={false}
        hasLinkedEvent={false}
        onPostPublishModalRequested={onPostPublishModalRequested}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    const dialogActions = screen.getAllByRole('button', { name: 'Publicar' });
    await user.click(dialogActions[dialogActions.length - 1]!);

    await vi.waitFor(() => expect(onPostPublishModalRequested).toHaveBeenCalledTimes(1));
  });

  it('8. tipo accidente NO dispara modal aunque toggle OFF', async () => {
    publishMock.mockResolvedValue({
      ok: true,
      informeId: INFORME_ID,
      autoCreatedEventId: null,
    });

    const onPostPublishModalRequested = vi.fn();
    render(
      <PublishButton
        informeId={INFORME_ID}
        status="draft"
        informeTipo="accidente"
        canPublish={true}
        autoCreateEventOnSign={false}
        hasLinkedEvent={false}
        onPostPublishModalRequested={onPostPublishModalRequested}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    const dialogActions = screen.getAllByRole('button', { name: 'Publicar' });
    await user.click(dialogActions[dialogActions.length - 1]!);

    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(onPostPublishModalRequested).not.toHaveBeenCalled();
  });

  it('9. EMPTY_CONTENT error -> toast.error', async () => {
    publishMock.mockResolvedValue({
      ok: false,
      code: 'EMPTY_CONTENT',
      message: 'Generá el contenido del informe antes de publicar.',
    });

    render(
      <PublishButton
        informeId={INFORME_ID}
        status="draft"
        informeTipo="rgrl"
        canPublish={true}
        autoCreateEventOnSign={false}
        hasLinkedEvent={false}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    const dialogActions = screen.getAllByRole('button', { name: 'Publicar' });
    await user.click(dialogActions[dialogActions.length - 1]!);

    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    const [msg] = toastError.mock.calls[0]!;
    expect(msg).toContain('Falta contenido');
  });
});
