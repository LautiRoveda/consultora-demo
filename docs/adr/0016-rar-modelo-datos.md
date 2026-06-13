# ADR-0016 · Modelo de datos del RAR (agentes de riesgo + exposición)

**Fecha:** 2026-06-13
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** orquestador (tech lead), CC (implementación T-143)

## Contexto

El RAR (Relevamiento de Agentes de Riesgo) es la DJ anual que el empleador presenta a su ART declarando los trabajadores expuestos a agentes de riesgo (Dto 658/96 + Res SRT 37/2010). Es un vertical nuevo que arranca con la **Fase 1** (catálogo de agentes + modelo de exposición) y crecerá con la nómina de expuestos + planilla PDF (Fase 2) y el vencimiento anual en el calendario (Fase 3).

Antes de codear hubo que fijar tres decisiones de modelado que condicionan todas las fases siguientes y que no queremos re-discutir ticket a ticket.

## Opciones evaluadas

### A · Granularidad del "establecimiento"
- **A1 — modelar `establecimientos` como tabla nueva** (un cliente puede tener varios). Más fiel al RAR real (la DJ es por establecimiento), pero `clientes` ya tiene `domicilio`/`localidad`/`provincia`/`art` y no hay tabla de establecimientos en el modelo → implicaría una migración estructural + recablear empleados/EPP. Sobre-ingeniería para el MVP.
- **A2 — cliente = establecimiento en el MVP.** Cada cliente representa un establecimiento. Cero cambios al modelo existente; suficiente para el grueso de las PYMEs target (un establecimiento por cliente). Si aparece el caso multi-establecimiento, se modela en una fase posterior.

### B · Nivel de la exposición
- **B1 — exposición por empleado** (junction empleado×agente). Máxima granularidad, pero el consultor declararía agente por agente para cada empleado → fricción alta y datos redundantes (los empleados de un mismo puesto comparten exposición).
- **B2 — exposición por puesto** (junction `puesto_agentes`). El empleado **hereda** la unión de agentes de sus puestos vía `empleados_puestos` (ya existe). Refleja cómo se piensa la exposición en HyS (por tarea/puesto), minimiza la carga de datos. Sin override por empleado en el MVP (se puede sumar después si un caso lo pide).

### C · Catálogo de agentes
- **C1 — reutilizar `AGENTES_HYS`** (la lista de medición del relevamiento técnico). Conflactaría dos conceptos distintos (medición de un informe técnico vs agentes declarables del 658/96) → rompe SRP y acopla dos features.
- **C2 — catálogo nuevo `rar_agentes`**, per-consultora, seedeable con los códigos ESOP reales (Res SRT 81/2019, Anexo III).

## Decisión

**A2 + B2 + C2.** Cliente = establecimiento en el MVP, exposición a nivel **puesto** (junction `puesto_agentes`), catálogo propio `rar_agentes` separado de `AGENTES_HYS`.

La junction `puesto_agentes` nace con **FK COMPUESTAS Ring A** (ver [ADR-0015](0015-integridad-datos-ciclo-vida.md)): `(puesto_id, consultora_id) → puestos(id, consultora_id)` y `(agente_id, consultora_id) → rar_agentes(id, consultora_id)`, garantizando estructuralmente que puesto y agente pertenecen a la misma consultora que la fila. Enum cerrado `agente_riesgo_tipo` (`fisico | quimico | biologico | ergonomico`).

## Consecuencias

- **Positivas:** modelo mínimo y desacoplado; cero cambios a tablas existentes (migración aditiva pura); la herencia puesto→empleado evita redundancia; el catálogo propio respeta SRP; Ring A desde el día cero evita la deuda de coherencia que el T-121 tuvo que retro-corregir.
- **Negativas:** cliente=establecimiento no cubre multi-establecimiento (aceptable en MVP); sin override de exposición por empleado (un empleado no puede tener un agente extra/menos respecto de su puesto hasta que se modele).
- **Inciertas:** si los consultores piden declarar exposición a nivel empleado o multi-establecimiento antes de lo previsto, habrá que extender el modelo (junction empleado×agente como override, o tabla `establecimientos`).

## Referencias

- T-143 (PR #259, squash `94b9241`) · migración `20260613000001_t143_rar_agentes_exposicion.sql`.
- [ADR-0015](0015-integridad-datos-ciclo-vida.md) · FK compuestas Ring A / integridad de ciclo de vida.
- Res. SRT 81/2019, Anexo III — Listado de Códigos de Agentes de Riesgo (ESOP), reglamentario del Dto 658/96 (IF-2019-87699049-APN-GP#SRT).
- Decreto 658/96 · Listado de Enfermedades Profesionales.
