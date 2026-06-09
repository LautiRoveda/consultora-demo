# Handoff al orquestador — cómo se ejecutan los tickets

Working agreement + estado vivo para el **chat nuevo del orquestador**. Entre **Lautaro** (owner/founder solo, sin reviewer externo) y el agente IA que orquesta el trabajo: el rigor del proceso reemplaza al code review humano, es la red de seguridad.

> **Fuentes de verdad** (no duplicar acá lo que ya viven ahí): `CLAUDE.md` (producto + stack + principios), `docs/sprints/operativo.md` (tickets transversales + estado granular), `docs/technical/10-roadmap.md` (roadmap), `docs/lessons-learned.md`. Este doc es el **mapa de entrada**, no el territorio.

## Estado de `main`

> **El SHA no se hardcodea acá** (se desactualiza en cada merge → drift). Fuente viva: `git log -1 --oneline` para el HEAD y `git log --oneline -10` para los últimos merges (el orquestador los corre read-only desde su sandbox). El detalle del ruleset + required checks está en §Metodología de merge / branches.

- **Suite:** unit + component vía `pnpm test`; integration + e2e con Supabase local efímero.

## En vuelo

- **PRs / branches abiertas:** no se snapshotea acá — verificar en el momento con `gh pr list` + `git branch -a`. Dependabot abre PRs periódicas (deps) que quedan para triage; no son deuda.
- **Backlog técnico/DEVEX: el DEVEX está esencialmente cerrado, pero hay activos de producto/bug.** Cerrados en esta etapa: T-109, T-111 (F1+F2+F2b), **T-112** (E2E ya corren aislados contra Supabase local — el job `E2E (Supabase local)` es required check; se removió el `if: false`), F1.2/F1.3, T-113a/T-113b/T-113d, Dependabot, T-082-FU + FU5, **auditoría de integridad ADR-0015** (T-122/120/123/124/121, 2026-06-05). Activos nuevos en operativo.md: T-115 (hardening billing), T-076 (doc drift src/modules), T-117-FU2 (dormido), T-121-FU (dormido: coherencia Ring B/C), flaky E2E (`checklists-ejecuciones.spec.ts:100`), doc-drift data-model (`03-data-model.md` stale), T-113c (dormido). Las 2 follow-ups de checklists (guard redirect tombstone→original; anularEjecucionAction valide estado='cerrada') siguen documentadas en la sección "Checklists · follow-ups abiertos" de operativo.md.
- **Próximo:** El **asistente IA de EPP (T-117)** ya cerró (streaming SSE + render markdown en `asistente-client.tsx` + persistencia del chat: T-117-FU3/T-125/T-126 en prod) y el **responsive T-127** quedó en prod (tandas 1-6 + follow-ups: primitivos · tablas→cards · nav móvil · forms · calendario · chat · wizard). La deuda estructural de integridad (ADR-0015: T-122/120/123/124/121) sigue cerrada operativamente. **PRÓXIMO**: T-127 **Tanda 7** (pulido: tipografía/densidad + guard anti-drift del dashboard `QUICK_LINKS`↔`NAV_ITEMS`) · **panel de vencimientos del dashboard** (rediseño, feedback del owner — ver abajo) · **GPS** (ver abajo). Después: RGRL completo (contenido del matriculado) / siguiente módulo / los FU dormidos (T-117-FU2, T-126 producto, T-121-FU, flaky E2E, doc-drift data-model). _Sesión 2026-06-08: doc-sync del responsive T-127 (6 PRs en prod); el hilo del asistente IA quedó cerrado; el hilo de producto "campo Puesto" quedó resuelto — T-128 (selector del catálogo) + T-129 fase A (consumers + backfill) en prod, queda T-129 fase B (ver Pendiente abierto 3)._
- **Pendiente abierto (1) · GPS:** "Usar mi ubicación" en el cierre de inspección (CerrarInspeccionForm) falla con mensaje de permisos. Diagnóstico provisorio: navigator.geolocation exige HTTPS (secure context) — en dev local http://IP el browser lo bloquea y lo reporta como "permiso denegado" sin prompt; en prod (https) debería andar con permiso de sitio+SO. Falta que el owner confirme la URL del celular. GPS es opcional → NO bloquea el cierre.
- **Pendiente abierto (2) · panel de vencimientos del dashboard:** rediseño UX del dashboard + panel de vencimientos (`ProximosVencimientosPanel`) pedido por el owner; pendiente de definición (feedback de producto), arranca con un mockup. Detalle en `operativo.md`.
- **Pendiente abierto (3) · T-129 fase B** (segundo PR del mismo ticket, **NO T-130** — reservado): el hilo de producto "campo Puesto" del backlog quedó resuelto con T-128 (selector del catálogo) + T-129 fase A (consumers cortados al catálogo + backfill `empleados_puestos`), **ambos en prod**. Falta la fase B: drop de `empleados.puesto` + drop de la función `backfill_empleados_puestos_from_legacy` + quitar el puente de `empleados/actions.ts` + `db:types` completo (ahí despierta el skew PostgREST) + actualizar los tests que hoy asertan el puente (`empleados-rls.test.ts:605`, `empleados-actions.test.ts` test 8, e2e crud). **Reconfirmar el conteo de empleados con `puesto` texto en prod antes del drop** (en fase A: 2 con texto, ambos ya asignados → 0 a migrar). Detalle en `operativo.md`.

