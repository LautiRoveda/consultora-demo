// T-156 · Corre coverage de los 3 projects (unit+component+integration) contra un
// Supabase LOCAL efímero, nunca contra prod, y aplica el gate de cobertura.
//
// Por qué un orquestador propio (y no `pnpm test:coverage` a secas): el project
// `integration` necesita el stack Supabase local levantado + las keys inyectadas en
// el entorno (igual que scripts/test-integration-local.mjs). Reusa el mismo plumbing
// probado (start con retry T-153 -> db reset -> status -o env) y corre vitest con
// --coverage sobre TODOS los projects en una sola pasada instrumentada → un único
// reporte GLOBAL del que vitest evalúa los thresholds (branches/functions) de
// vitest.config.ts. Si caen bajo el umbral, vitest sale ≠ 0 y este script propaga el
// exit code → el job de CI se pinta rojo.
//
// --no-file-parallelism es OBLIGATORIO (T-113d): los integration tests procesan datos
// GLOBALMENTE y se pisan si corren en paralelo contra la misma DB. Serializa también
// unit/comp (más lento, pero seguro y determinístico para el número de cobertura).
//
// Cero cambios a la lógica de los tests: todos leen process.env. Requiere Docker local.
import { execFileSync, spawnSync } from 'node:child_process';

import { startSupabaseWithRetry } from './supabase-start-retry.mjs';

const IS_WIN = process.platform === 'win32';
const run = (args, opts = {}) =>
  execFileSync('pnpm', args, { encoding: 'utf8', shell: IS_WIN, ...opts });

function fail(msg) {
  console.error(`\n[t156] ${msg}`);
  process.exit(1);
}

// 1. Stack local (idempotente; T-153: con retry acotado por el flake del 502 del
// edge-runtime, ver scripts/supabase-start-retry.mjs).
console.log('[t156] supabase start (Docker, con retry)...');
try {
  await startSupabaseWithRetry();
} catch {
  fail('`supabase start` falló tras los reintentos. Verificá que Docker esté corriendo.');
}

// 2. DB efímera limpia + todas las migraciones.
console.log('[t156] supabase db reset...');
try {
  run(['exec', 'supabase', 'db', 'reset'], { stdio: 'inherit' });
} catch {
  fail('`supabase db reset` falló.');
}

// 3. Keys del stack local (formato KEY="value").
let statusEnv = '';
try {
  statusEnv = run(['exec', 'supabase', 'status', '-o', 'env']);
} catch {
  fail('`supabase status -o env` falló.');
}
const pick = (key) => {
  const m = statusEnv.match(new RegExp(`^${key}="?([^"\\n\\r]+)"?`, 'm'));
  return m ? m[1] : '';
};
const apiUrl = pick('API_URL');
const anon = pick('ANON_KEY');
const service = pick('SERVICE_ROLE_KEY');
if (!apiUrl || !anon || !service) {
  fail('No pude leer API_URL / ANON_KEY / SERVICE_ROLE_KEY del stack local.');
}

// 4. vitest --coverage sobre los 3 projects contra el stack LOCAL (nunca prod).
// Sin --project → corre todos los projects de vitest.config.ts. vitest aplica los
// thresholds del config (branches/functions GLOBAL) y sale ≠ 0 si no se cumplen.
console.log(`[t156] vitest run --coverage --no-file-parallelism (3 projects) contra ${apiUrl}`);
const r = spawnSync('pnpm', ['exec', 'vitest', 'run', '--coverage', '--no-file-parallelism'], {
  stdio: 'inherit',
  shell: IS_WIN,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
    SUPABASE_SERVICE_ROLE_KEY: service,
  },
});
process.exit(r.status ?? 1);
