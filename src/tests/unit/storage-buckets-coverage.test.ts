/**
 * T-082-FU · Guard anti-drift del backup de Storage.
 *
 * `STORAGE_BUCKETS` (la lista sobre la que itera scripts/backup-storage.ts) debe
 * cubrir EXACTAMENTE los buckets creados en supabase/migrations. Un bucket nuevo
 * en una migración sin sumarlo a STORAGE_BUCKETS = pérdida de datos silenciosa en
 * el backup mensual (pasó con `epp-firmas`, firmas legales Res 299/11). Este test
 * rompe en ese caso — y también si queda una constante fantasma sin migración.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { STORAGE_BUCKETS } from '@/shared/storage/types';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/** Bucket ids declarados en cada `insert into storage.buckets (...) values (...)`. */
function bucketIdsFromMigrations(): Set<string> {
  const ids = new Set<string>();
  for (const file of readdirSync(MIGRATIONS_DIR)) {
    if (!file.endsWith('.sql')) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // Cada bloque `insert into storage.buckets <cols> values <rows> ... ;`.
    for (const block of sql.matchAll(
      /insert\s+into\s+storage\.buckets\b[\s\S]*?values([\s\S]*?);/gi,
    )) {
      const values = block[1] ?? '';
      // Cada row arranca con `('<id>', ...`. Los array['mime'] usan `[`, no matchean.
      for (const row of values.matchAll(/\(\s*'([^']+)'/g)) {
        ids.add(row[1]!);
      }
    }
  }
  return ids;
}

describe('STORAGE_BUCKETS vs supabase/migrations (anti-drift backup)', () => {
  it('cubre exactamente los buckets creados en las migraciones', () => {
    const declared = [...bucketIdsFromMigrations()].sort();
    const backedUp = [...new Set<string>(STORAGE_BUCKETS)].sort();
    // Si esto falla: o creaste un bucket en una migración y no lo sumaste a
    // STORAGE_BUCKETS (→ backup:storage lo ignora silenciosamente), o quedó una
    // constante sin migración. Sincronizá src/shared/storage/types.ts.
    expect(backedUp).toEqual(declared);
  });

  it('incluye los 5 buckets conocidos (logos, attachments, epp-firmas, checklist-firmas, checklist-adjuntos)', () => {
    expect(new Set<string>(STORAGE_BUCKETS)).toEqual(
      new Set([
        'consultora-logos',
        'informe-attachments',
        'epp-firmas',
        'checklist-firmas',
        'checklist-adjuntos',
      ]),
    );
  });
});
