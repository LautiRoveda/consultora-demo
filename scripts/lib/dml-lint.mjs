// T-152 · Lint heurístico de DML PELIGROSO en migraciones (Fase 2 auditoría CI/CD).
//
// Complementa a squawk (T-151), que es DDL-céntrico y NO ve mutaciones de datos.
// Atrapa las 3 formas de DML masivo que rompen al APLICAR la migración:
//   - update-without-where : UPDATE ... SET ... sin WHERE   (full-table rewrite + lock)
//   - delete-without-where : DELETE FROM ... sin WHERE       (wipe de tabla)
//   - truncate             : TRUNCATE (bare o cascade; squawk solo ve ban-truncate-cascade)
//
// BEST-EFFORT, NO es un muro. Atrapa el caso común; no garantiza contra sintaxis
// evasiva. Falsos NEGATIVOS aceptables y conocidos:
//   - DML escondido tras `loop`/`begin` sin `;` intermedio (no arranca el segmento).
//   - Un WHERE que vive SOLO en un subquery del statement (lo contamos como "tiene WHERE").
//   - Tags dollar anidados con el mismo tag (el repo no los usa).
// Si hace falta permitir un DML full-table INTENCIONAL y seguro, usar el pragma:
//   -- lint:dml-allow <regla> — <motivo>
// en la misma sentencia (cualquier línea de ella) o la línea justo encima.
//
// PRECISIÓN: el preprocesamiento blanquea, ANTES de los regex, todo lo que generaría
// falsos positivos, preservando largo y `\n` (los offsets siguen mapeando a líneas):
//   1. comentarios de bloque  /* ... */
//   2. comentarios de línea   -- ...
//   3. regiones dollar-quoted $tag$...$tag$ cuyo lead-in NO sea `do`  ->  BLANK
//      (cuerpos de CREATE FUNCTION/PROCEDURE = DML de RUNTIME, strings de `comment on`
//       con tag $c$, comandos de cron.schedule con tag $cron$). Los `do $$...$$` SÍ se
//       escanean: su DML corre al aplicar la migración.
//   4. string literals '...'  (con '' escapado)
// EDGE CASE (documentado, FP cubierto por el pragma): el paso de dollar-quotes (3) corre
// ANTES del de strings (4). Un string literal top-level que contenga un literal `$$`
// (p.ej. `set msg = 'a$$b'`) puede confundirse con la apertura de un dollar-quote y
// blanquear de más. El historial no tiene ese caso; una migración futura así daría un
// FP puntual silenciable con el pragma.

export const DML_RULES = Object.freeze([
  'update-without-where',
  'delete-without-where',
  'truncate',
]);

// Detección por segmento (case-insensitive). El `[\w".]+` OBLIGATORIO entre `update` y
// `set` descarta el upsert `... on conflict ... do update set` (ahí no hay tabla entre
// medio). El anclaje a `update <ident> set` / `delete from <ident>` ignora `after update
// of`, `on update cascade`, `for update`, `updated_at`, `set_updated_at`.
const UPDATE_RE = /\bupdate\s+(?:only\s+)?[\w".]+(?:\s+(?:as\s+)?[a-z_]\w*)?\s+set\b/i;
const DELETE_RE = /\bdelete\s+from\s+(?:only\s+)?[\w".]+/i;
const TRUNCATE_RE = /\btruncate\b/i;
const WHERE_RE = /\bwhere\b/i;

// Reemplaza cada char != '\n' por espacio: mantiene largo y posiciones de línea.
function blankKeepNewlines(s) {
  return s.replace(/[^\n]/g, ' ');
}

function stripBlockComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, blankKeepNewlines);
}

function stripLineComments(s) {
  return s.replace(/--[^\n]*/g, (m) => ' '.repeat(m.length));
}

// Blanquea las string literals SQL, respetando el escape '' (dos comillas).
function stripStrings(s) {
  return s.replace(/'(?:[^']|'')*'/g, blankKeepNewlines);
}

