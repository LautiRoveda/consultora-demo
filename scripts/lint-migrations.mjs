// T-151 · Lint de seguridad de migraciones SQL con squawk, SOLO sobre las
// migraciones NUEVAS del PR (diff vs origin/main). Las migraciones históricas ya
// están en prod, son inmutables y NUNCA se re-lintean. Cross-platform (Windows /
// PowerShell en dev + ubuntu en CI): todo vía node:child_process + node:path, sin
// pipes de shell.
//
// Flujo:
//   1. Resuelve una base ref usable (origin/main; si no, intenta fetch; si no, fallback).
//   2. git diff --name-only --diff-filter=AM <base>...HEAD -- supabase/migrations/*.sql
//   3. Sin archivos -> exit 0 (no-op verde).
//   4. Con archivos -> `pnpm exec squawk <files...>` y propaga el exit code.
//
// La config de las reglas vive en .squawk.toml (raíz del repo); squawk la levanta
// automáticamente desde el cwd.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const IS_WIN = process.platform === 'win32';
const MIGRATIONS_GLOB = 'supabase/migrations/*.sql';
// Índices concurrentes aislados: `supabase db push` los corre FUERA de transacción
// solo si CREATE INDEX CONCURRENTLY es ~la única sentencia del archivo, así que NO
// pueden llevar los `set lock_timeout`/`set statement_timeout` al tope que exige
// require-timeout-settings. Se nombran *_concurrently.sql y se excluyen del lint acá
// (no vía excluded_paths de squawk: pasarle un path excluido explícito lo hace
// abortar con "Failed to find files" + exit 1). Ver .squawk.toml.
const CONCURRENTLY_RE = /_concurrently\.sql$/i;

function log(msg) {
  console.log(`[lint:migrations] ${msg}`);
}

// Ejecuta git capturando stdout; devuelve '' si el comando falla (no tira).
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', shell: IS_WIN }).trim();
  } catch {
    return '';
  }
}

// ¿Existe el ref localmente? rev-parse --verify --quiet => exit 0 si sí.
// OJO: sin `^{commit}` a propósito — en Windows con shell:true el `^` es el escape
// de cmd.exe y rompería el chequeo (mangling del caret). Para nuestros refs
// (origin/main / FETCH_HEAD / main) el verify plano alcanza.
function refExists(ref) {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
    shell: IS_WIN,
    stdio: 'ignore',
  });
  return r.status === 0;
}

// 1. Resolver la base ref para el triple-dot diff.
function resolveBase() {
  // Caso normal: el tracking ref origin/main ya está presente (dev al día).
  if (refExists('origin/main')) return 'origin/main';

  // CI (checkout shallow / sin el tracking ref de main) o dev sin fetch: traemos
  // main. `git fetch origin main` NO crea el tracking ref origin/main, pero deja
  // FETCH_HEAD apuntando al main remoto -> usamos eso como base del diff.
  log('origin/main no está local; intento `git fetch origin main`...');
  spawnSync('git', ['fetch', '--no-tags', 'origin', 'main'], {
    shell: IS_WIN,
    stdio: 'inherit',
  });
  if (refExists('FETCH_HEAD')) return 'FETCH_HEAD';
  if (refExists('origin/main')) return 'origin/main';

  // Fallback: rama local `main` (dev que nunca pusheó / sin remote).
  if (refExists('main')) {
    log('Uso `main` local como base (no pude resolver origin/main).');
    return 'main';
  }

  // Sin base usable: NO rompemos el CI por mecánica de git; warning + no-op verde.
  log(
    '::warning:: No pude resolver una base (origin/main / FETCH_HEAD / main). ' +
      'Salteo el lint de migraciones (no-op verde).',
  );
  return null;
}

const base = resolveBase();
if (base === null) process.exit(0);

// 2. Diff: solo Added/Modified, solo migraciones, triple-dot (vs merge-base).
const raw = git([
  'diff',
  '--name-only',
  '--diff-filter=AM',
  `${base}...HEAD`,
  '--',
  MIGRATIONS_GLOB,
]);

// 3. Normalizar: git emite forward-slash incluso en Windows; resolvemos a path
//    absoluto nativo (squawk lo acepta) y descartamos lo que no exista en el FS.
const changed = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter(Boolean);

if (changed.length === 0) {
  log(`Sin migraciones nuevas/modificadas vs ${base}. Nada que lintear (verde).`);
  process.exit(0);
}

// Excluir los índices concurrentes aislados (ver CONCURRENTLY_RE arriba). El match
// es sobre la ruta relativa que emite git (forward-slash, basename incluido).
const skipped = changed.filter((rel) => CONCURRENTLY_RE.test(rel));
const files = changed
  .filter((rel) => !CONCURRENTLY_RE.test(rel))
  .map((rel) => resolve(process.cwd(), rel))
  .filter((abs) => existsSync(abs));

skipped.forEach((rel) =>
  log(`Salteo índice concurrente aislado (require-timeout-settings N/A): ${rel}`),
);

if (files.length === 0) {
  log(`Sin migraciones nuevas linteables vs ${base} (tras exclusiones). Verde.`);
  process.exit(0);
}

log(`Linteando ${files.length} migración(es) nueva(s) vs ${base}:`);
files.forEach((f) => log(`  - ${f}`));

// 4. squawk vía pnpm exec (devDep, binario nativo). Levanta .squawk.toml del cwd.
const r = spawnSync('pnpm', ['exec', 'squawk', ...files], {
  stdio: 'inherit',
  shell: IS_WIN,
});

if (r.error) {
  console.error(`\n[lint:migrations] No pude invocar squawk: ${r.error.message}`);
  process.exit(1);
}
process.exit(r.status ?? 1); // propaga el exit code de squawk (>0 = violaciones)
