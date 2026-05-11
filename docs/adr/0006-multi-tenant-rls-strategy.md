# ADR-0006 · Multi-tenancy con shared DB + RLS + custom claim en JWT

**Fecha:** 2026-05-10
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** docs Supabase Auth + RLS, patrón canónico documentado por Supabase para `app_metadata` custom claims, experiencia de Sprint 0 con `service-role` y proxy de refresh de sesión.

## Contexto

T-011 abre Sprint 1 con la migración del schema multi-tenant core (`consultoras`, `consultora_members`, `audit_log`). Es la decisión arquitectónica más crítica de la Fase 1: todos los módulos futuros (informes, EPP, calendario, checklists, capacitaciones, permisos, accidentabilidad, documentos, pagos) van a heredar este contrato. Refactorizar después de tener data en producción es ~10× más caro (data loss risk, downtime, FK cascadas).

Necesitamos elegir una estrategia de aislamiento de datos por tenant que:

- Mantenga aislamiento **dura** (un user de la consultora A nunca puede leer data de la consultora B, ni por bug de aplicación).
- Sea **simple operacionalmente** (1 base, 1 schema, 1 deploy).
- Funcione con el stack ya elegido (Supabase Postgres + Auth + RLS).
- Tenga overhead aceptable de performance (hasta ~10K consultoras sin penalty notable).
- Soporte el roadmap conocido (plan Team con multi-user por consultora, plan Enterprise con multi-establecimiento, eventualmente multi-tenant per user si crece).

`docs/technical/01-principles.md` P2 ya fija "Seguridad por defecto" + "RLS en cada tabla" como no negociable. El ADR define **cómo** se cumple en concreto.

## Opciones evaluadas

### Opción A · Schemas separados por tenant (`tenant_{id}`)

Cada consultora en su propio schema Postgres. Connection switching por request.

- **Pros:**
  - Aislamiento físico fuerte. Imposible cross-tenant query sin permisos explícitos.
  - Backup/restore granular por tenant.
- **Contras:**
  - Operacionalmente caro: cada migration aplica N veces (1 por schema).
  - Connection pooling no soporta well dynamic search_path. PgBouncer transaction pooling fuerza re-`SET search_path` cada query.
  - Supabase Auth + Storage asumen `public` schema. No es el flow soportado.
  - Estadísticas globales (KPIs de SaaS) requieren cross-schema queries → caro.
  - Costo Postgres: cada schema agrega overhead de metadata.
- **Descartado por:** complejidad operacional + fricción con Supabase.

### Opción B · Shared DB + RLS por subquery contra `consultora_members`

Una sola base, una tabla `consultora_id` por tabla, policy chequea `EXISTS (SELECT FROM consultora_members WHERE user_id = auth.uid() AND consultora_id = X)`.

- **Pros:**
  - Simple. Sin custom JWT claims, no requiere Auth Hook.
  - El estado de membership vive en una sola fuente (la tabla).
- **Contras:**
  - **Cada query con RLS hace JOIN/EXISTS contra `consultora_members`**. Para una query principal típica, RLS dispara N subqueries (una por tabla involucrada). El planner las cachea pero el costo no es cero.
  - Inviting/expelling: la policy responde al instante, pero el JWT del user sigue válido hasta expirar — el frontend muestra UI según el JWT y queda inconsistente con la DB.
  - Más complejo testear: cada test RLS necesita data en `consultora_members`.
- **Descartado por:** performance + falta de un único "tenant id efectivo" claro.

### Opción C · Shared DB + RLS por custom claim en JWT (`app_metadata.consultora_id`) — ELEGIDA

Una sola base. Cada tabla con FK `consultora_id`. RLS policy compara `consultora_id = current_consultora_id()`, donde la función SQL `current_consultora_id()` extrae el id del JWT del request.

El claim `app_metadata.consultora_id` se inyecta vía **Supabase Auth Hook** (T-016, custom JWT hook que corre en cada token issue). El hook lee `consultora_members` y mete el id del único tenant del user.

- **Pros:**
  - **Performance:** RLS compara un UUID en memoria contra otro UUID. Costo ≈ 0. No hay subquery contra `consultora_members` por cada query del dominio.
  - **Simple en aplicación:** `auth.jwt() -> 'app_metadata' ->> 'consultora_id'` es directo. La función `current_consultora_id()` es la única abstracción.
  - **Compatible con Supabase Auth:** custom claims via Auth Hook es el patrón canónico Supabase recomienda explícitamente para multi-tenant.
  - **Default-deny:** policies enable RLS + solo SELECT explícito + service-role bypass para mutations. No hay forma de leak por bug de aplicación.
- **Contras:**
  - **JWT cache lag:** si un user cambia de consultora (no soportado en MVP), el JWT viejo sigue válido hasta expirar (default 1h). Mitigación: cuando suceda, forzar logout o usar `auth.refreshSession()` para regenerar el JWT.
  - **Dependency en Auth Hook:** si el hook falla, los users entran sin claim → `current_consultora_id() = NULL` → 0 rows en queries. Mitigación: el Auth Hook es código nuestro, testeable. T-016 cubre.
  - **Single-tenant per user en el claim:** soporta MVP cleanly. Si Fase N requiere multi-tenant per user (1 user en N consultoras), evolucionar a un array de UUIDs en `app_metadata.consultora_ids` o a una función que lea de `consultora_members` para esos casos.
  - **`current_consultora_id()` devuelve NULL entre T-011 y T-016:** las queries auth-required devuelven 0 rows (no error, no leak). Aceptable: las mutations en T-012-T-015 usan service-role; el primer cliente authenticated llega en T-017. Para entonces T-016 ya inyectó el claim.

