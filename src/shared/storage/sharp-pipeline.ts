import 'server-only';

import type { ImageMimeType } from './types';
import sharp from 'sharp';

import { IMAGE_MIME_TYPES, SHARP_MAX_IMAGE_DIMENSION, SHARP_MAX_LOGO_DIMENSION } from './types';

/**
 * T-024 · Sharp pipeline para imagenes upload (attachments + logos).
 *
 * Operaciones:
 *  1. rotate() — honra EXIF Orientation (foto de iPhone en horizontal se
 *     guarda con orientation=6, hay que rotarla 90° antes o se ve volcada
 *     en cualquier visor que no respete EXIF, incluido Puppeteer).
 *  2. withMetadata({ exif: undefined, icc: undefined }) — strip EXIF/ICC
 *     (privacy + tamaño + evita interpretacion ambigua post-resize).
 *  3. resize() — cap a SHARP_MAX_*_DIMENSION (2400 px attachments / 600 px
 *     logos). Imagenes mas grandes se downscalean preservando aspect ratio;
 *     mas chicas no se tocan (withoutEnlargement).
 *  4. Re-encode al MISMO formato (PNG → PNG, JPG → JPG, WEBP → WEBP).
 *     Evita conversion no consentida + previene smuggling (un archivo PNG
 *     malformado no puede passthrough — sharp lo re-encodea).
 *
 * `failOn: 'truncated'` aborta si la imagen esta cortada/corrupta. Default
 * de sharp es 'warning' (acepta input dañado). Falla cerrado.
 */

export type ProcessedImage = {
  buffer: Buffer;
  mime: ImageMimeType;
  width: number;
  height: number;
};

type Variant = 'attachment' | 'logo';

async function processImage(input: Buffer, variant: Variant): Promise<ProcessedImage> {
  const pipeline = sharp(input, { failOn: 'truncated' })
    .rotate()
    .withMetadata({ exif: undefined, icc: undefined });

  const meta = await pipeline.metadata();
  const inputMime = meta.format ? `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}` : null;

  // El caller ya valido el MIME claimed via validators. Aca defendemos contra
  // input cuyo HEADER no coincide con su contenido real (sharp lo detecta).
  if (!inputMime || !(IMAGE_MIME_TYPES as readonly string[]).includes(inputMime)) {
    throw new Error(`processImage: formato detectado no soportado: ${meta.format ?? 'unknown'}`);
  }

  const maxDim = variant === 'logo' ? SHARP_MAX_LOGO_DIMENSION : SHARP_MAX_IMAGE_DIMENSION;
  const needsResize = (meta.width ?? 0) > maxDim || (meta.height ?? 0) > maxDim;
  if (needsResize) {
    pipeline.resize({
      width: maxDim,
      height: maxDim,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  let encoded: sharp.Sharp;
  switch (inputMime) {
    case 'image/png':
      encoded = pipeline.png({ compressionLevel: 9, palette: false });
      break;
    case 'image/jpeg':
      encoded = pipeline.jpeg({ quality: 85, mozjpeg: true });
      break;
    case 'image/webp':
      encoded = pipeline.webp({ quality: 85 });
      break;
    default:
      // exhaustivity guard.
      throw new Error(`processImage: branch no contemplada: ${inputMime}`);
  }

  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return {
    buffer: data,
    mime: inputMime,
    width: info.width,
    height: info.height,
  };
}

export function processAttachmentImage(input: Buffer): Promise<ProcessedImage> {
  return processImage(input, 'attachment');
}

export function processLogoImage(input: Buffer): Promise<ProcessedImage> {
  return processImage(input, 'logo');
}
