import 'server-only';

import type { DispatchResult } from '../types';

/**
 * T-031 · STUB Telegram sender. Implementacion real en T-033.
 *
 * Devuelve siempre `NO_CHANNEL_IMPL_T033`. El dispatcher mapea esto a
 * notification_log.status='skipped' (no es failure, es expected hasta T-033).
 */
export function sendTelegramReminder(): Promise<DispatchResult> {
  return Promise.resolve({
    ok: false,
    errorCode: 'NO_CHANNEL_IMPL_T033',
    errorDetail: 'Canal Telegram no implementado en T-031. Sigue T-033.',
  });
}
