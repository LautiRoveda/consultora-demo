import { toast } from 'sonner';

/** Subconjunto de `useRouter()` que usan los handlers (evita el import del tipo del hook). */
type MiniRouter = { push: (href: string) => void; refresh: () => void };

type Failure = { ok: false; code: string; message?: string };

/**
 * Maneja los codes "comunes" de las structure ops (delete/reorder/publish y el
 * fallback de los dialogs). Los códigos de campo (INVALID_INPUT / DUPLICATE_NAME)
 * los maneja cada form con `setError` ANTES de delegar acá.
 */
export function handleCommonFailure(result: Failure, router: MiniRouter): void {
  switch (result.code) {
    case 'NOT_FOUND':
      toast.error('Elemento no encontrado', {
        description: 'Recargamos para mostrar el estado actual.',
      });
      router.refresh();
      return;
    case 'VERSION_NOT_DRAFT':
      toast.error('La versión ya no está en borrador', {
        description: 'Probablemente se publicó en otra pestaña. Recargamos la página.',
      });
      router.refresh();
      return;
    case 'INVALID_ORDER_SET':
      toast.error('La lista cambió', { description: 'Recargá la página e intentá de nuevo.' });
      router.refresh();
      return;
    case 'VERSION_EMPTY':
      toast.error('La versión no tiene ítems', {
        description: 'Agregá al menos un ítem antes de publicar.',
      });
      return;
    case 'FORBIDDEN_NOT_OWNER':
      toast.error('Permisos insuficientes', { description: result.message });
      return;
    case 'BILLING_GATED':
      toast.error('Suscripción requerida', { description: result.message });
      return;
    case 'UNAUTHENTICATED':
      toast.error('Sesión vencida', { description: result.message });
      router.push('/login');
      return;
    case 'NO_CONSULTORA':
      toast.error('Cuenta sin consultora', { description: result.message });
      return;
    default:
      toast.error('Error inesperado', { description: result.message });
  }
}
