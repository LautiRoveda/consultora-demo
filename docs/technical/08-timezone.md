# 08 · Timezone policy

ConsultoraDemo es una app para consultores argentinos. Toda fecha visible — UI app, PDFs, emails, Telegram, push, logs — se muestra en `America/Argentina/Buenos_Aires` independientemente del runtime (UTC del container Docker, local del browser del user). Storage en Postgres es UTC normalizado vía `timestamptz` y no se toca.

## Reglas

1. **Storage**: Postgres `timestamptz` para timestamps + Postgres `date` para fechas civiles sin hora. No usar `timestamp` (sin tz).
2. **Display**: todas las funciones de formato vienen de [src/shared/lib/format-date.ts](../../src/shared/lib/format-date.ts). Hardcodean `timeZone: 'America/Argentina/Buenos_Aires'` en cada `Intl.DateTimeFormat`.
3. **Prohibido en código nuevo**: `toLocaleDateString`, `toLocaleString` (para fechas), `Intl.DateTimeFormat` directo, `date-fns/format()` sobre timestamps. Use el helper o sea explícito en el code review por qué no aplica.
4. **Excepción documentada**: [src/app/(app)/calendario/event-form-helpers.ts](../../src/app/(app)/calendario/event-form-helpers.ts) (`dateToCivilIso`/`civilIsoToDate`) hace roundtrip Date↔YYYY-MM-DD en browser-local TZ. Es correcto bajo su contrato — el date picker tiene que respetar la TZ del browser para que el día clickeado matchee el día guardado. Fase 2 con users fuera de AR requerirá revisar.

## Dos familias de helpers

El helper tiene dos sets de funciones según el tipo de dato:

### Timestamps UTC (`timestamptz`: `created_at`, `firmado_at`, `completed_at`, …)

Convierten el timestamp UTC a TZ AR para display.

| Función | Output |
|---|---|
| `formatDateAR(input)` | `"25/05/2026"` |
| `formatDateTimeAR(input)` | `"25/05/2026 14:30"` |
| `formatDateShortAR(input)` | `"25 de may de 2026"` |
| `formatDateLongAR(input)` | `"25 de mayo de 2026"` |
| `formatDateLongWithWeekdayAR(input)` | `"lunes, 25 de mayo de 2026"` |
| `formatRelativeAR(input, now?)` | `"hace 3 días"` / `"ayer"` / `"dentro de 2 horas"` |

### Civil dates YYYY-MM-DD (`date`: `fecha_vencimiento`, `fecha_ingreso`, …)

Tratan el string como literal del calendario. **No** aplican conversión TZ — evita off-by-one.

| Función | Output |
|---|---|
| `formatCivilDateAR(civilIso)` | `"25/05/2026"` |
| `formatCivilDateShortAR(civilIso)` | `"25 de may de 2026"` |
| `formatCivilDateLongAR(civilIso)` | `"25 de mayo de 2026"` |
| `formatCivilDateLongWithWeekdayAR(civilIso)` | `"lunes, 25 de mayo de 2026"` |

### Utilidad "hoy" AR

| Función | Output |
|---|---|
| `todayCivilIsoAR(now?)` | `"2026-05-25"` (día calendario AR, no UTC) |

Reemplaza `new Date().toISOString().slice(0,10)` (UTC) y `dateToCivilIso(new Date())` (browser-local) para casos donde el "hoy" debe ser AR independiente del runtime.

## Decisión: ¿por qué dos familias?

`new Date('2026-05-25')` en JS interpreta como UTC midnight. En TZ AR (UTC−3) eso es `24/05/2026 21:00` — un off-by-one silencioso. Para campos Postgres `date` (civiles), eso es siempre el bug.

La separación explícita en dos familias obliga al call site a declarar qué tipo de dato está formateando, en vez de detectar por substring (frágil).

Internamente, el helper civil construye `new Date(Date.UTC(y, m-1, d, 15, 0, 0))` — mediodía UTC = 12:00 AR — y formatea con `timeZone: AR_TIMEZONE`. La hora del mediodía está lejos de cualquier cruce de día, por lo que el día extraído es idempotente al runtime TZ.

## Runtime

[Dockerfile](../../Dockerfile) stage `runner` setea `ENV TZ=America/Argentina/Buenos_Aires` + instala `tzdata`. Defense-in-depth — el helper ya es robusto, pero el env cubre:

- Logs (pino timestamps).
- Código legacy no migrado.
- cron triggers que dependan de hora local del container.

**No** se setea en el stage builder. El build de Next.js corre en UTC para no leakear TZ a páginas estáticas pre-renderizadas.

## Verificación

```bash
# El test unit del helper verifica los formatos exactos contra fechas conocidas:
pnpm test src/tests/unit/format-date.test.ts

# Si el helper rompiera por runtime TZ leak, los assertions hardcoded fallarían.
# Eso ES lo que el test valida — por eso NO manipulamos process.env.TZ en
# beforeEach (en Node, Intl resuelve TZ al boot; cambiar la var en runtime
# no afecta el output).

# Container TZ verificable post-build:
docker build -t consultora-demo:test .
docker run --rm consultora-demo:test date
# Output esperado: "Mon May 25 14:30:00 -03 2026" (suffix "-03", no "UTC").
```

## Out of scope (Fase 2)

- Selector de TZ per-user (cuando lleguen users fuera de AR).
- Soporte DST (Argentina no tiene DST desde 2009, offset fijo −3 — no se anticipa cambio).
- `CRON_TZ` per-job (los crons ya setean su propio TZ donde aplica; no se toca).

## Referencias

- ADR-0006 multi-tenant RLS (mención al patrón "TZ AR hardcoded MVP").
- Decisión de discovery D08: foco del producto en consultores AR.
- Lesson learned: T-028-FU3 (TZ per-consultora deferido — implementado a nivel TZ AR única).
