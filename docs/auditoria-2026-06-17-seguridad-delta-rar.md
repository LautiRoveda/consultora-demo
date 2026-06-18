# Auditoría de seguridad — ConsultoraDemo · DELTA RAR (Opus 4.8)

**Fecha:** 2026-06-17 · **Auditor:** orquestador (Opus 4.8), read-only · **Alcance:** el código
de producto que entró **después** de la auditoría del 2026-06-10 y no fue cubierto por ella —
esencialmente la épica **RAR** (Relevamiento de Agentes de Riesgo, T-143..T-147) más T-115 (billing,
ya revisado en su PR). Metodología: dos pasadas read-only en paralelo (SQL/RLS + Server
Actions/Route Handlers) aplicando el mismo checklist del informe `auditoria-2026-06-10-seguridad-opus48.md`.

## Veredicto

Postura **fuerte, sin regresión respecto del 2026-06-10**. **Cero hallazgos críticos / altos / medios.**
El delta RAR sigue fielmente los patrones ya auditados: RLS en cada tabla nueva vía los helpers,
funciones `security definer` con `search_path = ''` y grants sin `anon`/`public`, el único RPC
service-role gateado y con tenancy derivada del contexto autenticado, FK compuestas Ring A que cierran
cross-tenant a nivel constraint, auth con `getUser()`, Zod en cada borde, e IDOR/SSRF cerrados.

Resultado: **1 bajo de seguridad** (B-1, defense-in-depth) + **1 bajo de correctness** (B-2, no es
seguridad) + **2 informativos** (ya conocidos/aceptados).

## Hallazgos

| ID  | Sev            | Área                                                                 | Estado     |
| --- | -------------- | -------------------------------------------------------------------- | ---------- |
| B-1 | Bajo (seg.)    | `update/archive/restore` de agentes: SELECT/UPDATE sin `consultora_id` explícito | ✅ Cerrado (T-157) |
| B-2 | Bajo (correct.)| `parseRarSnapshot`: `faltan_datos` derivado sobre jsonb crudo        | FU bug     |
| I-1 | Info           | FK compuesto `calendar_events(... )` para `rar_anual`                 | Diferido   |
| I-2 | Info           | Token interno de PDF comparado sin constant-time                     | Aceptado   |

### B-1 · `updateAgenteAction` / `archiveAgenteAction` / `restoreAgenteAction`: sin `consultora_id` explícito (Bajo, defense-in-depth)

`src/app/(app)/rar/actions.ts` — el SELECT de existencia y el UPDATE posterior filtraban solo por
`.eq('id', ...)`, sin `.eq('consultora_id', auth.ctx.consultoraId)`. **No era un IDOR explotable:**
`rar_agentes` tiene RLS y `requireOwner` ya ataba al tenant (un id de otro tenant daba `NOT_FOUND`). El
gap era de defensa-en-profundidad y consistencia con los Route Handlers de PDF, que sí hacían el chequeo
explícito. **Remediado en T-157** (#283): `.eq('consultora_id', ...)` en SELECT y UPDATE de las tres +
guard de aislamiento cross-tenant en `t143-rar-actions.test.ts`.

### B-2 · `parseRarSnapshot` deriva `faltan_datos` sobre el jsonb crudo (Bajo, correctness — NO seguridad)

`src/app/(app)/rar/snapshot.ts:89` — el flag `faltan_datos` se evalúa sobre el objeto crudo antes de la
normalización con `nullableStr`. Un `cuil: " "` (whitespace) reportaría `faltan_datos = false` aunque sea
efectivamente nulo. Impacto: una planilla histórica podría mostrar mal el flag de "datos incompletos". No
expone datos ni cross-tenant. **No es un hallazgo de seguridad** — follow-up de correctness, diferido.

### I-1 · FK compuesto para `rar_anual` (Informativo, diferido)

El evento `rar_anual` lleva `metadata.cliente_id`; el semáforo ya lo revalida contra `my_consultora_ids()`
en la lectura (patrón L-1), y lo crea siempre la RPC service-role con un `cliente_id` ya validado por RLS.
Un FK compuesto cerraría el vector en la raíz. Es el **mismo follow-up diferido** que el informe del
2026-06-10 documentó para `calendar_events.informe_id`. Hardening estructural, no urgente.

### I-2 · Token interno de PDF sin constant-time (Informativo, aceptado)

`src/app/(print)/layout.tsx` compara el token con `!==`. Vive solo en memoria del proceso, rota en cada
boot (`randomBytes(32)`), y no hay canal de timing (siempre `notFound()`). Suficiente para el modelo de
amenaza. Sin acción.

## Verificado OK (sin hallazgo)

**SQL / RLS:** RLS habilitado en `rar_agentes`, `cliente_puesto_agentes`, `rar_presentaciones` ·
policies vía `is_member_of_consultora` / `my_consultora_ids`, cero `USING(true)` / `WITH CHECK(true)`,
INSERT anclan `created_by = auth.uid()` · las funciones audit + `gen_rar_vencimiento_calendar_for` +
`semaforo_clientes` con `security definer` + `set search_path = ''` · RPC `revoke` de `public/anon/
authenticated`, grant solo `service_role` · la RPC revalida tenancy (único call-site `presentarRarAction`
con `consultoraId` del contexto + cliente RLS-validado) · rama `rar_anual` del semáforo re-scopea el id
derivado (patrón L-1) · FK compuestas Ring A en cada junction · `rar_presentaciones` append-only (solo
policy SELECT; INSERT solo vía RPC; audit trigger solo INSERT) + `unique(consultora_id, cliente_id,
periodo)`.

**Server Actions / Route Handlers:** auth con `getUser()`, nunca `getSession()` para autorizar · Zod en
cada borde + params de ruta validados con `UUID_REGEX`, bounds 1:1 con los CHECK SQL · tenancy/IDOR:
cada recurso resuelto bajo RLS antes de usarse, las routes y print pages agregan el chequeo explícito
`consultora_id === consultora.id` → 404 · service-role precedido de SELECT-RLS **+** FK compuesta como
barrera estructural · billing-gate vía `requireMemberWithBilling` / `billingAccessForRoute` (T-115) ·
cero `.or()` / `.ilike()` con input de usuario (lección L-4) · SSRF de los PDF cerrado (base interna
loopback + params UUID-validados, no se construyen paths desde input) · sin fuga de service-role ni
secrets al cliente, errores limpios (sin stack traces).

## Cierre

- **B-1** → remediado en **T-157** (#283).
- **B-2** → follow-up de correctness (no seguridad).
- **I-1 / I-2** → diferidos a criterio del owner, consistentes con los del informe previo.

## Referencias

- Auditoría base: `docs/auditoria-2026-06-10-seguridad-opus48.md` (veredicto fuerte, M-1/L-1..L-4 cerrados).
- Modelo de datos RAR: `docs/adr/0016-rar-modelo-datos.md`.
- Estrategia RLS + claim JWT: `docs/adr/0006-multi-tenant-rls-strategy.md`.
