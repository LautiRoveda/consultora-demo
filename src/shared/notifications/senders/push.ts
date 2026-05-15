import 'server-only';

import type { DispatchResult } from '../types';

/**
 * T-031 · STUB Web Push sender. Implementacion real en T-034.
 *
 * Devuelve siempre `NO_CHANNEL_IMPL_T034`. El dispatcher mapea esto a
 * notification_log.status='skipped' (no es failure, es expected hasta T-034).
 */
export function sendPushReminder(): Promise<DispatchResult> {
  return Promise.resolve({
    ok: false,
    errorCode: 'NO_CHANNEL_IMPL_T034',
    errorDetail: 'Canal Web Push no implementado en T-031. Sigue T-034.',
  });
}
