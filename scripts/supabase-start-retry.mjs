// T-153 · Reintenta `supabase start` ante el flake de infra conocido: el edge-runtime
// devuelve 502 durante el arranque y el CLI SALE CON ERROR → hoy se rescata con re-run
// manual (FU dormido del handoff). Acotado (3 intentos, backoff), nunca infinito.
//
// La superficie de retry es el EXIT CODE de `supabase start`, no un health check aparte: el
// CLI ya hace su propia verificación de salud de los containers y falla el comando si el
// edge-runtime (u otro) no queda healthy.
//
// `supabase stop --no-backup` entre intentos: un start parcial deja containers a medias que un
// re-`start` "idempotente" no repara (reporta "already running" sin sanar el edge-runtime).
// --no-backup: el stack es efímero y los orquestadores hacen `db reset` después → no hay datos
// locales que preservar.
//
// Un único módulo: exporta `startSupabaseWithRetry` (comandos inyectables → testeable sin
// Docker) y, sólo cuando se ejecuta directo (`node scripts/supabase-start-retry.mjs`, lo usa
// ci.yml en el job Integration), corre el wrapper. El guard `isMain` evita que importarlo desde
// el unit test dispare Docker.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const IS_WIN = process.platform === 'win32';

const defaultStart = () =>
  execFileSync('pnpm', ['exec', 'supabase', 'start'], { stdio: 'inherit', shell: IS_WIN });
const defaultStop = () =>
  execFileSync('pnpm', ['exec', 'supabase', 'stop', '--no-backup'], {
    stdio: 'inherit',
    shell: IS_WIN,
  });
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startSupabaseWithRetry({
  start = defaultStart,
  stop = defaultStop,
  sleep = defaultSleep,
  log = (m) => console.log(m),
  maxAttempts = 3,
  backoffMs = 5000,
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      start();
      if (attempt > 1) log(`[supabase-start] OK en el intento ${attempt}/${maxAttempts}.`);
      return attempt;
    } catch (err) {
      const msg = err?.message ?? String(err);
      log(`[supabase-start] intento ${attempt}/${maxAttempts} falló: ${msg}`);
      if (attempt === maxAttempts) throw err;
      log('[supabase-start] supabase stop --no-backup + reintento…');
      try {
        stop();
      } catch (e) {
        log(`[supabase-start] stop falló (ignoro): ${e?.message ?? e}`);
      }
      await sleep(backoffMs);
    }
  }
}

// Sólo corre al invocarse como `node scripts/supabase-start-retry.mjs` (ci.yml job Integration).
// Importado desde el unit test, isMain=false → no dispara Docker.
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  startSupabaseWithRetry().catch(() => {
    console.error(
      '\n[supabase-start] `supabase start` falló tras los reintentos. ¿Docker corriendo?',
    );
    process.exit(1);
  });
}
