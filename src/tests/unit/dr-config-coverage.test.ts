/**
 * T-082-FU5 · Guard anti-drift del runbook de Disaster Recovery.
 *
 * docs/operations/disaster-recovery.md afirma cosas VERIFICABLES sobre el repo
 * (scripts de backup, .gitignore, buckets, tabla de secrets §4). Ya se
 * desincronizó en silencio: afirmaba backups automáticos inexistentes; la tabla
 * §4 omitía los secrets de MP y Sentry; backup-storage olvidaba `epp-firmas`
 * (firmas legales Res 299/11). Este test-meta rompe en CI cuando esas
 * afirmaciones dejan de matchear el código real.
 *
 * Alias operativo: `pnpm verify:dr-config` (corre solo este archivo). Igual corre
 * en CI vía la unit suite (`pnpm test`), sin job nuevo.
 *
 * NO reparsea supabase/migrations para los buckets — eso ya lo hace
 * storage-buckets-coverage.test.ts. Acá el cross-check de buckets es
 * RUNBOOK ↔ STORAGE_BUCKETS (la constante), reusándola como única fuente.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { STORAGE_BUCKETS } from '@/shared/storage/types';

// Este archivo vive en src/tests/unit/ → cuatro niveles arriba está la raíz del repo.
const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');
const RUNBOOK = join(REPO_ROOT, 'docs', 'operations', 'disaster-recovery.md');
const ENV_TS = join(REPO_ROOT, 'src', 'env.ts');
const PKG_JSON = join(REPO_ROOT, 'package.json');
const GITIGNORE = join(REPO_ROOT, '.gitignore');
const BACKUP_DB = join(REPO_ROOT, 'scripts', 'backup-db.ts');
const BACKUP_STORAGE = join(REPO_ROOT, 'scripts', 'backup-storage.ts');

const readText = (path: string): string => readFileSync(path, 'utf8');

/**
 * Keys del schema Zod de src/env.ts, parseadas del SOURCE como texto.
 *
 * NO importamos `envSchema`: src/env.ts importa 'server-only' y hace
 * `envSchema.safeParse(process.env)` + throw en top-level (env.ts:166) — en el
 * tier unit (sin esas env vars) el import rompería al cargar el módulo. Parsear
 * el texto es además el idiom de los otros test-meta del repo.
 */
function envKeysFromSource(): Set<string> {
  const src = readText(ENV_TS);
  // Scope: solo el cuerpo de `z.object({ ... })`, hasta `const parsed = ...`.
  const body = src.slice(src.indexOf('z.object({'), src.indexOf('const parsed'));
  const keys = new Set<string>();
  // Línea que arranca con EXACTAMENTE 2 espacios + KEY UPPER_SNAKE + ':'. El ancla
  // `^ {2}` y el `[A-Z]` inicial descartan comentarios (`  // ...`) y las
  // propiedades anidadas de los validadores Zod (van a indent ≥4).
  for (const m of body.matchAll(/^ {2}([A-Z][A-Z0-9_]*)\s*:/gm)) {
    keys.add(m[1]!);
  }
  return keys;
}

/**
 * Env vars de la tabla §4 del runbook ("Backup de secrets/env vars").
 *
 * Scopeamos la sección §4 (entre su header y el de §5) y capturamos el nombre en
 * backticks de la 1ª celda de cada fila. El `[A-Z]` inicial excluye los bullets
 * de Vault en minúscula (`cron_dispatch_*`); el sufijo `(público)` queda fuera
 * del grupo (va después del backtick de cierre).
 */
