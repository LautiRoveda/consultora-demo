/**
 * T-082 · Backup manual de Storage buckets Supabase.
 *
 * Descarga TODOS los archivos de los 2 buckets productivos a una carpeta
 * local timestamped. Pensado para correrse mensualmente como parte del
 * runbook docs/operations/disaster-recovery.md § 3.
 *
 * Uso: pnpm backup:storage
 *
 * Output: ./backups/storage/<YYYY-MM-DD-HHmmss>/<bucket>/<path>
 *
 * Post-ejecución: subir el folder generado a Google Drive personal
 * (gratis 15GB) o disco externo. El folder backups/ está en .gitignore
 * porque los dumps contienen PII de clientes (DNI/CUIL/firmas).
 */
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';

import { STORAGE_BUCKETS } from '../src/shared/storage/types';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Faltan env vars: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.');
  console.error('   Asegurate de tener .env.local con valores reales antes de correr.');
  process.exit(1);
}

// Fuente única de verdad: src/shared/storage/types.ts. NO hardcodear la lista acá
// (un bucket olvidado = pérdida de datos silenciosa — pasó con epp-firmas, T-082-FU).
const BUCKETS = STORAGE_BUCKETS;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function timestampFolder(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function listAllFiles(bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
  for (const item of data ?? []) {
    const path = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id === null) {
      // Es carpeta — recurse.
      const sub = await listAllFiles(bucket, path);
      out.push(...sub);
    } else {
      out.push(path);
    }
  }
  return out;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadFile(bucket: string, path: string, destPath: string): Promise<number> {
  // Retry con exponential backoff — Supabase Storage tira Gateway Timeout
  // transitorios bajo volumen (300+ archivos). Sin retry, el backup completo
  // falla y hay que empezar de cero.
  const MAX_ATTEMPTS = 3;
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { data, error } = await admin.storage.from(bucket).download(path);
      if (error || !data) throw new Error(error?.message ?? 'no data');
      await mkdir(dirname(destPath), { recursive: true });
      const buf = Buffer.from(await data.arrayBuffer());
      await writeFile(destPath, buf);
      return buf.byteLength;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        const delayMs = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s.
        console.log(
          `   ⚠️  Retry ${attempt}/${MAX_ATTEMPTS - 1} en ${delayMs}ms — ${lastError.message}`,
        );
        await sleep(delayMs);
      }
    }
  }
  throw new Error(
    `download ${bucket}/${path} falló tras ${MAX_ATTEMPTS} intentos: ${lastError?.message}`,
  );
}

async function main(): Promise<void> {
  const tsFolder = timestampFolder();
  const baseDir = join(process.cwd(), 'backups', 'storage', tsFolder);

  console.log(`🗂️  Backup Storage Supabase → ${baseDir}\n`);

  let totalFiles = 0;
  let totalBytes = 0;

  for (const bucket of BUCKETS) {
    console.log(`📦 Bucket: ${bucket}`);
    const files = await listAllFiles(bucket);
    console.log(`   ${files.length} archivos encontrados.`);

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const destPath = join(baseDir, bucket, file);
      const bytes = await downloadFile(bucket, file, destPath);
      totalBytes += bytes;
      totalFiles++;
      console.log(
        `   [${i + 1}/${files.length}] ${bucket}/${file} (${(bytes / 1024).toFixed(1)} KB)`,
      );
    }
    console.log('');
  }

  const mb = (totalBytes / 1024 / 1024).toFixed(2);
  console.log(`✅ Backup completo: ${totalFiles} archivos, ${mb} MB total.`);
  console.log(`   Carpeta: ${baseDir}`);
  console.log(`\n📤 Próximo paso: subir el folder a Google Drive / disco externo / backup remoto.`);
}

main().catch((err) => {
  console.error('❌ Backup falló:', err);
  process.exit(1);
});