## Infra local

El repo vive en `C:\proyecto\consultora-demo`: repo git **normal**, sin junctions, **fuera de OneDrive**.

- **Por qué este setup:** OneDrive corrompía el `.git` (incluso vía junction — `lint-staged` hace `git stash` en cada commit y OneDrive clobbeaba el junction a mitad de operación). Se resolvió de raíz sacando el repo de OneDrive. El setup viejo (junction con el repo real en `C:\Git\consultora-demo` y espejo en `OneDrive\Documentos`) está **deprecado**: ya no hay junctions ni carpeta en OneDrive.
- **El orquestador corre `git` read-only desde su sandbox para diagnóstico general** (`git log`, `git diff` del working tree); ya no hay junction que lo bloquee. **PERO el mount Windows→sandbox da vistas inconsistentes de los internals de `.git`** (HEAD, refs, locks) — puede reportar un `.git/HEAD` truncado o un lock fantasma que en Windows está sano. Ante cualquier señal de "corrupción" / HEAD irresoluble desde el sandbox, **confirmar con CC en terminal nativa ANTES de alarmar o tocar nada** (`type .git\HEAD`, `git fsck`). `gh` no está en el sandbox → PRs / CI / merge los corre Lautaro o el CC de Antigravity.
- **No versionados que viven solo local** (copiados en la migración, gitignoreados): `.env.local`, `backups/`, `.claude`, `.agents`, `.obsidian`, `skills-lock.json`.

## Metodología de trabajo (los tres actores)

El trabajo fluye entre tres actores; el **owner es el canal** entre los dos agentes (no se hablan directo).

- **Lautaro (owner):** decide producto y prioridad, da el **OK de commit**, valida en prod (smoke). Es el **puente**: copia/pega los mensajes entre el orquestador (este chat) y CC (Antigravity).
- **Orquestador (este chat):** tech lead. Arma los briefings para CC, revisa lo que CC produce **contra el código real** (diagnóstico-primero, con `git` read-only + subagentes), recomienda en las decisiones del owner, y da el **OK de merge**. NO escribe código.
- **CC (Claude Code en Antigravity):** ejecuta. Escribe código/migraciones/tests, corre `git`/`gh`/`supabase`, trabaja plan-first y para en cada gate.

