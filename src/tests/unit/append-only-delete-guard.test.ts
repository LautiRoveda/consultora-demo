import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * T-113b · Guard anti-regresión del patrón DELETE-muerto sobre tablas append-only.
 *
 * Contexto (DEUDA-A en operativo.md): varios tests escritos ANTES de los triggers de
 * inmutabilidad limpiaban con `admin.from('<tabla>').delete()` sobre audit_log /
 * notification_log / billing_notifications_log. Post-trigger ese DELETE lanza excepción
 * que supabase-js devuelve en `{ error }` SIN throw → no-op silencioso que nadie chequea.
 * Se coló justamente porque no es obvio que falla. Esta red lo bloquea en CI: prohíbe el
 * patrón en cualquier test salvo los 3 que PRUEBAN a propósito que el trigger lo rechaza.
 *
 * Es un test-meta (escanea el fuente), no una regla ESLint custom: ~self-contained, corre
 * en el tier unit (sin DB) y la allowlist queda explícita y legible acá.
 */

// Este archivo vive en src/tests/unit/ → dos niveles arriba está src/tests/.
const TESTS_DIR = join(fileURLToPath(import.meta.url), '..', '..');

// Tablas con trigger `BEFORE DELETE … RAISE EXCEPTION` (inmutables). NO incluye
// notification_digest_log: es append-only por convención pero SIN trigger, su delete sí
// funciona (ver migración 20260531000001).
const APPEND_ONLY_TABLES = ['audit_log', 'notification_log', 'billing_notifications_log'];

// Detecta `.from('<tabla>').delete()` en single-line y multi-line: `\s*` consume los
// saltos de línea del query builder encadenado. No matchea SELECTs (ahí sigue `.select(`).
const DELETE_PATTERN = new RegExp(
  `\\.from\\(\\s*['"](?:${APPEND_ONLY_TABLES.join('|')})['"]\\s*\\)\\s*\\.delete\\(\\s*\\)`,
);

// Allowlist: estos 3 tests capturan `{ error }` y asertan `/inmutable/` — su `.delete()`
// ES la aserción (prueba que el trigger *_no_delete rechaza el DELETE), no cleanup. Si
// alguno deja de probar la inmutabilidad, su entrada debe salir de esta allowlist.
const ALLOWLIST = new Set([
  'rls.test.ts', // audit_log_no_delete
  'notification-log-rls.test.ts', // notification_log_no_delete
  'audit-followup.test.ts', // billing_notifications_log_no_delete
]);

function listTestFiles(): string[] {
  return readdirSync(TESTS_DIR, { recursive: true })
    .map((p) => String(p))
    .filter((p) => p.endsWith('.test.ts'))
    .map((p) => join(TESTS_DIR, p));
}

function matchesPattern(file: string): boolean {
  return DELETE_PATTERN.test(readFileSync(file, 'utf8'));
}

describe('guard: DELETE sobre tablas append-only en tests (T-113b)', () => {
  it('ningún test usa .from(<append-only>).delete() fuera de la allowlist', () => {
    const offenders = listTestFiles()
      .filter(matchesPattern)
      .map((f) => relative(TESTS_DIR, f).replace(/\\/g, '/'))
      .filter((rel) => !ALLOWLIST.has(basename(rel)));

    expect(
      offenders,
      `Patrón DELETE-muerto sobre tabla append-only (audit_log / notification_log / ` +
        `billing_notifications_log). El trigger lo rechaza → es un no-op silencioso. ` +
        `Scopeá las queries por entity_id/ref_id o no limpies (ver T-113b):\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('cada archivo de la allowlist todavía contiene la aserción de inmutabilidad (no se pudre)', () => {
    const files = listTestFiles();
    const stale = [...ALLOWLIST].filter((allowed) => {
      const file = files.find((f) => basename(f) === allowed);
      return !file || !matchesPattern(file);
    });

    expect(
      stale,
      `Allowlist desactualizada: estos archivos ya no contienen ` +
        `.from(<append-only>).delete() — sacalos de la allowlist:\n${stale.join('\n')}`,
    ).toEqual([]);
  });
});
