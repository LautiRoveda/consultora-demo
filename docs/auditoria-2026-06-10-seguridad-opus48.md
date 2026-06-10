# Auditoría de seguridad — ConsultoraDemo (Opus 4.8)

**Fecha:** 2026-06-10 · **Auditor:** orquestador (Opus 4.8), read-only · **Alcance:** aislamiento
multi-tenant (RLS / RPCs `security definer`), auth y autorización en server actions y route handlers,
secrets / inyección / cliente.

## Veredicto

Postura de seguridad **fuerte**. Cero hallazgos críticos o altos. RLS habilitado en las 37 tablas de
dominio, 65 funciones `security definer` todas con `set search_path = ''`, grants sin `anon` / `public`,
cada RPC revalida tenancy, cada action y route autentica con `getUser()` (ninguna usa `getSession()`
para autorizar), y el patrón service-role → mutación siempre va precedido de un SELECT bajo RLS que
valida ownership. Webhook Mercado Pago con HMAC + anti-replay, secrets server-only, markdown sanitizado,
sin SSRF en el fetch interno de PDF.

Resultado: **1 medio** (estructural latente) + **4 bajos** + **1 informativo**. Todos los hallazgos
accionables quedaron cerrados; solo el informativo (I-1) queda como aceptado/diferido.

## Hallazgos

| ID  | Sev   | Área                                                                              | Estado       | Fix                          |
| --- | ----- | --------------------------------------------------------------------------------- | ------------ | ---------------------------- |
| M-1 | Medio | `createCalendarEventSchema` acepta tipos system + `metadata` libre (INSERT y PATCH) | ✅ Cerrado    | T-133 · PR #240 · `fd9588e`  |
| L-1 | Bajo  | `semaforo_clientes` no re-scopea el lado derivado de los joins al tenant            | ✅ Cerrado    | T-133 · PR #240 · `fd9588e`  |
| L-4 | Bajo  | PostgREST `.or()` filter-injection en búsqueda de empleados                         | ✅ Cerrado    | T-134 · PR #242 · `54c56e4`  |
| L-2 | Bajo  | Drift Zod↔SQL en DNI (regex 7-12 díg. vs CHECK `^\d{7,8}$`)                          | ✅ Cerrado    | T-135 · PR #243 · `8723791`  |
| L-3 | Bajo  | Rate-limit cae a noop silencioso si faltan envs Upstash en prod                     | ✅ Cerrado    | T-135 · PR #243 · `8723791`  |
| I-1 | Info  | CSP `script-src 'unsafe-inline'` en prod                                            | ⏸️ Aceptado  | Tradeoff Next RSC; nonce diferido |

### M-1 · Calendar event: confianza en input de usuario (Medio)

La schema y la action dejaban a un usuario `authenticated` crear/editar a mano eventos de tipos
system-generated (`epp_entrega` / `accion_correctiva`) con `metadata` forjada, en su propia consultora —
raíz del vector del semáforo (mitigado previamente con un guard regex UUID en la RPC). Dos superficies:
INSERT (form/action) y UPDATE directo vía PATCH PostgREST, esta última no expresable en RLS porque la
`WITH CHECK` de UPDATE no ve `OLD`.

**Fix (T-133):** schema restringida a `USER_CREATABLE_EVENT_TIPOS` + `.refine` que rechaza las claves del
namespace system en `metadata`; policy INSERT que bloquea los tipos system para `authenticated`; trigger
BEFORE UPDATE que congela `tipo` (global) y `metadata` / `recurrence_months` en filas system, con
role-gate `auth.role() = 'authenticated'` y carve-out para `cancel_reason` (que vive dentro de `metadata`).
Una auditoría read-only de prod encontró 1 fila manual pre-fix (dato de prueba del owner), inerte tras L-1.

### L-1 · Semáforo: re-scope del lado derivado (Bajo, defense-in-depth)

`semaforo_clientes` scopeaba solo `ce.consultora_id`; el cliente/empleado DERIVADO (join a informes /
empleados, `cliente_id` de `metadata`) no se revalidaba contra el tenant. No explotable en la práctica
(UUIDs inadivinables + el merge server-side del dashboard descarta el ajeno).

**Fix (T-133):** las 3 ramas del UNION validan el id derivado con `my_consultora_ids()`; el cast de
`metadata` va envuelto en `CASE WHEN <regex>` para ser plan-independiente (no depender del push-down del
predicado).

