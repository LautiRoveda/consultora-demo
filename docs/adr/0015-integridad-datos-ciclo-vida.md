# ADR-0015 · Integridad de datos: fuente de verdad única + ciclo de vida de pendientes

**Fecha:** 2026-06-04
**Estado:** Aceptada (parcialmente implementada: clases A / B-EPP / C en prod; B-CAPAs y D pendientes)
**Decisor:** Lautaro
**Consultados:** auditoría 2026-06-04 disparada por el smoke del asistente IA de EPP (T-117); PRs #204 (T-114), #208 (T-119), #209 (T-118); `docs/lessons-learned.md` (DB / migrations).

## Contexto

El smoke del asistente IA de EPP (T-117) destapó respuestas inconsistentes: la fecha que mostraba el chat no coincidía con la del calendario, y planificaciones ya re-entregadas seguían figurando como "activas". Al rastrearlo apareció un **patrón sistémico**, no un bug puntual:

- (a) `calendar_events` **duplica** `fecha`/`status` del dominio (`epp_planificaciones`, `acciones_correctivas`) sin sincronización: editar un lado dejaba el otro desactualizado.
- (b) Máquinas de estado con valores de **cierre** en el enum que el código **nunca seteaba** → los pendientes generados nacían `activa`/`abierta` y se acumulaban como fantasmas.

## Opciones evaluadas

### Opción A: fix puntual por síntoma (solo el bug del smoke)

- Pros: mínimo cambio.
- Contras: no ataca la clase; el patrón reaparece en cada nueva proyección/pendiente.
- Costo / esfuerzo: bajo. **Descartada** (no resuelve la causa).

### Opción B: invariantes sistémicas (triggers de sync + lifecycle + unicidad + FK coherentes)

- Pros: elimina la clase entera; la integridad vive en la DB (trigger + constraint), no en disciplina de código.
- Contras: migraciones + backfills + triggers a mantener; más superficie de test de integración.
- Costo / esfuerzo: medio (varias migraciones idempotentes + backfills validados en prod).

## Decisión

Adoptar el invariante (Opción B):

1. **Fuente única**: toda `fecha`/`status` proyectada a `calendar_events` tiene fuente de verdad única, sincronizada por **trigger AFTER UPDATE** (T-118).
2. **Ciclo de vida**: todo pendiente generado (planificación, CAPA) tiene un **flujo de cierre explícito** + **unicidad** que lo blinde (T-119 para EPP; **T-120 pendiente** para CAPAs).
3. **FK / ON DELETE coherentes**: `CASCADE` por tenant, `RESTRICT` hacia padres de dominio, `SET NULL` en links opcionales.

**Clases halladas:** A (sync calendario↔dominio → T-118) · B (lifecycle incompleto → T-119 EPP, T-120 CAPAs) · C (unicidad faltante → T-119) · D (`consultora_id` denormalizado sin validar → T-121 dormido).

## Consecuencias

- **Positivas:** el chat / ficha / calendario muestran lo mismo siempre; no hay acumulación de pendientes fantasma; la integridad vive en la DB (trigger de sync + unique parciales + backfills), no en disciplina de código.
- **Negativas:** más migraciones / triggers / backfills a mantener; se suman guards de integridad a los tests de integración.
- **Inciertas:** falta cerrar B-CAPAs (T-120) y D (T-121, dormido); observar si aparecen nuevas clases al sumar proyecciones / pendientes.

## Referencias

- T-114 (#204), T-118 (#209), T-119 (#208), T-117 / FU1 (#206 / #207).
- `docs/lessons-learned.md` → "Sincronización proyección↔dominio por trigger" + "Lifecycle: los pendientes generados necesitan un flujo de cierre" + "Numeración de migraciones".
- Follow-ups: **T-120** (lifecycle CAPAs con evidencia), **T-121** (dormido: CHECK/trigger de coherencia de `consultora_id`).
