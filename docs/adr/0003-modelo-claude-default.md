# ADR-0003 · Actualización del modelo Claude default

**Fecha:** 2026-05-09
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** documentación oficial Anthropic verificada el 2026-05-09 (`https://platform.claude.com/docs/en/docs/about-claude/models`)

## Contexto

La documentación previa (`docs/technical/00-skills-y-stack.md`, `docs/technical/02-architecture.md`, `CLAUDE.md`, `index.html`) menciona como default a **Sonnet 4.5** y como modelo de análisis complejos a **Opus 4.6**. Al 2026-05-09 esos no son los modelos vigentes: Anthropic ya liberó Claude Opus 4.7 y Claude Sonnet 4.6 como las versiones generally available más capaces de cada familia. Las versiones previas siguen disponibles en la sección "legacy models" pero son sucesivamente reemplazables.

Si llegamos al Sprint 4 (T-039 · cliente IA abstracto en `src/shared/ai/client.ts`) escribiendo código contra IDs desactualizados, vamos a:
- Pagar más por output o input de lo necesario (los modelos nuevos suelen mejorar relación calidad/precio).
- Asumir riesgo de retiro silencioso.
- Romper el principio P7 (documentación viva): la doc no refleja el estado real de Anthropic.

Por eso fijamos *ahora*, en T-001, el modelo default oficial del proyecto y dejamos sincronizada la doc.

## Opciones evaluadas

### Opción A: Sonnet 4.6 default + Haiku 4.5 simple + Opus 4.7 complejo (elegida)

- **Pros:** todos current/GA. Sonnet 4.6 conserva el mismo precio que Sonnet 4.5 (USD 3/15 por MTok) con mejor calidad y soporte de extended thinking + adaptive thinking. Opus 4.7 es la última generación con un salto explícito en agentic coding (relevante para Fase 4-5: análisis de accidentabilidad, jerarquía de controles, comparación de versiones de norma). Haiku 4.5 ya estaba bien elegido en la doc previa y se mantiene.
- **Contras:** Opus 4.7 es relativamente nuevo (cutoff de conocimiento ene-2026). Hay que monitorear que no aparezcan regresiones específicas para nuestros casos de uso.
- **Costo:** sin cambio respecto del plan anterior — los precios por MTok se mantienen.

### Opción B: Quedarse con Sonnet 4.5 + Opus 4.6 (statu quo de la doc previa)

- **Pros:** documentación no requiere update; modelos siguen funcionando como legacy disponible.
- **Contras:** se queda atrás del estado del arte sin razón. Riesgo de retiro futuro. Falla P7.
- **Costo:** mismo que A (mismos precios), pero peor calidad por dólar.

### Opción C: Default Opus 4.7 para todo

- **Pros:** máxima calidad.
- **Contras:** USD 5/25 por MTok versus USD 3/15 de Sonnet 4.6 — 67% más caro en input, 67% más en output. Para informes técnicos (caso de uso primario) Sonnet 4.6 es suficiente. Viola P9 (costo bajo control).
- **Costo:** ~67% más por informe en promedio. Inviable para Plan Pro USD 30.

## Decisión

**Opción A.** Los modelos oficiales del proyecto al 2026-05-09 son:

| Uso | Modelo | API ID (snapshot pinned) | Alias | Precio (in/out por MTok) |
|-----|--------|--------------------------|-------|--------------------------|
| Default — informes técnicos completos (Ruido, Iluminación, PAT, RGRL, Carga de Fuego), comparación de normas con razonamiento profundo, prompts sistémicos cacheados | **Sonnet 4.6** | `claude-sonnet-4-6` | `claude-sonnet-4-6` | USD 3 / USD 15 |
| Tareas simples — clasificación, extracción de campos, sugerencias cortas (ej: kit de EPP por puesto), resúmenes | **Haiku 4.5** | `claude-haiku-4-5-20251001` | `claude-haiku-4-5` | USD 1 / USD 5 |
| Análisis complejos — jerarquía de controles para accidentabilidad, agentic workflows multi-paso, generación masiva con razonamiento profundo | **Opus 4.7** | `claude-opus-4-7` | `claude-opus-4-7` | USD 5 / USD 25 |

**Convención:** usar siempre el ID con snapshot pinned (columna "API ID") en código de producción. Los alias se aceptan en docs y prototipos. Desde la generación 4.6 el ID dateless ya es un snapshot pinned, no un evergreen pointer — lo aclara explícitamente la doc oficial.

**Modelos legacy todavía disponibles** (los listo por si en algún momento queremos versionar contra una salida específica de Sonnet 4.5 o reproducir un informe histórico): Sonnet 4.5 (`claude-sonnet-4-5-20250929`), Opus 4.6 (`claude-opus-4-6`), Opus 4.5 (`claude-opus-4-5-20251101`), Opus 4.1 (`claude-opus-4-1-20250805`).

**Modelos deprecated con fecha de retiro 2026-06-15** (no usar en código nuevo): Sonnet 4 original (`claude-sonnet-4-20250514`) y Opus 4 original (`claude-opus-4-20250514`).

## Consecuencias

- **Positivas:**
  - La unión de los IDs vivirá en `src/shared/ai/client.ts` (T-039), un solo lugar para cambiar.
  - P9 (costo bajo control) se respeta: default sigue siendo el modelo de mejor relación calidad/precio.
  - P7 (documentación viva) se cumple desde el día uno: ningún archivo en el repo va a quedar mencionando IDs retirados.
  - Cuando T-039 implemente el wrapper, los modelos a usar ya están definidos sin discusión.
- **Negativas:**
  - Habrá que volver a este ADR cuando Anthropic libere Sonnet 4.7 / Opus 4.8. Reemplazo formal con un nuevo ADR-NNNN, no edición silenciosa.
  - Asumimos que Opus 4.7 no tiene regresiones específicas para nuestros casos. Si aparecen, fallback a Opus 4.6 documentado en nuevo ADR.
- **Inciertas:**
  - Calidad real de Sonnet 4.6 vs. Sonnet 4.5 en informes técnicos en español argentino con normativa SRT específica. Habrá que medir con muestras durante Sprint 4 (T-040 a T-044).
  - Variabilidad de costos por consultora en producción. El campo `ai_cost_usd` en `informes` (ver `docs/technical/03-data-model.md`) más `ai_usage_log` permite el monitoreo.

## Notas de implementación

- **Footnote para T-039:** verificar última versión disponible en `docs.anthropic.com/en/docs/about-claude/models` antes de implementar el cliente IA abstracto. Si ya hay un Sonnet 4.7 / Opus 4.8 GA, abrir nuevo ADR antes de codear.
- **Consulta programática:** Anthropic expone una Models API (`/docs/en/api/models/list`) que devuelve `max_input_tokens`, `max_tokens` y `capabilities`. Podemos agregar un job de health-check mensual que valide que los IDs definidos siguen siendo válidos — propuesta para tomar en Sprint 4 o post-MVP.

## Referencias

- [docs.anthropic.com — Models overview](https://docs.anthropic.com/en/docs/about-claude/models) (verificado 2026-05-09)
- [`docs/technical/00-skills-y-stack.md`](../technical/00-skills-y-stack.md) — sincronizado en este commit
- [`docs/technical/02-architecture.md`](../technical/02-architecture.md) — referencia indirecta
- [`docs/adr/0002-stack-eleccion.md`](./0002-stack-eleccion.md) — ADR padre del stack que fija Anthropic SDK como capa de IA
- Roadmap T-039 (`docs/technical/10-roadmap.md`) — cuando se materializa esta decisión en código
