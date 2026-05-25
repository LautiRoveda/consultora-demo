/**
 * C5 audit · Tests del pixel cap defensivo en sharp pipeline.
 *
 * Genera PNG sinteticos via sharp().create (sin limitInputPixels en la
 * generacion) y los pasa por processAttachmentImage que SI tiene el cap.
 */
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { processAttachmentImage } from '@/shared/storage/sharp-pipeline';

vi.mock('server-only', () => ({}));

describe('processAttachmentImage · C5 pixel cap (anti decompression bomb)', () => {
  it('rechaza PNG con dimensiones que exceden limitInputPixels (50M)', async () => {
    // 8000×8000 = 64M pixels, supera el cap de 50M.
    const evilPng = await sharp({
      create: {
        width: 8000,
        height: 8000,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    await expect(processAttachmentImage(evilPng)).rejects.toThrow(/pixel|limit|input/i);
  });

  it('acepta PNG dentro del cap (1000×1000) y lo procesa normal', async () => {
    const okPng = await sharp({
      create: {
        width: 1000,
        height: 1000,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .png()
      .toBuffer();

    const result = await processAttachmentImage(okPng);
    expect(result.mime).toBe('image/png');
    expect(result.width).toBeLessThanOrEqual(1000);
    expect(result.height).toBeLessThanOrEqual(1000);
  });
});
