# ADR-0013 · Tablas SRT verificadas al prompt IA

**Fecha:** 2026-05-27
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** Higienista (feedback 2026-05-23), análisis competitivo audit item A6 (Previo / GENESIS / SIGHyS / Previnnova / SEHIGIENE), documentación oficial Infoleg verificada el 2026-05-27 (Res SRT 85/2012 + Decreto 351/79 Anexo V), documentación Anthropic prompt caching verificada el 2026-05-27 (`https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching`)

## Contexto

El prompt de relevamiento ([`src/shared/ai/prompts/relevamiento.ts`](../../src/shared/ai/prompts/relevamiento.ts)) prohíbe a la IA citar resoluciones SRT por miedo a alucinación. La regla (línea 39 pre-T-107) decía literal: *"NUNCA cites resoluciones SRT con número exacto salvo que estés 100% seguro de la vigencia. Usá genérico 'Resolución SRT vigente sobre [tema]' — el profesional pone el número correcto al revisar"*. Patch defensivo razonable cuando la IA no tenía contexto verificado.

Análisis competitivo (audit A6, 2026-05-23): ningún competidor argentino tiene IA generativa con umbrales SRT incorporados. El consultor cobra entre $200-500k ARS por protocolo de ruido. Si la IA le ahorra ~3h evaluando puestos contra TLV con número de norma correcto, el plan Pro USD 30/mes se paga solo. Diferenciador único identificado como palanca alta — justifica el ticket T-107.

Decisión arquitectónica necesaria: **cómo y dónde guardar las tablas SRT verificadas** (Res 85/12 ruido en MVP; Res 84/12 iluminación, Res 886/15 ergonomía, Res 295/03 químicos, IRAM WBGT carga térmica en follow-ups).

## Opciones evaluadas

### Opción A: Tablas SRT como `const` TypeScript + injector dinámico (elegida)

- **Pros:**
  - Versionado vía git: cada update es PR con diff visible + quote textual de fuente primaria.
  - Sin UI admin, sin migration, sin RLS: cero overhead operativo MVP.
  - Cero costo runtime: no DB query en hot path de generación.
  - Type-safe via `SRTTable` type + `AgenteHys` enum del schema relevamiento.
  - Inyección como segundo `cache_control` breakpoint en `system[]` → cache hit cuando misma combinación de agentes consecutiva (regeneración del mismo informe = hit garantizado).
- **Contras:**
  - Cada actualización SRT requiere PR + redeploy (no hot config / no toggle runtime).
  - Si la tabla está mal cargada, la IA cita mal → el matriculado FIRMA y revisa, mitigando responsabilidad legal pero NO costo reputacional.

### Opción B: Tablas SRT en tabla `srt_tables` DB

- **Pros:**
  - Hot update sin redeploy.
  - UI admin podría delegar el bump a no-developers.
- **Contras:**
  - UI admin + migration + RLS + audit log + tests integration adicionales — sin ganancia clara (las tablas SRT cambian raramente, 1-2x por década).
  - DB query agregado al hot path de generación.
  - Riesgo de divergencia entre prod y dev / cross-tenant si no se hace global table.

### Opción C: IA con web search tool en runtime (Anthropic web search)

- **Pros:**
  - Auto-update: la IA fetcha la norma vigente en el momento.
- **Contras:**
  - Latencia +2-5s por request por la web call.
  - Costo de tokens del web result.
  - Variabilidad de fuente: el endpoint Infoleg puede devolver formato distinto entre requests.
  - Riesgo de alucinación amplificado por contenido externo no validado.

## Decisión

**Opción A.** Tablas SRT como `const` TypeScript versionadas via git + helper `injectSRTTables` que devuelve markdown a inyectar al prompt.

**Scope MVP T-107**: solo `RES_85_12_RUIDO` (Res SRT 85/12 + Decreto 351/79 Anexo V). Iluminación, ergonomía, químicos, carga térmica difieren a T-107-FU0..FU3.