// ¿El dollar-quote que abre en `openStart` es el cuerpo de un DO block? (lead-in `do`,
// opcionalmente `do language <lang>`). Si NO, es función/comment/cron string -> blank.
function isDoBlock(prefix) {
  return /\bdo\s+(?:language\s+[A-Za-z0-9_]+\s+)?$/i.test(prefix);
}

// Procesa las regiones dollar-quoted: KEEP los DO blocks (DML migration-time), BLANK el
// resto (cuerpos de función/procedure, strings $c$ de comment on, $cron$ de cron.schedule).
function processDollarQuotes(s) {
  const openRe = /\$([A-Za-z0-9_]*)\$/g;
  let result = '';
  let cursor = 0;
  while (true) {
    openRe.lastIndex = cursor;
    const m = openRe.exec(s);
    if (!m) {
      result += s.slice(cursor);
      break;
    }
    const openStart = m.index;
    const tag = m[1];
    const closeTok = `$${tag}$`;
    const closeStart = s.indexOf(closeTok, openStart + m[0].length);
    const regionEnd = closeStart === -1 ? s.length : closeStart + closeTok.length;

    result += s.slice(cursor, openStart); // texto previo, intacto
    const region = s.slice(openStart, regionEnd);
    result += isDoBlock(s.slice(0, openStart)) ? region : blankKeepNewlines(region);
    cursor = regionEnd;
  }
  return result;
}

// SQL "limpio" para el escaneo: mismo largo y mismas posiciones de línea que `raw`.
export function preprocess(raw) {
  let s = stripBlockComments(raw);
  s = stripLineComments(s);
  s = processDollarQuotes(s);
  s = stripStrings(s);
  return s;
}

// Pragmas de allow, leídos del RAW (antes de borrar comentarios). 1-based.
export function extractPragmas(raw) {
  const re = /--\s*lint:dml-allow\s+(update-without-where|delete-without-where|truncate)\b/i;
  const out = [];
  raw.split('\n').forEach((ln, idx) => {
    const m = re.exec(ln);
    if (m) out.push({ line: idx + 1, rule: m[1].toLowerCase() });
  });
  return out;
}

// Nº de línea (1-based) del offset dentro de `text`.
function lineAt(text, offset) {
  let line = 1;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}

// Devuelve [{ line, rule, snippet }] de las violaciones NO silenciadas por pragma.
export function findViolations(raw) {
  const clean = preprocess(raw);
  const pragmas = extractPragmas(raw);
  const violations = [];

  let segStart = 0;
  for (let i = 0; i <= clean.length; i++) {
    if (i === clean.length || clean[i] === ';') {
      checkSegment(clean.slice(segStart, i), segStart, clean, pragmas, violations);
      segStart = i + 1;
    }
  }
  return violations;
}

function checkSegment(seg, segStart, clean, pragmas, violations) {
  const leadWs = seg.length - seg.trimStart().length;
  const spanStartLine = lineAt(clean, segStart + leadWs);
  const spanEndLine = lineAt(clean, segStart + seg.length);

  const tryRule = (rule, re, needNoWhere) => {
    const m = re.exec(seg);
    if (!m) return;
    if (needNoWhere && WHERE_RE.test(seg)) return;
    // Silenciado si hay un pragma de la MISMA regla en la sentencia (o la línea encima).
    const silenced = pragmas.some(
      (p) => p.rule === rule && p.line >= spanStartLine - 1 && p.line <= spanEndLine,
    );
    if (silenced) return;
    const snippet = seg.slice(m.index).replace(/\s+/g, ' ').trim().slice(0, 80);
    violations.push({ line: lineAt(clean, segStart + m.index), rule, snippet });
  };

  tryRule('truncate', TRUNCATE_RE, false);
  tryRule('update-without-where', UPDATE_RE, true);
  tryRule('delete-without-where', DELETE_RE, true);
}