### Opción D · Schemas separados + GraphQL gateway (Hasura-style)

Combinar A con un gateway. Considerado y descartado: agrega capa adicional con su propio runtime, fricción con Server Actions de Next.js (que esperan hablar directo a Postgres vía Supabase JS SDK), y mucho overhead para una app que aún no probó tracción.

## Decisión

**Opción C — Shared DB + RLS por custom claim en JWT.**

Arquitectura concreta:

1. **Todas las tablas del dominio** llevan FK `consultora_id NOT NULL`. Sin excepción.
2. **RLS habilitado en todas las tablas** (default-deny). Sin policies = sin acceso.
3. **`current_consultora_id()`** (SQL function, `stable security definer set search_path = ''`) extrae `app_metadata.consultora_id` del JWT.
4. **Policies de SELECT** comparan `consultora_id = current_consultora_id()`.
5. **Policies de UPDATE/DELETE** que aplican a roles `authenticated` se restringen también por role check (ej: solo `owner` puede UPDATE consultoras).
6. **INSERT/UPDATE/DELETE para clientes authenticated/anon: denegado por default** (sin policy). Server Actions usan **service-role client** para mutations validadas (con `consultora_id` derivado del session-context).
7. **Custom claim inyectado por Auth Hook (T-016):** un Edge Function corre en cada token issue y mete `consultora_id` derivado de `consultora_members`.
8. **Policy defensiva `consultora_members_select_self`** (USING `user_id = auth.uid()`): permite a un user leer su propia membership incluso sin el custom claim seteado. Necesario para el flow signup → load membership → set claim, entre T-012 y T-016.
9. **`audit_log` inmutable:** triggers BEFORE UPDATE/DELETE que tiran exception. INSERT-only enforced en DB (también bloquea service-role para tampering).

## Consecuencias

### Positivas

- **Performance OK al inicio.** RLS de comparación directa contra un UUID en memoria. Plantillas de queries cacheadas por el planner. Para 1K-10K consultoras no hay penalty.
- **Aislamiento fuerte por default.** Imposible cross-tenant query desde clientes authenticated por bug de aplicación. service-role solo desde server, nunca expuesto al cliente (T-006 + step CI bundle check).
- **Auditoria via `audit_log` inmutable.** Trigger DB rechaza tampering. Cumple resguardo legal (P3) para vector "informes técnicos firmados por matriculado".
- **DX simple:** los Server Actions hablan a Supabase con JWT del usuario; RLS hace el resto.
- **Compatible con Supabase Realtime, Storage, Edge Functions** sin cambios.

### Negativas

- **JWT cache lag de hasta 1h** si cambia membership. No relevante para MVP single-tenant per user.
- **`current_consultora_id() = NULL` pre-T-016:** comportamiento explícito (devuelve 0 rows, no error). Documentado en la migración + ADR.
- **Auth Hook (T-016) es código crítico:** un bug ahí rompe acceso de TODOS los users. Mitigación: tests unitarios + integration tests sobre el hook + monitoreo de signins fallidos en Sentry.
- **Tests RLS requieren credenciales reales (anon + service-role):** corren contra Supabase remoto, local-only por ahora (decisión T-011 #8). Cuando entre contributor #2 evaluar setup CI con secrets.

### Inciertas

- **Escalabilidad >10K consultoras:** RLS de UUID es O(1) por row pero el planner puede deteriorarse con tablas muy grandes + índices saturados. Trigger para revisitar (ver abajo).
- **Multi-tenant per user (1 user en N consultoras):** soportado por el schema (m2m `consultora_members`) pero NO por el claim actual (single UUID). Si llegamos a needs reales, evolucionar a `consultora_ids[]` o a un selector explícito por request.

## Triggers para revisitar

Reabrir como ADR-NNNN nuevo cuando:

- **>5K consultoras activas** o queries con RLS pasan de p95 > 200ms — evaluar denormalización, prepared statements, o materialized views por tenant.
- **Plan Team avanzado (Fase 2)** requiere multi-user con roles más granulares que `owner`/`member` (ej: `viewer`, `auditor`) — extender `consultora_members.role` enum.
- **Multi-tenant per user** se vuelve requirement real — migrar el claim a array de UUIDs + helper SQL que evalue `consultora_id = ANY(current_consultora_ids())`.
- **Multi-establecimiento (Fase 4 Enterprise):** sumar `establecimiento_id` como segundo eje de aislamiento dentro de la consultora — extender el claim con un sub-scope.
- **Auditoría regulatoria** requiere `audit_log` cryptographically chained (hash de row anterior) — refactor del schema.

## Referencias

- [`supabase/migrations/20260511000615_tenancy.sql`](../../supabase/migrations/20260511000615_tenancy.sql) — schema final.
- [`src/tests/integration/rls.test.ts`](../../src/tests/integration/rls.test.ts) — tests cross-tenant que validan el aislamiento.
- [`docs/technical/03-data-model.md`](../technical/03-data-model.md) — schema completo.
- [`docs/technical/01-principles.md`](../technical/01-principles.md) P2 — seguridad por defecto.
- Supabase Auth Hooks (custom access token): <https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook>
- Supabase RLS guide: <https://supabase.com/docs/guides/auth/row-level-security>
- [ADR-0002](./0002-stack-eleccion.md) — stack que fija Postgres + Supabase + RLS.
- [ADR-0004](./0004-diferir-branch-protection-server-side.md) — relacionado con disciplina manual mientras no hay branch protection.
