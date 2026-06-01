# Handoff al orquestador — cómo se ejecutan los tickets

Working agreement + estado vivo para el **chat nuevo del orquestador**. Entre **Lautaro** (owner/founder solo, sin reviewer externo) y el agente IA que orquesta el trabajo: el rigor del proceso reemplaza al code review humano, es la red de seguridad.

> **Fuentes de verdad** (no duplicar acá lo que ya viven ahí): `CLAUDE.md` (producto + stack + principios), `docs/sprints/operativo.md` (tickets transversales + estado granular), `docs/technical/10-roadmap.md` (roadmap), `docs/lessons-learned.md`. Este doc es el **mapa de entrada**, no el territorio.

## Estado de `main` (snapshot — al cierre de T-082-FU5)

- **HEAD:** `6ed89e4` — `T-082-FU5 · verify:dr-config doc-as-code anti-drift del runbook DR (#178)`. CI de main en verde.
- **Últimos merges:**
  - **T-082-FU5** ✅ `6ed89e4` (#178) — guard anti-drift del runbook DR (`verify:dr-config`).
  - **T-113** doc ✅ `6a5fa12` (#177) — marcar T-113b DONE en operativo.md.
  - **T-113b** ✅ `68523dc` (#176) — limpiar DELETE-muerto en tests append-only + guard test-meta.
  - **T-082-FU** ✅ `91fe8d2` (#175) — re-validar y corregir el runbook DR (Free sin backup auto + epp-firmas + secrets).
- **Suite:** unit + component vía `pnpm test` (689 tests al cierre de FU5); integration + e2e con Supabase local efímero.

## En vuelo

- **PR #179** — `docs/handoff-orquestador.md` (este doc). Abierto, gated, **esperando OK de merge**. Es el único PR abierto.
- **FU5 NO está en vuelo: está mergeado** (`6ed89e4`, #178). No re-abrir.
- **Backlog técnico/DEVEX: esencialmente vacío.** Cerrados en esta etapa: T-109, T-111 (F1+F2+F2b), **T-112** (E2E ya corren aislados contra Supabase local — el job `E2E (Supabase local)` es required check; se removió el `if: false`), F1.2/F1.3, T-113a/T-113b/T-113d, Dependabot, T-082-FU + FU5.
- **Próximo recomendado:** volver al **roadmap de producto** — confirmar la prioridad comercial con el owner antes de arrancar. El único trabajo en cola son los **DORMIDOS** (tabla abajo) + follow-ups opcionales; no hay deuda técnica abierta que bloquee.

## El flujo gated (no negociable)

1. **Diagnóstico-primero.** Para re-validación/auditoría: investigar read-only y devolver el diagnóstico (con `file:line`) para revisión **ANTES de tocar el artefacto principal**. Plan mode encaja. *Ejemplos de la sesión:* T-082-FU (re-validación del runbook → 5 hallazgos antes de editar) y T-082-FU5 (Explore agents read-only → plan aprobado → recién entonces código).
2. **Decisiones del owner, no asumidas.** Ante un fork con costo/tradeoff real (pagar Pro vs script gratis, in-scope vs follow-up, documentar en §4 vs allowlistear una env var), **preguntar** — no decidir solo. *Ejemplo:* en FU5 el owner eligió documentar `NEXT_PUBLIC_SITE_URL` en §4 en vez de allowlistearla.
3. **Branch nueva por ticket.** Nunca trabajar sobre `main` (está protegida). `git checkout -b <tipo>/<ticket>-<slug>` desde `main` actualizado.
4. **Commits separados para diff limpio.** Doc / código / tracking en commits distintos. *Ejemplo FU5:* (1) guard + sync §4, (2) docstring backup-storage, (3) operativo.md.
5. **Probar que los guards sirven.** Si se agrega un test/guard, demo **red→green** (sacar lo protegido → rojo → restaurar → verde), no solo "el test pasa". El guard sin demo red→green no cuenta.
6. **Verificación antes de afirmar.** `pnpm typecheck` + `pnpm lint` + tests en verde, **con la salida a la vista**, antes de decir "hecho". Nada de "está hecho" sin evidencia.
7. **CI verde en los required.** Push → abrir PR → monitorear los 3 checks required: `CI`, `E2E (Supabase local)`, `Integration (Supabase local)`.
8. **Nunca mergear sin OK del owner + CI verde.** Abrir el PR, reportar el estado, y **PARAR**. El merge lo decide Lautaro.
9. **Red automática > disciplina humana.** Cuando algo se cuela en silencio (flaky, patrón muerto, drift doc↔código), no alcanza con arreglar la instancia: agregar un **guard que lo bloquee en CI** para que la CLASE de problema no vuelva (mini-test de buckets T-082, guard DELETE-muerto T-113b, `verify:dr-config` T-082-FU5).

## Metodología de merge / branches

- **Merge = squash.** Subject explícito `T-XXX · <descripción> (#PR)` (el ticket en el subject va sin sufijo `-FU`: el hook husky exige `T-[0-9]{3,4} · …` — `T-082-FU5` lo rechaza, usar `T-082 · FU5 …`). En el subject del *squash* (lo arma GitHub, no el hook local) sí podés escribir `T-082-FU5 · …`.
- **Post-merge:** pasar el **SHA** al owner + **borrar la branch** (`gh pr merge --squash --delete-branch`) + `git fetch --prune` local para limpiar la referencia remota podada.
- **Nunca** force-push ni `--no-verify` salvo pedido explícito del owner.
- **Branch protection de `main` es un Ruleset** (no classic branch protection). Implicancia operativa: `gh api repos/<owner>/<repo>/branches/main/protection` devuelve **`404 Branch not protected` — esto es ESPERADO, NO significa que main esté desprotegida**. Para ver las reglas reales: `gh api repos/<owner>/<repo>/rules/branches/main`. El ruleset enforced incluye: required status checks strict (`CI` + `E2E (Supabase local)` + `Integration (Supabase local)`), PR obligatorio (0 approvals pero checks deben pasar), bloqueo de deletion + non-fast-forward. Por eso **todo** cambio —incluido "solo doc"— va por branch + PR.

## Backlog DORMIDO (con disparadores)

No son trabajo pendiente — se activan cuando se cumple la condición. Detalle en `docs/operations/disaster-recovery.md` §Follow-ups + `docs/sprints/operativo.md`.

| Ticket | Qué | Disparador |
|---|---|---|
| **T-082-FU1** | Automatizar backup Storage (GitHub Action cron) | Módulo operativo + olvido de correr el backup 2 meses seguidos |
| **T-082-FU2** | Backup remoto (Backblaze B2 / S3-compat) | 1er cliente pagando + volumen Storage > 1GB |
| **T-082-FU3** | Proyecto Supabase staging para test de restore real | Upgrade a Supabase Pro |
| **T-082-FU4** | Script de export selectivo (tabla por tabla) | 1er incidente donde el restore in-place sea overkill |
| **T-113c** | Bug TZ latente de `retencion_datos_hasta` (el campo nunca se escribe en prod) | Cableo del seteo del campo (guardarlo date-only o mediodía UTC) |

## Convenciones del repo (lo que muerde si no lo sabés)

- **Idioma:** español (Argentina) en todo — comentarios de código, mensajes de commit, docs, mensajes de error de tests/Zod. Identificadores en inglés técnico donde es idiomático.
- **Tablas append-only** (`audit_log` T-011, `notification_log` T-031, `billing_notifications_log` AUD-001): tienen trigger `BEFORE DELETE … RAISE EXCEPTION` → un `.from('<tabla>').delete()` lanza excepción que supabase-js devuelve en `{ error }` sin throw = **no-op silencioso**. NO usar ese patrón en tests (lo bloquea el guard `append-only-delete-guard.test.ts`, T-113b). Para restore selectivo: bloque `DO` + `ALTER TABLE … DISABLE TRIGGER USER` dentro de transacción — `session_replication_role='replica'` **NO sirve** en Supabase (`postgres` no es superuser → 42501). Ver disaster-recovery.md §5.1.
- **RLS / multi-tenancy:** toda policy NUEVA de tablas del dominio usa los helpers SQL (`is_member_of_consultora`, `is_owner_of_consultora`, `role_on_consultora`, `my_consultora_ids`), NO subqueries inline a `consultora_members`. Custom claim JWT (`consultora_id` + `consultora_role`) con fast-path. Ver CLAUDE.md §RLS.
- **Modularidad:** 14 módulos en `src/modules/<nombre>/` vía API pública (`index.ts`). Auth en cada Server Action, Zod en cada borde, RLS en cada tabla.
- **Type safety:** TS strict (incl. `noUncheckedIndexedAccess` → indexar arrays/records da `T | undefined`, manejar con `?? ''` o `!`). Tipos generados del schema (`pnpm db:types`).
- **Tests:** pirámide 70/20/10, >70% cobertura. Suites: `unit` + `component` (sin DB, `pnpm test`), `integration` + `e2e` (Supabase local efímero, `--no-file-parallelism` en integration por pollution de RPCs globales). Los **test-meta** (guards estructurales que leen el repo) viven en `src/tests/unit/` y corren en CI sin job nuevo.
- **Anti-drift (lección viva):** doc y código se desincronizan en silencio. Cuando una afirmación del doc es verificable contra el repo, preferí un guard automatizado (test-meta) antes que confiar en la disciplina manual. `verify:dr-config` (FU5) es el caso canónico.

## Por qué

Lautaro es founder solo, sin reviewer externo. Un "está hecho" sin evidencia, o un merge prematuro, le rompe la confianza. El proceso —diagnóstico → gates → pruebas red/green → CI verde → OK explícito— es su control de calidad. Este doc existe para que un chat nuevo del orquestador arranque ya conociendo las reglas, el estado y las trampas.
