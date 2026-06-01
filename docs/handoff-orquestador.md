# Handoff al orquestador — cómo se ejecutan los tickets

Working agreement entre **Lautaro** (owner/founder solo, sin reviewer externo) y el agente IA que orquesta el trabajo. El rigor del proceso reemplaza al code review humano: es la red de seguridad.

## El flujo gated (no negociable)

1. **Diagnóstico-primero.** Para re-validación/auditoría: investigar read-only y devolver el diagnóstico (con `file:line`) para revisión **ANTES de tocar el artefacto principal**. Plan mode encaja.
2. **Decisiones del owner, no asumidas.** Ante un fork con costo/tradeoff real (pagar vs gratis, in-scope vs follow-up, documentar vs allowlistear), **preguntar** — no decidir solo.
3. **Branch nueva por ticket.** Nunca trabajar sobre `main` (está protegida). `git checkout -b <tipo>/<ticket>-<slug>` desde `main` actualizado.
4. **Commits separados para diff limpio.** Doc / código / tracking en commits distintos dentro del PR. Convención commit-msg (hook husky): `T-XXX · descripción` (sin sufijo `-FU` en el prefijo, aunque el ticket sea T-082-FU) o `docs|fix|chore|refactor|test|style|build|ci|perf|revert: descripción`.
5. **Probar que los guards sirven.** Si se agrega un test/guard, demo **red→green** (sacar lo protegido → rojo → restaurar → verde), no solo "el test pasa".
6. **Verificación antes de afirmar.** `typecheck` + `lint` + tests en verde, **con la salida a la vista**, antes de decir "hecho". Nada de "está hecho" sin evidencia.
7. **CI verde en los required.** Push → abrir PR → monitorear los 3 checks required: `CI`, `E2E (Supabase local)`, `Integration (Supabase local)`.
8. **Nunca mergear sin OK del owner + CI verde.** Abrir el PR, reportar el estado, y **PARAR**. El merge lo decide Lautaro.
9. **Merge = squash.** Subject explícito `T-XXX · <descripción> (#PR)`. Post-merge: pasar el **SHA** + **borrar la branch**.

## Branch protection (`main`)

Ruleset enforced (verificado vía `gh api repos/.../rules/branches/main`):

- **Required status checks** (strict): `CI` + `E2E (Supabase local)` + `Integration (Supabase local)`.
- **Pull request obligatorio** (0 approvals required, pero los checks deben pasar).
- **Bloqueo de deletion + non-fast-forward.**

Por eso **todo** cambio —incluido "solo doc"— va por branch + PR; no hay push directo a `main`.

## Por qué

Lautaro es founder solo, sin reviewer externo. Un "está hecho" sin evidencia, o un merge prematuro, le rompe la confianza. El proceso —diagnóstico → gates → pruebas red/green → CI verde → OK explícito— es su control de calidad.