### El ciclo de un ticket (punta a punta)
1. **Owner** pide el trabajo / da la prioridad.
2. **Orquestador** diagnostica el estado real → arma un **briefing self-contained** para CC (bloque markdown).
3. **Owner** lo pega a CC.
4. **CC** responde en plan mode: RFC/plan + diffs **sin codear** → para.
5. **Owner** pega el output al orquestador.
6. **Orquestador** revisa **verificando las afirmaciones contra el código** (lee archivos, lanza subagentes); aprueba / pide cambios / recomienda en los forks del owner.
7. **CC** implementa → diffs + `typecheck`/`lint`/`test` en verde → para **antes de commitear**.
8. **Orquestador** revisa los diffs (lee los archivos de riesgo) → OK de review.
9. **Owner** da el **OK de commit** → **CC** commitea + push + PR + monitorea los 3 required.
10. **CC** reporta CI verde → **Orquestador** da el **OK de merge** → **CC** mergea (squash) + post-merge.
11. **Deploy**: el merge **auto-deploya solo el código** (webhook EasyPanel; NO es job de GitHub Actions → no se ve por gh, tarda unos min en rebuildear la imagen ~600MB+Chromium). Las **migraciones NO**. **Orden cuando el código depende de la migración** (vista/tabla/RPC): el db push diff-validado va **ANTES del merge** — el auto-deploy publica el código apenas mergeás, y si la vista no existe rompe (caso FU1: la vista heads se aplicó antes de #202; caso T-059: nav-item live sin tablas). Si el código aún no la usa, basta la misma ventana. **Gates del db push**: diff validado por el orquestador (migration list --linked + db push --dry-run) + OK explícito del owner (es prod). Luego **smoke del owner** en prod → recién ahí *done*.

### Reglas del canal
- **Un chat nuevo de CC por ticket** (contexto limpio, relee el código). El **orquestador mantiene el hilo** entre tickets.
- **Decisiones del owner:** CC levanta el fork (selector de opciones) → el owner lo pasa al orquestador → el orquestador **recomienda con fundamento** → el owner confirma → vuelve a CC.
- **Dos OK distintos, ninguno se saltea:** el **commit** lo habilita el owner; el **merge** lo habilita el orquestador (con CI verde).
- **El orquestador no escribe en el repo** — solo lee para diagnosticar. Todo cambio lo hace CC por branch + PR.

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
- **Modularidad:** módulos co-localizados en `src/app/(app)/<modulo>/` (`actions.ts` + `queries.ts` + `schema.ts` + componentes). Auth en cada Server Action, Zod en cada borde, RLS en cada tabla.
- **Type safety:** TS strict (incl. `noUncheckedIndexedAccess` → indexar arrays/records da `T | undefined`, manejar con `?? ''` o `!`). Tipos generados del schema (`pnpm db:types`).
- **Tests:** pirámide 70/20/10, >70% cobertura. Suites: `unit` + `component` (sin DB, `pnpm test`), `integration` + `e2e` (Supabase local efímero, `--no-file-parallelism` en integration por pollution de RPCs globales). Los **test-meta** (guards estructurales que leen el repo) viven en `src/tests/unit/` y corren en CI sin job nuevo. Los projects `unit` (.test.ts/node) y `component` (.test.tsx/jsdom + `src/tests/setup.ts`) corren en pools/environments separados → un test de un project NO contamina al otro (no diagnostiques un flaky como cross-project). El `waitFor`/`findBy` default (1000ms) flapea bajo contención del CI (94 archivos en paralelo) → `configure({ asyncUtilTimeout: 5000 })` global en setup.ts (T-116).
- **Anti-drift (lección viva):** doc y código se desincronizan en silencio. Cuando una afirmación del doc es verificable contra el repo, preferí un guard automatizado (test-meta) antes que confiar en la disciplina manual. `verify:dr-config` (FU5) es el caso canónico.

## Por qué

Lautaro es founder solo, sin reviewer externo. Un "está hecho" sin evidencia, o un merge prematuro, le rompe la confianza. El proceso —diagnóstico → gates → pruebas red/green → CI verde → OK explícito— es su control de calidad. Este doc existe para que un chat nuevo del orquestador arranque ya conociendo las reglas, el estado y las trampas.