**Arquitectura del `system[]` array** (Anthropic SDK 0.95.1, hasta 4 cache breakpoints por request):

| Posición | Contenido | Cache cross-informe |
|---|---|---|
| `system[0]` | `SYSTEM_PROMPT_RELEVAMIENTO` static (~3600 tokens) | Sí — siempre el mismo. |
| `system[1]` | Bloque SRT condicional (1755 tokens medidos para Res 85/12) | Sí cuando misma combinación de `agentes_a_relevar`. |

**Tokens medidos del bloque** (`scripts/dev-measure-srt-tokens.ts`, 2026-05-27): **1755 tokens** (≥1024 mínimo Sonnet 4.6 → cache hit garantizado, margen de +731 tokens). No fue necesario aplicar ninguno de los 3 fallbacks documentados (enriquecer / concat `system[0]` / userMessage prefix).

**Regla SRT condicional en `relevamiento.ts`** (post-T-107):

- Si en el prompt aparece un bloque `## Criterios SRT para evaluación de [AGENTE]` → CITAR literal el número y vigencia de las normas listadas. Valores autorizados para cita exacta.
- Si NO aparece bloque SRT para un agente del user prompt → modo genérico `"Resolución SRT vigente sobre [tema]"`.
- NUNCA inventar números fuera del prompt.

**Disclaimer obligatorio en output del informe**: footnote al final de la subsección de Ruido en `## 4. Mediciones realizadas`:

> Nota normativa: Valores de referencia conforme Resolución SRT 85/2012 y Decreto 351/79 Anexo V (modificado por Res MTEySS 295/2003). Vigencia verificada al **{VERIFIED_AT}**. El matriculado responsable de firmar el informe debe verificar la vigencia actual de las normativas citadas en https://www.srt.gob.ar antes de la presentación legal.

El helper `injectSRTTables` reemplaza `{VERIFIED_AT}` con la fecha del campo `version_tabla` (formato `YYYY-MM-DD-vN`) antes de pasar el bloque al prompt.

## Consecuencias

- **Positivas:**
  - Diferenciador competitivo único en el mercado AR.
  - Versionado via git + PR review (cambios visibles en diff con quote textual de fuente).
  - Cero costo de runtime (no DB query).
  - Cache hit del 2do breakpoint cuando hay regeneración del mismo informe o informes consecutivos del mismo consultor con mismos agentes — ~$0.006 de ahorro por hit a 1755 tokens (marginal por request, relevante a escala).
  - `formatVerifiedAt` throws on invalid format → un disclaimer con fecha rota es bug VISIBLE que el matriculado nota al revisar (silent fallback escondería el problema).
- **Negativas:**
  - Cada actualización SRT requiere PR + redeploy. Aceptable porque las normas SRT cambian raramente (Dec 351/79 sigue siendo base hace 47 años).
  - Si una tabla queda stale (norma reemplazada sin que nadie lo detecte), la IA cita mal hasta el próximo bump. Mitigación: política forward (sección siguiente) + disclaimer con vigencia visible en el output.
  - El bloque SRT depende de la combinación de `agentes_a_relevar` — cache hit cross-informe requiere mismo set de agentes. Para sets distintos, el `system[0]` sigue cacheando normal (es prefix base).
- **Inciertas:**
  - Detección de cambios SRT depende de proceso manual mensual. Si SRT publica modificación intermedia y nadie la detecta, riesgo reputacional real. T-107-FU4 (bot de detección automática) queda fuera del MVP — evaluar en Sprint 6 según fricción real.
  - La derivación matemática de la escala de tiempo permisible (q=3 dB / TLV 85 → 85→8h, 88→4h, ..., 106→3.75min) NO es transcripción literal de la Tabla 1 del Dec 351/79 Anexo V (que está como imagen no extraíble en Infoleg). Se cargó con nota explícita "derivado matemáticamente" + el matriculado verifica contra Tabla 1 oficial al firmar.

