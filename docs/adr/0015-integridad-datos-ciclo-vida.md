# ADR-0015 · Integridad de datos: fuente de verdad única + ciclo de vida de pendientes

**Fecha:** 2026-06-04
**Estado:** Aceptada — IMPLEMENTADA OPERATIVAMENTE (2026-06-05): clase A (T-118 calendario→dominio + T-122 billing plan-cache), B (T-119 EPP + T-120 CAPAs), C (T-119 unicidad), D-RingA (T-121 FK compuestas ownership). Ring B/C (T-121-FU) dormido.
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
2. **Ciclo de vida**: todo pendiente generado (planificación, CAPA) tiene un **flujo de cierre explícito** + **unicidad** que lo blinde (T-119 para EPP; **T-120** ✅ para CAPAs).
3. **FK / ON DELETE coherentes**: `CASCADE` por tenant, `RESTRICT` hacia padres de dominio, `SET NULL` en links opcionales.

**Clases halladas:** A (sync calendario↔dominio → T-118 ✅; cache billing plan → T-122 ✅) · B (lifecycle incompleto → T-119 EPP ✅, T-120 CAPAs ✅) · C (unicidad faltante → T-119 ✅) · D (`consultora_id` denormalizado sin validar → T-121 Ring A ✅; Ring B/C → T-121-FU dormido).

**Instancias adicionales del patrón (post-decisión, 2026-06-05):** T-122 (cache denormalizado `consultoras.plan` ↔ `suscripciones.estado` = clase A en billing, sync por trigger `AFTER INSERT/UPDATE OF estado`) · T-123 (skip de reminders al finalizar evento = backstop estructural por trigger, idea de T-118) · T-124 (gate-leak `cancelada` + `cancelar_en NULL` cerrado en la app + churn reaper que flipa `cancelada`-vencida → `expirada`, engranando con T-122).

## Consecuencias

- **Positivas:** el chat / ficha / calendario muestran lo mismo siempre; no hay acumulación de pendientes fantasma; la integridad vive en la DB (trigger de sync + unique parciales + backfills), no en disciplina de código.
- **Negativas:** más migraciones / triggers / backfills a mantener; se suman guards de integridad a los tests de integración.
- **Inciertas:** B-CAPAs (T-120) y D-RingA (T-121) ✅ cerradas; queda Ring B/C (T-121-FU, dormido); observar si aparecen nuevas clases al sumar proyecciones / pendientes.

## Referencias

- T-114 (#204), T-118 (#209), T-119 (#208), T-117 / FU1 (#206 / #207), T-122 (#211), T-120 (#212), T-123 (#213), T-124 (#214), T-121 (#215).
- `docs/lessons-learned.md` → "Sincronización proyección↔dominio por trigger" + "Lifecycle: los pendientes generados necesitan un flujo de cierre" + "Numeración de migraciones" + "FK compuesta para coherencia de tenant denormalizado" + "Cache denormalizado: fuente única + sync por trigger" + "Gate leak: una `cancelada` sin `cancelar_en` daba acceso".
- Follow-ups: **T-120** (lifecycle CAPAs con evidencia) ✅, **T-121** (coherencia `consultora_id`, Ring A) ✅; **T-121-FU** (dormido: Ring B/C — nullable/self-ref + system rows con `consultora_id NULL`, donde `MATCH SIMPLE` no protege).
