/**
 * T-031 · Tipos compartidos del modulo notifications.
 */

/**
 * Resultado de un sender individual (email, telegram, push).
 * Discriminated union sobre `ok`.
 */
export type DispatchResult =
  | { ok: true; messageId: string }
  | { ok: false; errorCode: string; errorDetail?: string };

/**
 * Outcome por canal devuelto al cliente del endpoint dispatcher (debug).
 * Espeja la fila escrita a `notification_log`.
 */
export type ChannelOutcome = {
  channel: 'email' | 'telegram' | 'push';
  status: 'sent' | 'skipped' | 'failed' | 'bounced';
  message_id?: string;
  error_code?: string;
};

/**
 * Shape del event embebido en el reminder (subset usado por los senders).
 */
export type ReminderEventShape = {
  id: string;
  titulo: string;
  tipo: string;
  fecha_vencimiento: string;
  descripcion: string | null;
  status: 'pending' | 'completed' | 'cancelled';
  recurrence_months: number | null;
  created_by: string | null;
  consultora_id: string;
};

/**
 * Reminder completo + event embebido (lo que pasa el endpoint al dispatcher).
 */
export type ReminderWithEvent = {
  id: string;
  offset_days: number;
  event: ReminderEventShape;
};
