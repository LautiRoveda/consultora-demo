import type { SpawnOptions } from 'child_process';
import { spawn } from 'child_process';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';

/**
 * T-082-FU · Backup manual de la DB Postgres.
 *
 * Supabase Free NO tiene backups automáticos de la DB (ni PITR, ni restore por
 * dashboard) — ver docs/operations/disaster-recovery.md §2. Este script es el
 * ÚNICO respaldo de la DB en Free. Genera un dump SQL completo (schema + data,
 * todos los schemas incluido auth y storage) vía pg_dump a una carpeta local
 * timestamped. Pensado para correrse mensualmente junto a `pnpm backup:storage`
 * (runbook §10).
 *
 * Uso: pnpm backup:db
 *
 * Output: ./backups/db/<YYYY-MM-DD-HHmmss>.sql
 *
 * Prerequisitos:
 *   - SUPABASE_DB_URL en .env.local (connection string del dashboard:
 *     Project Settings → Database → Connection string → URI).
 *   - pg_dump en el PATH (Postgres client tools). El restore (§5) usa psql, así
 *     que las client tools ya son prerequisito del runbook.
 *
 * Post-ejecución: subir el .sql a Google Drive personal o disco externo. El
 * folder backups/ está en .gitignore (el dump contiene PII de clientes).
 */

const DB_URL = process.env.SUPABASE_DB_URL;

if (!DB_URL) {
  console.error('❌ Falta env var: SUPABASE_DB_URL.');
  console.error(
    '   Connection string del dashboard: Project Settings → Database → Connection string → URI.',
  );
  console.error('   Pegala en .env.local antes de correr.');
  process.exit(1);
}

function timestampFile(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main(dbUrl: string): Promise<void> {
  const baseDir = join(process.cwd(), 'backups', 'db');
  await mkdir(baseDir, { recursive: true });
  const destPath = join(baseDir, `${timestampFile()}.sql`);

  console.log(`🗂️  Backup DB Supabase (pg_dump) → ${destPath}\n`);

  // --no-owner / --no-privileges: el dump se restaura sin depender del rol dueño
  // ni de los grants originales (Supabase maneja sus propios roles). pg_dump
  // escribe directo al --file, así que stdout queda vacío y stderr muestra
  // progreso/errores. stdin 'ignore' evita un hang si pidiera password (la
  // connection string URI ya lo incluye).
  const args = ['--no-owner', '--no-privileges', '--file', destPath, dbUrl];
  const opts: SpawnOptions = { stdio: ['ignore', 'inherit', 'inherit'] };

  await new Promise<void>((resolve, reject) => {
    const child = spawn('pg_dump', args, opts);
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') {
        reject(
          new Error(
            'pg_dump no está en el PATH. Instalá las Postgres client tools ' +
              '(macOS: `brew install libpq` + link; Ubuntu/Debian: `apt install postgresql-client`; ' +
              'Windows: instalador de PostgreSQL o `scoop install postgresql`).',
          ),
        );
        return;
      }
      reject(err);
    });
    child.on('close', (code: number | null) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`pg_dump salió con código ${code} — revisá SUPABASE_DB_URL y la conectividad.`),
        );
    });
  });

  const { size } = await stat(destPath);
  const mb = (size / 1024 / 1024).toFixed(2);
  console.log(`\n✅ Backup DB completo: ${mb} MB → ${destPath}`);
  console.log(
    '📤 Próximo paso: subir el .sql a Google Drive / disco externo (junto al backup de Storage).',
  );
}

main(DB_URL).catch((err) => {
  console.error('❌ Backup DB falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
