// T-137 · Genera src/shared/supabase/types.ts y stripea el bloque __InternalSupabase.
//
// PORQUÉ: prod corre PostgREST 14.5 y el stack local (`supabase start`) 14.x.
// `supabase gen types typescript --linked` (db:types, dev sin Docker) inserta como
// primer miembro de `Database` un bloque `__InternalSupabase: { PostgrestVersion: "..." }`
// con el string de versión del PostgREST del target; `--local` (el gate de drift de CI)
// NO lo inserta → drift textual en cada `db:types`, que obligaba a hand-editear el archivo.
// Ese miembro es info de ENTORNO, no de schema: el footer generado ya hace
// `Omit<Database, '__InternalSupabase'>`, así que borrarlo es no-op a nivel de tipos.
// Lo stripeamos en AMBOS lados (db:types --linked y el gate --local) con esta MISMA
// normalización → un solo code-path y db:types ↔ gate idempotentes entre sí, robusto ante
// cualquier bump de PostgREST de prod (managed) o del CLI local.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const IS_WIN = process.platform === 'win32';
const OUT = 'src/shared/supabase/types.ts';
const flag = process.argv.includes('--local') ? '--local' : '--linked';

function fail(msg) {
  console.error(`\n[t137] ${msg}`);
  process.exit(1);
}

// 1. gen types (capturamos stdout). `pnpm exec` porque supabase es devDep y este script se
//    invoca también como `node scripts/gen-types.mjs --local` fuera de un `pnpm run` (step
//    de CI), donde node_modules/.bin NO está garantizado en PATH.
console.log(`[t137] supabase gen types typescript ${flag}...`);
let raw = '';
try {
  raw = execFileSync('pnpm', ['exec', 'supabase', 'gen', 'types', 'typescript', flag], {
    encoding: 'utf8',
    shell: IS_WIN,
    maxBuffer: 32 * 1024 * 1024,
  });
} catch {
  fail(`\`supabase gen types typescript ${flag}\` falló.`);
}

// 2. Strip del bloque __InternalSupabase: el comentario generado que lo precede ("// Allows
//    to automatically instantiate createClient...") MÁS el miembro en sí. `(?:...//...)*`
//    consume las líneas de comentario inmediatamente previas (de wording variable → no las
//    hardcodeamos); el miembro no tiene llaves anidadas adentro → [^{}]* es seguro.
const hadBlock = /[ \t]*__InternalSupabase:\s*\{/.test(raw);
const stripped = raw.replace(
  /\n(?:[ \t]*\/\/[^\n]*\n)*[ \t]*__InternalSupabase:\s*\{[^{}]*\}\n/,
  '\n',
);

// 3. Fail-loud: si venía el bloque y el regex no lo borró, NO escribimos un types.ts que
//    rompería el gate — preferimos red automática a un drift silencioso (la forma exacta
//    del bloque pudo cambiar en el CLI → ajustar el regex de arriba).
if (hadBlock && /[ \t]*__InternalSupabase:\s*\{/.test(stripped)) {
  fail(
    'El bloque __InternalSupabase seguía presente tras el strip. Revisá el regex contra el ' +
      'output real de `supabase gen types`.',
  );
}

writeFileSync(OUT, stripped);

// 4. prettier --write (se mantiene, como el db:types original). `pnpm exec` por lo mismo.
console.log('[t137] prettier --write...');
try {
  execFileSync('pnpm', ['exec', 'prettier', '--write', OUT], {
    stdio: 'inherit',
    shell: IS_WIN,
  });
} catch {
  fail('`prettier --write` falló.');
}
