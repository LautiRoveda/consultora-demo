/**
 * T-024 · Formateo human-readable de bytes y MIME types para UI + PDF.
 *
 * Sin server-only — usado tanto en client (lista de attachments) como en
 * server (tabla "Anexos descargables" del PDF).
 */

const MIME_LABELS: Readonly<Record<string, string>> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
  'image/webp': 'WEBP',
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
};

export function humanMime(mime: string): string {
  return MIME_LABELS[mime] ?? mime;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / Math.pow(1024, exp);
  // Mostrar 1 decimal salvo bytes y KB enteros chicos.
  const formatted =
    exp === 0 || (exp === 1 && value >= 100) ? Math.round(value).toString() : value.toFixed(1);
  return `${formatted} ${UNITS[exp]}`;
}
