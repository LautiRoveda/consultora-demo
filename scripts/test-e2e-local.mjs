// T-112 · Corre los tests E2E (Playwright) contra un Supabase LOCAL efimero,
// nunca contra prod. Espejo de scripts/test-integration-local.mjs (F1, #158),
// que ya aisla los integration tests con el mismo patron.
//
// Causa raiz que resuelve: el step E2E vivia en el job `ci` y buildeaba/corria
// la app con los secrets de PROD (env del job). Como las NEXT_PUBLIC_* se
// hornean en BUILD TIME, la app local quedaba apuntando a la DB prod-linked y
// CADA corrida E2E creaba consultoras + auth.users de test en prod (la
// contaminacion que T-111 limpio).
//
// Este orquestador:
//   1. Levanta el stack local (`supabase start`, idempotente).
//   2. Resetea la DB efimera (`supabase db reset`) -> migraciones limpias.
//   3. Lee las keys del stack local (`supabase status -o env`).
//   4. Corre Playwright con NEXT_PUBLIC_SUPABASE_URL + keys apuntando a localhost.
//
// POR QUE el horneado funciona pese a la cadena de procesos: spawnSync fija el
// env de ESTE proceso de Playwright; el webServer (`pnpm build && pnpm start`,
// ver playwright.config.ts) se lanza como hijo y HEREDA ese env, asi que
// `next build` inlina la URL LOCAL en el bundle del cliente. No hay bloque
// `env:{}` en webServer que lo pise. El job de CI lo verifica con un gate que
// grepea .next/static (127.0.0.1:54321 presente, *.supabase.co ausente).
//
// Cero cambios a la logica de los tests: todos leen `process.env`. Requiere
// Docker local. Nota local: si ya tenes un `pnpm dev` apuntando a prod corriendo,
// reuseExistingServer (no-CI) lo reusaria; cerralo antes o corre con CI=1.
import { execFileSync, spawnSync } from 'node:child_process';

const IS_WIN = process.platform === 'win32';
const run = (args, opts = {}) =>
  execFileSync('pnpm', args, { encoding: 'utf8', shell: IS_WIN, ...opts });

function fail(msg) {
  console.error(`\n[t112] ${msg}`);
  process.exit(1);
}

// 1. Stack local (idempotente: si ya corre, es un no-op rapido).
console.log('[t112] supabase start (Docker)...');
try {
  run(['exec', 'supabase', 'start'], { stdio: 'inherit' });
} catch {
  fail('`supabase start` fallo. Verifica que Docker este corriendo.');
}

// 2. DB efimera limpia + todas las migraciones.
console.log('[t112] supabase db reset...');
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

// 4. Playwright contra el stack LOCAL (nunca prod). args extra se pasan a
// playwright (ej: `pnpm test:e2e:local --grep "PDF export"`). El build de la app
// (dentro del webServer) hereda estas 3 keys y hornea la URL local en el bundle.
console.log(`[t112] playwright --project=chromium contra ${apiUrl}`);
const r = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '--project=chromium', ...process.argv.slice(2)],
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