function section4VarsFromRunbook(): Set<string> {
  const md = readText(RUNBOOK);
  const start = md.search(/^##\s+§4\.\s/m);
  if (start === -1) {
    throw new Error('No se encontró la sección §4 en el runbook DR — ¿renombraron el header?');
  }
  const rest = md.slice(start + 1);
  const nextHeader = rest.search(/^##\s+§5\b/m);
  const section = nextHeader === -1 ? rest : rest.slice(0, nextHeader);

  const vars = new Set<string>();
  for (const line of section.split(/\r?\n/)) {
    const m = line.match(/^\|\s*`([A-Z][A-Z0-9_]*)`/);
    if (m) vars.add(m[1]!);
  }
  return vars;
}

// ── Allowlists de excepciones legítimas (con razón por entrada) ──────────────

// En src/env.ts pero NO en la tabla §4: no son "secrets críticos a snapshotear al
// rotar" (que es lo que lista §4). Si una deja de estar en env.ts o se agrega a
// §4, el test anti-pudrición de abajo obliga a sacarla de acá.
const ENV_NOT_IN_TABLE = new Set([
  'SENTRY_FORCE_ENABLE', // dev-override: forzar envío a Sentry desde NODE_ENV=development. Vacío en prod.
  'MP_TEST_PAYER_EMAIL', // dev/test-only: NUNCA en prod (warn explícito post-parse, env.ts:187).
]);

// En la tabla §4 pero NO en src/env.ts: secret de build-time consumido por
// withSentryConfig (upload de source maps), nunca validado por el Zod schema.
const TABLE_NOT_IN_ENV = new Set([
  'SENTRY_AUTH_TOKEN', // build-time (CI), fuera de envSchema.safeParse.
]);

describe('guard: afirmaciones verificables del runbook DR vs repo (T-082-FU5)', () => {
  it('A · .gitignore ignora /backups/ (el runbook §2/§3/§10 lo asume)', () => {
    const ignored = readText(GITIGNORE)
      .split(/\r?\n/)
      .map((l) => l.trim());
    expect(
      ignored.some((l) => /^\/?backups\/?$/.test(l)),
      'El runbook DR asume que backups/ está en .gitignore (contiene PII: DNI/CUIL/firmas EPP ' +
        'Res 299/11). Agregá `/backups/` a .gitignore.',
    ).toBe(true);
  });

  it('B · package.json define backup:db y backup:storage apuntando a sus scripts', () => {
    const pkg = JSON.parse(readText(PKG_JSON)) as { scripts?: Record<string, string> };
    const scripts = pkg.scripts ?? {};
    expect(
      scripts['backup:db'] ?? '',
      'El runbook §2/§10 documenta `pnpm backup:db`. Falta el script en package.json.',
    ).toMatch(/scripts\/backup-db\.ts/);
    expect(
      scripts['backup:storage'] ?? '',
      'El runbook §3/§10 documenta `pnpm backup:storage`. Falta el script en package.json.',
    ).toMatch(/scripts\/backup-storage\.ts/);
  });

  it('C · los scripts de backup existen y referencian sus env vars + STORAGE_BUCKETS', () => {
    expect(existsSync(BACKUP_DB), 'Falta scripts/backup-db.ts (lo documenta el runbook §2).').toBe(
      true,
    );
    expect(
      existsSync(BACKUP_STORAGE),
      'Falta scripts/backup-storage.ts (lo documenta el runbook §3).',
    ).toBe(true);

    const dbSrc = readText(BACKUP_DB);
    const stSrc = readText(BACKUP_STORAGE);
    expect(dbSrc, 'backup-db.ts debe leer SUPABASE_DB_URL (runbook §2).').toMatch(
      /\bSUPABASE_DB_URL\b/,
    );
    expect(
      stSrc,
      'backup-storage.ts debe leer NEXT_PUBLIC_SUPABASE_URL (runbook Troubleshooting).',
    ).toMatch(/\bNEXT_PUBLIC_SUPABASE_URL\b/);
    expect(
      stSrc,
      'backup-storage.ts debe leer SUPABASE_SERVICE_ROLE_KEY (runbook Troubleshooting).',
    ).toMatch(/\bSUPABASE_SERVICE_ROLE_KEY\b/);
    expect(
      stSrc,
      'backup-storage.ts debe IMPORTAR STORAGE_BUCKETS de shared/storage/types (NO hardcodear la ' +
        'lista — un bucket olvidado = pérdida de datos silenciosa, pasó con epp-firmas).',
    ).toMatch(
      /import\s*\{[^}]*\bSTORAGE_BUCKETS\b[^}]*\}\s*from\s*['"][^'"]*shared\/storage\/types['"]/,
    );
  });

  it('D · el runbook nombra todos los buckets de STORAGE_BUCKETS (§1/§3)', () => {
    const runbook = readText(RUNBOOK);
    const missing = [...STORAGE_BUCKETS].filter((b) => !runbook.includes(b));
    expect(
      missing,
      'El runbook DR (§1/§3) debe nombrar todos los buckets de STORAGE_BUCKETS. Faltan en ' +
        'docs/operations/disaster-recovery.md:\n' +
        missing.join('\n'),
    ).toEqual([]);
  });

  it('E.1 · cada env var de src/env.ts está documentada en la tabla §4 (o allowlisted)', () => {
    const envKeys = envKeysFromSource();
    const tableVars = section4VarsFromRunbook();
    const undocumented = [...envKeys]
      .filter((k) => !tableVars.has(k))
      .filter((k) => !ENV_NOT_IN_TABLE.has(k))
      .sort();
    expect(
      undocumented,
      'Estas env vars están en src/env.ts pero NO en la tabla §4 del runbook DR. Una env var ' +
        'nueva sin documentar = drift (pasó con MP_*/SENTRY_*). Arreglá UNA de dos formas:\n' +
        '  (1) agregala a la tabla §4 de docs/operations/disaster-recovery.md (caso normal), O\n' +
        '  (2) si es dev-override/no-secret, sumala a ENV_NOT_IN_TABLE con un comentario que ' +
        'explique por qué queda fuera.\nOffenders:\n' +
        undocumented.join('\n'),
    ).toEqual([]);
  });

  it('E.2 · cada var de la tabla §4 existe en src/env.ts (o allowlisted)', () => {
    const envKeys = envKeysFromSource();
    const tableVars = section4VarsFromRunbook();
    const orphan = [...tableVars]
      .filter((v) => !envKeys.has(v))
      .filter((v) => !TABLE_NOT_IN_ENV.has(v))
      .sort();
    expect(
      orphan,
      'Estas vars están en la tabla §4 del runbook pero NO en el schema Zod de src/env.ts. O ' +
        'sobran en la tabla (sacalas), O son build-time consumidas fuera del Zod (agregalas a ' +
        'TABLE_NOT_IN_ENV con comentario).\nOffenders:\n' +
        orphan.join('\n'),
    ).toEqual([]);
  });

  it('sanity · el parser de src/env.ts captura las 27 keys esperadas', () => {
    expect(
      envKeysFromSource().size,
      'El parser de src/env.ts dejó de capturar 27 keys. O agregaste/sacaste una env var (en ese ' +
        'caso actualizá la tabla §4 + este número), o el regex se rompió por un cambio de formato ' +
        '(indent ≠ 2 espacios). Revisá envKeysFromSource().',
    ).toBe(27);
  });

  it('sanity · el parser de la tabla §4 captura las 26 vars esperadas', () => {
    expect(
      section4VarsFromRunbook().size,
      'El parser de la tabla §4 dejó de capturar 26 vars. O editaste la tabla (actualizá este ' +
        'número), o el scope/regex se rompió (¿renombraron el header §4/§5? ¿cambió el formato de fila?).',
    ).toBe(26);
  });

  it('allowlist no se pudre · ENV_NOT_IN_TABLE: cada entrada sigue en env.ts y fuera de §4', () => {
    const envKeys = envKeysFromSource();
    const tableVars = section4VarsFromRunbook();
    const stale = [...ENV_NOT_IN_TABLE].filter((k) => !envKeys.has(k) || tableVars.has(k));
    expect(
      stale,
      'Entradas de ENV_NOT_IN_TABLE que ya no aplican (salieron de env.ts, o YA están en la tabla ' +
        '§4 → la excepción sobra). Sacalas de la allowlist:\n' +
        stale.join('\n'),
    ).toEqual([]);
  });

  it('allowlist no se pudre · TABLE_NOT_IN_ENV: cada entrada sigue en §4 y fuera de env.ts', () => {
    const envKeys = envKeysFromSource();
    const tableVars = section4VarsFromRunbook();
    const stale = [...TABLE_NOT_IN_ENV].filter((v) => !tableVars.has(v) || envKeys.has(v));
    expect(
      stale,
      'Entradas de TABLE_NOT_IN_ENV que ya no aplican (salieron de §4, o YA están en env.ts → la ' +
        'excepción sobra). Sacalas de la allowlist:\n' +
        stale.join('\n'),
    ).toEqual([]);
  });
});
