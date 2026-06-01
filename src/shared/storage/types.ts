/**
 * T-024 · Tipos y constantes compartidas del modulo Storage.
 *
 * Sin server-only: este archivo se importa desde client (UI) y server (actions
 * + route handlers). Solo definiciones puras, sin I/O.
 */

export const ATTACHMENT_KINDS = ['image', 'file'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

// MIME types permitidos. Sincronizado con storage_buckets.sql.
// SVG excluido (vector XSS si se sirve inline). HEIC/HEIF excluido v1
// (requiere libheif build para conversion server-side).
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

export const FILE_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;
export type FileMimeType = (typeof FILE_MIME_TYPES)[number];

export type AttachmentMimeType = ImageMimeType | FileMimeType;

// Caps. Replicado en check constraints de la migration informe_attachments.sql.
export const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_ATTACHMENTS_PER_INFORME = 20;
export const MAX_CAPTION_LENGTH = 500;
export const MAX_FILENAME_LENGTH = 255;
export const MIN_FILENAME_LENGTH = 1;

// Buckets. Sincronizado con migrations storage_buckets.sql + t102_epp_firmas_bucket.sql.
export const BUCKET_INFORME_ATTACHMENTS = 'informe-attachments' as const;
export const BUCKET_CONSULTORA_LOGOS = 'consultora-logos' as const;
export const BUCKET_EPP_FIRMAS = 'epp-firmas' as const;

// Lista canónica de buckets de Storage. FUENTE ÚNICA DE VERDAD para el backup
// (scripts/backup-storage.ts itera sobre esto, no hardcodea su propia lista) y
// para el test anti-drift (src/tests/unit/storage-buckets-coverage.test.ts) que
// la compara contra las migraciones. Agregar acá CUALQUIER bucket nuevo creado
// en supabase/migrations — si no, el backup mensual lo ignora y el test rompe.
export const STORAGE_BUCKETS = [
  BUCKET_CONSULTORA_LOGOS,
  BUCKET_INFORME_ATTACHMENTS,
  BUCKET_EPP_FIRMAS,
] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];

// T-102 · Cap PNG firma capturada en canvas. Estimado real ~30-200 KB; 1 MB
// es margen amplio. Replicado en migration 20260524000001 file_size_limit.
export const MAX_EPP_FIRMA_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

// Signed URL TTLs (segundos).
// PDF_RENDER: holgura para Puppeteer setContent + page.pdf + network buffer.
// DOWNLOAD: button "Descargar" del client — la URL solo vive el tiempo del click.
// UI:  thumbnails y previews dentro de paginas autenticadas que el user puede
//      mantener abiertas. 1 hora cubre la mayoria de sesiones; recargar la
//      pagina regenera las URLs.
export const SIGNED_URL_TTL_PDF_RENDER_SEC = 300; // 5 min
export const SIGNED_URL_TTL_DOWNLOAD_SEC = 60; // 1 min
export const SIGNED_URL_TTL_UI_SEC = 3600; // 1 hora

// Sharp pipeline.
export const SHARP_MAX_IMAGE_DIMENSION = 2400; // px. Overkill para A4 print.
export const SHARP_MAX_LOGO_DIMENSION = 600; // px. Logo en header PDF a ~50pt.