### L-4 · `.or()` filter-injection en búsqueda de empleados (Bajo)

`searchEmpleadosByNombre` escapaba solo wildcards LIKE y luego interpolaba el término en el string crudo
de `.or()`, donde `,` `(` `)` `"` son sintaxis estructural de PostgREST (separan/agrupan condiciones).
RLS contenía el blast radius (intra-tenant, sin cross-tenant).

**Fix (T-134):** `sanitizeNombreSearchTerm` con allowlist name-safe que elimina los estructurales de raíz
(y de paso `*`, alias de `%` en `ilike`), preservando acentos / apóstrofo / guion. Un barrido confirmó que
era el único `.or()` con interpolación de input de usuario del repo.

### L-2 · Drift Zod↔SQL en DNI (Bajo)

El regex Zod (`/^\d[\d.\s-]{6,11}$/`) aceptaba 9-12 dígitos puros que el CHECK SQL `^\d{7,8}$` rechaza →
el form pasaba y el INSERT reventaba con error genérico (mala UX; no es vuln, la DB falla cerrado).

**Fix (T-135):** `.refine` que valida 7-8 dígitos post-normalización en `dniField` (no `.transform`, que
rompe la inferencia de React Hook Form).

### L-3 · Rate-limit no-op silencioso sin Upstash en prod (Bajo)

`UPSTASH_REDIS_REST_URL` / `_TOKEN` son `.optional()`; sin ellas en prod, `getRateLimiter` cae al noop
(siempre allow) y todos los límites (signup, login, IA, webhooks) se desactivan sin señal → exposición a
abuso/costo.

**Fix (T-135):** guard de boot (`shouldWarnMissingRateLimit`) que emite un warn explícito cuando
`NODE_ENV = production` y falta alguna de las dos. WARN y no throw, por consistencia con los guards
existentes de `env.ts` y por seguridad de disponibilidad.

### I-1 · CSP `script-src 'unsafe-inline'` (Informativo, aceptado)

Debilita la defensa XSS, pero es el tradeoff conocido de Next RSC / hydration y está mitigado por
react-markdown + rehype-sanitize y cero `dangerouslySetInnerHTML`. Migración a CSP nonce-based diferida.

## Verificado OK (sin hallazgo)

Webhook MP (HMAC SHA256 + timing-safe + ventana anti-replay 5 min) · cron / dispatch-reminder / telegram
(secret constant-time + Zod + rate-limit) · service-role server-only + step de CI que verifica que no
entra al bundle del cliente · JWT solo lleva `consultora_id` / `consultora_role` (sin datos sensibles) ·
65 funciones `security definer` con `set search_path = ''` · grants sin `anon` / `public` · 108 policies,
cero `USING(true)` / `WITH CHECK(true)` · RPCs (`link_informe_to_incidente`, `clone_*`, `reorder_*`)
revalidan `is_member_of_consultora` / `is_owner_of_consultora` + cross-tenant · billing valida el
`suscripcionId` por SELECT-RLS antes de cualquier mutación service-role · signed URLs generadas con el
user-client (gate RLS en storage) + TTL · upload con magic-bytes + size + sanitización de filename ·
open-redirect del callback con allowlist · `resolveInternalBaseUrl` usa loopback en prod (sin SSRF vía
Host header) · headers globales (CSP / HSTS / X-Content-Type-Options / Referrer-Policy / Permissions-Policy
/ X-Frame-Options) · vista print bajo RLS + token interno rotado por boot del proceso.

## Follow-up sin ticket (candidato, a criterio del owner)

**FK compuesto `calendar_events(informe_id, consultora_id)` → `informes(id, consultora_id)`:** cerraría
la rama 1 de L-1 en la raíz — hoy un `informe_id` cross-tenant forjado se puede insertar y L-1 lo
neutraliza recién en la lectura. Hardening estructural, severidad baja, no urgente.

## Referencias

- Hallazgos previos ya cerrados antes de esta auditoría: guard regex UUID del cast de `metadata` en
  `semaforo_clientes` (T-131), reforzado por L-1.
- Tickets de remediación: T-133 (PR #240), T-134 (PR #242), T-135 (PR #243).
- ADR relacionado: `docs/adr/0006-multi-tenant-rls-strategy.md` (estrategia RLS + custom claim JWT).
