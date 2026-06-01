// T-111 F1 · Corre los integration tests contra un Supabase LOCAL efimero,
// nunca contra prod.
//
// Causa raiz que resuelve: hasta T-110 los integration tests corrian contra el
// Postgres prod-linked compartido (`set -a && source .env.local && pnpm
// test:integration`), lo que (a) acumulaba ~14k consultoras de test en prod y
// (b) daba flakiness no deterministica por concurrencia (RLS-claim collisions).
//
// Este orquestador:
//   1. Levanta el stack local (`supabase start`, idempotente).
//   2. Resetea la DB efimera (`supabase db reset`) -> migraciones limpias.
//   3. Lee las keys del stack local (`supabase status -o env`).
//   4. Corre vitest con NEXT_PUBLIC_SUPABASE_URL + keys apuntando a localhost.
//
// Cero cambios a la logica de los tests: todos leen `process.env`. Requiere
// Docker local. Para debug puntual contra prod existe `test:integration:remote`.
import { execFileSync, spawnSync } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const run = (args, opts = {}) =>
  execFileSync('pnpm', args, { encoding: 'utf8', shell: IS_WIN, ...opts });

function fail(msg) {
  console.error(`\n[t111] ${msg}`);
  process.exit(1);
}

// 1. Stack local (idempotente: si ya corre, es un no-op rapido).
console.log('[t111] supabase start (Docker)...');
try {
  run(['exec', 'supabase', 'start'], { stdio: 'inherit' });
} catch {
  fail('`supabase start` fallo. Verifica que Docker este corriendo.');
}

// 2. DB efimera limpia + todas las migraciones.
console.log('[t111] supabase db reset...');
try {
  run(['exec', 'supabase', 'db', 'reset'], { stdio: 'inherit' });
} catch {
  fail('`supabase db reset` fallo.');
}

// 3. Keys del stack local (formato KEY="value").
let statusEnv = '';
try {
  statusEnv = run(['exec', 'supabase', 'status', '-o', 'env']);
} catch {
  fail('`supabase status -o env` fallo.');
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

// 4. vitest contra el stack LOCAL (nunca prod). args extra se pasan a vitest.
// T-113d: --no-file-parallelism serializa los files de integration (cada uno en su
// fork fresco). Mata la clase de flakes por pollution cross-file — tests que procesan
// datos GLOBALMENTE (process_pending_reminders, dunning, createSubscriptionAction race)
// corriendo en paralelo contra la misma DB se pisaban. Costo (~+45s) oculto bajo E2E
// (camino crítico del CI). NO afecta unit/component (otros scripts, siguen en paralelo).
console.log(`[t111] vitest --project integration (--no-file-parallelism) contra ${apiUrl}`);
const r = spawnSync(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    '--project',
    'integration',
    '--no-file-parallelism',
    ...process.argv.slice(2),
  ],
  {
    stdio: 'inherit',
    shell: IS_WIN,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
      SUPABASE_SERVICE_ROLE_KEY: service,
    },
  },
);
process.exit(r.status ?? 1);
