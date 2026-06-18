# T-159 · Paginación + búsqueda server-side en listados — PRE-LANZAMIENTO (Tier 0)

> **Estado:** abierto (FU de T-158). **Prioridad: pre-lanzamiento (Tier 0)** — NO
> es un FU dormido. Bloquea calidad de cara a clientes medianos/grandes.

## Por qué Tier 0 (no dormido)

T-158 (E2E a volumen) descubrió y **dejó aseverado** que los listados core truncan
silenciosamente a 50 filas y la búsqueda sólo filtra esas 50 (client-side). En uso
real **la lista de empleados es la primera en romper**: un cliente industrial tiene
50-200 empleados, y la entrega EPP (Res SRT 299/11) es POR empleado → el flujo core
queda roto para clientes medianos/grandes. Por eso esto va antes del lanzamiento.

Las aserciones que documentan la limitación viven en
[`src/tests/e2e/volume.spec.ts`](../../src/tests/e2e/volume.spec.ts) (tests 4 y 5,
tag `@volume`). Cuando este ticket cierre, esas aserciones pasan de "no aparece" a
"aparece paginado" → invertirlas es la señal de done.

## Hallazgos verificados (T-158)

- **Clientes** ([clientes/page.tsx:34](../../src/app/(app)/clientes/page.tsx)): fetchea
  con `limit:50` default / sin `offset`, **ignora el `q` server-side**. La búsqueda
  es client-side sobre el array cargado ([ClientesList.tsx:59](../../src/app/(app)/clientes/ClientesList.tsx)).
- **Empleados** (per-cliente): `getEmpleadosByCliente` limit **50**
  ([empleados/queries.ts:34-59](../../src/app/(app)/empleados/queries.ts)); búsqueda
  client-side ([EmpleadosList.tsx:81](../../src/app/(app)/empleados/EmpleadosList.tsx)).
  **Confirmado: la lista de empleados es per-cliente, NO existe lista global
  cross-cliente** ([empleados/page.tsx:9-16](../../src/app/(app)/empleados/page.tsx)) —
  decisión arquitectural cerrada. El límite exacto que rompe es **50 por cliente**.
- **Informes** ([informes/queries.ts:28-40](../../src/app/(app)/informes/queries.ts)):
  `listInformes` hard `.limit(50)`, **sin `offset` ni params** (el comentario de
  [InformesList.tsx:15](../../src/app/(app)/informes/InformesList.tsx) ya lo anticipaba:
  "paginacion ... llegan en T-025+", nunca shipeado).

## Alcance

1. **Búsqueda server-side**: pasar `q` al query (clientes/empleados) — hoy se ignora.
   Las queries de clientes/empleados ya soportan `offset`; falta cablear `q` + el UI.
2. **Paginación UI**: paginador o "cargar más" en clientes, empleados (per-cliente) e
   informes. Para informes hay que **agregar `offset`/`limit` params a `listInformes`**
   (hoy hard-codeado a 50 sin offset).
3. **Defaults sanos**: mantener 50/página; el dashboard ya capa clientes a 200
   ([dashboard/queries.ts:99](../../src/app/(app)/dashboard/queries.ts)) — revisar si
   ese cap necesita ajuste cuando haya >200 clientes.
4. **Tests**: invertir los asserts de truncación de `volume.spec.ts` (4 y 5) a
   "aparece paginado / la búsqueda lo encuentra"; agregar E2E de navegación de páginas.

## No-objetivos

- Lista global cross-cliente de empleados (decisión cerrada — sigue per-cliente).
- Búsqueda full-text / fuzzy (alcance mínimo: `ilike` server-side sobre los campos
  que hoy matchea el filtro client-side: razón social / nombre fantasía / CUIT para
  clientes; apellido / nombre / DNI para empleados).

## Convenciones

RLS intacta (las queries ya scopean por tenant), Zod en el borde de los params de
paginación, español, commits Formato A.