## Política de actualización forward

1. **Detección**:
   - Lectura mensual de:
     - Newsletter SRT (`https://www.srt.gob.ar/normativa`).
     - RSS Boletín Oficial sección Trabajo.
   - Responsable manual: Lautaro (hasta T-107-FU4 con bot de detección automática).

2. **Cambio menor (valor numérico, vigencia, fraseo del protocolo)**:
   - Bump del campo `version_tabla` en el `const` correspondiente (`YYYY-MM-DD-vN` → `YYYY-MM-DD-v(N+1)`).
   - Commit con quote textual literal de la nueva fuente primaria + URL Infoleg en el mensaje.
   - PR review obligatorio (no merge directo).
   - Redeploy automático EasyPanel webhook.
   - Entry en `docs/lessons-learned.md` sección `## AI / Prompts` si el cambio cambia comportamiento del LLM (ej. nuevo criterio de evaluación).

3. **Cambio mayor (resolución reemplazada por número nuevo)**:
   - Nuevo file `res-XX-YY-[agente].ts` con la nueva norma + `version_tabla` nuevo.
   - Update de `SRT_TABLES_BY_AGENTE` en `src/shared/ai/srt-tables/index.ts` para apuntar al nuevo.
   - Versión vieja queda en `git history` (NO se mantiene como `RES_85_12_V1` archived para evitar confusión runtime).
   - Disclaimer en el output cambia automáticamente porque el helper lee `version_tabla` actualizado.

4. **Sin automatización en MVP**. Solo proceso manual + esta documentación.

## Notas de implementación

- Ticket: **T-107** (primer ticket post-Sprint 5 EPP).
- Tests: [`src/tests/unit/srt-tables-injection.test.ts`](../../src/tests/unit/srt-tables-injection.test.ts) — 7 tests (5 helper + 2 parser). Convención repo: tests puros sobre `const` van a `unit/`, no `integration/` (precedente directo: `epp-suggest-prompt.test.ts`).
- Módulo: [`src/shared/ai/srt-tables/`](../../src/shared/ai/srt-tables/) con `res-85-12-ruido.ts` (const + formato) + `index.ts` (helper).
- Route handler modificado: [`src/app/api/informes/[id]/generate-stream/route.ts`](../../src/app/api/informes/[id]/generate-stream/route.ts) construye `systemBlocks` dinámico — si `srtTablesBlock !== ''`, pushea segundo breakpoint con cache_control ephemeral; si no, queda solo el bloque static.
- Audit log de `informe_content_generated` ahora incluye campo `srtBlocks: number` (0 ó 1) para verificar cache hit del 2do breakpoint en logs productivos.
- Script `scripts/dev-measure-srt-tokens.ts` + entry `pnpm dev:measure-srt-tokens` en `package.json` para futuras mediciones al sumar Res 84/12 / Res 886/15 / etc.

## Referencias

- [Res SRT 85/2012 — Infoleg](https://servicios.infoleg.gob.ar/infolegInternet/anexos/190000-194999/193617/norma.htm) (verificado 2026-05-27)
- [Decreto 351/79 Anexo V — Infoleg](https://servicios.infoleg.gob.ar/infolegInternet/anexos/30000-34999/32030/dto351-1979-anexo5.htm) (verificado 2026-05-27)
- [Anthropic prompt caching docs](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-caching) (verificado 2026-05-27, mínimo Sonnet 4.6 = 1024 tokens, hasta 4 cache breakpoints por request)
- [`docs/adr/0003-modelo-claude-default.md`](./0003-modelo-claude-default.md) — Sonnet 4.6 como modelo default del proyecto
- [`docs/lessons-learned.md`](../lessons-learned.md) — sección `## AI / Prompts` con entry T-107
- Commits T-107: `fb7600b` (módulo srt-tables), `3f6983b` (relevamiento.ts regla condicional), `54aa9bf` (route.ts system array), `a8ba3df` (tests unit)
