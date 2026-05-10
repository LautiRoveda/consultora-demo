# Technical 05 · Branch protection de `main`

## Estado actual: diferida

La protección server-side de `main` está **diferida**. El blocker es de billing tier y no de implementación. Esta doc registra la realidad, las opciones evaluadas, la decisión, y los triggers para reactivar.

## Por qué está diferida

GitHub ofrece dos APIs para proteger una branch:

1. **Classic branch protection** — `PUT /repos/{owner}/{repo}/branches/{branch}/protection`.
2. **Rulesets** (más moderno, reemplazo de classic) — `POST /repos/{owner}/{repo}/rulesets`.

Al intentar aplicar T-004 (post-merge `70b75dc`), las dos APIs devolvieron **HTTP 403** con el mismo mensaje:

```
{
  "message": "Upgrade to GitHub Pro or make this repository public to enable this feature.",
  "status": "403"
}
```

Verificado empíricamente el **2026-05-09** sobre `LautiRoveda/consultora-demo`. Probado:

- Classic protection con el payload completo de T-004 → 403.
- Rulesets con el payload completo de T-004 → 403.
- Rulesets minimal (solo `deletion` + `non_fast_forward`, las menos restrictivas) → 403.

**Conclusión:** en cuenta GitHub free + repo privado **no hay forma server-side gratis** de proteger `main`, ni siquiera con la regla más mínima. Documentación oficial del límite: <https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches>.

| API | Repo privado free | Repo público free | Repo privado Pro |
|---|---|---|---|
| Classic branch protection | ❌ 403 | ✅ | ✅ |
| Rulesets | ❌ 403 | ✅ | ✅ |

## Opciones evaluadas (T-004 follow-up)

### Opción A · Hacer el repo público

**Pros:** habilita ambas APIs gratis. Sin costo.
**Contras:** expone todo `docs/discovery/` (análisis de mercado, pricing detallado, decisiones competitivas, personas), `docs/technical/`, ADRs. Esto es ventaja competitiva en etapa pre-MVP. Hacer público hoy es prematuro.

### Opción B · Upgrade a GitHub Pro (~USD 4/mes)

**Pros:** habilita classic + Rulesets en repos privados. También suma Codespaces extendido, Copilot Pro, code scanning para privados, etc.
**Contras:** USD 48/año recurrentes. Para 1 contributor, el ROI directo es bajo (los hooks locales + CI cubren ~95% del riesgo). El ROI sube cuando se sume el segundo dev.

### Opción C · Diferir + reforzar con convención auto-impuesta + hook local

**Pros:** sin costo, sin exposición. La convención de "todo cambio va por feature branch + PR + CI verde" se aplica solo (sos el único contributor). Reforzada técnicamente con un hook `pre-push` que bloquea pushes directos a `main`/`master`.
**Contras:** el hook local se puede saltar con `git push --no-verify`. Confianza basada en disciplina, no en enforcement server-side. Si en algún momento alguien con acceso al repo pushea con bypass, no hay rollback automático.

## Decisión: Opción C

**Diferir branch protection server-side.** Detalle completo en [ADR-0004](../adr/0004-diferir-branch-protection-server-side.md).

## Convención auto-impuesta · flow PR-based

Todo cambio en `main` desde T-005 en adelante sigue este flow:

```bash
# 1. Crear branch para el ticket
git checkout main && git pull
git checkout -b feature/T-005-supabase-tenancy

# 2. Trabajo + commits locales (formato T-XXX · ... validado por commit-msg hook)
# ... edits, tests, etc ...
git add <files>
git commit -m "T-005 · ..."

# 3. Push de la feature branch (pre-push corre typecheck local)
git push -u origin feature/T-005-supabase-tenancy

# 4. Crear PR
gh pr create --title "T-005 · ..." --fill

# 5. CI corre sobre el PR. Esperar verde.
gh pr checks --watch

# 6. Cuando CI verde: merge squash + delete branch remota
gh pr merge --squash --delete-branch

# 7. Volver a main local sincronizada
git checkout main
git pull
git branch -d feature/T-005-supabase-tenancy   # delete local
```

## Refuerzo técnico · hook `pre-push`

`.husky/pre-push` bloquea pushes directos a `main`/`master`:

```bash
current_branch=$(git rev-parse --abbrev-ref HEAD)

if [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
  echo "❌ Push directo a $current_branch bloqueado por convención auto-impuesta."
  # ... mensaje de ayuda con flow correcto ...
  exit 1
fi

pnpm typecheck
```

El hook NO sustituye protección server-side. Es un recordatorio activo + safety net contra distracción.

## Bypass para emergencias

Si hay un hot-fix urgente que justifica push directo (ej: bug que rompe prod, deploy roto en Vercel):

```bash
git push --no-verify
```

`--no-verify` saltea **todos** los hooks Husky (pre-commit + pre-push + commit-msg). Documentar el bypass en el mensaje del commit con prefijo `hotfix:` o `fix!:` y una línea explicando por qué se saltó CI:

```
hotfix: revertir merge T-042 por pánico en prod

Push directo a main con --no-verify porque el deploy de Vercel está
caído desde hace 30 min y el revert restaura prod inmediatamente.
CI se verifica en el siguiente PR de cleanup.
```

El historial git queda con un marcador claro del bypass para auditoría.

## Triggers para reactivar T-004.5

Reabrir branch protection server-side cuando ocurra **alguno** de:

- **Nuevo contributor.** Si se suma una persona al repo (interno o externo), la confianza basada en convención unipersonal deja de ser suficiente. Activar Pro o pasar a público + classic/Rulesets.
- **MRR > USD 100** (o equivalente que justifique USD 4/mes en tooling). Plan Pro deja de ser inversión "innecesaria".
- **Incidente real por push directo.** Si se rompe `main` por un bypass (intencional o accidental) que cuesta tiempo restaurar, el trigger se cumple inmediatamente.
- **Open-sourcing del proyecto.** Si la decisión D-XX cambia y abrimos el repo, branch protection clásica se habilita gratis.

Cuando se cumpla un trigger, abrir ticket `T-004.5 · Activar branch protection (Rulesets)` y reusar el script de la sección siguiente.

## Script para el día que se reactive

Listo para cuando se cumpla un trigger. **No ejecutar mientras el repo siga en free + privado** (devuelve 403). Pre-requisito: `gh CLI` autenticado con permiso admin sobre el repo.

```bash
gh api -X POST repos/LautiRoveda/consultora-demo/rulesets \
  --input - <<'EOF'
{
  "name": "main protection",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "required_status_checks",
      "parameters": {
        "required_status_checks": [
          { "context": "CI" }
        ],
        "strict_required_status_checks_policy": true
      }
    }
  ]
}
EOF
```

Verificación:

```bash
gh api repos/LautiRoveda/consultora-demo/rulesets | jq '.[] | {id, name, enforcement}'
```

Después de aplicado, el hook `pre-push` local pasa a ser **doble seguro** (server + client). Mantenerlo ambos lados — defense-in-depth.

### Vía UI (cuando se reactive)

1. `Settings → Rules → Rulesets → New ruleset` (no usar el flow viejo de "Branches → Add rule").
2. Ruleset name: `main protection`.
3. Enforcement status: **Active**.
4. Bypass list: vacío (sin admin bypass).
5. Target branches: **Include default branch** (`~DEFAULT_BRANCH`).
6. Rules:
   - ✅ Restrict deletions
   - ✅ Block force pushes
   - ✅ Require linear history
   - ✅ Require status checks to pass
     - ✅ Require branches to be up to date
     - Add status check: **CI** (job name del workflow `.github/workflows/ci.yml`)
7. Save.

## Relación con Vercel deploy

Vercel está integrado con GitHub via su app. Cada push a `main` triggea un deploy de producción automático. Cada PR triggea un deploy preview en `consultora-demo-git-<branch>-<scope>.vercel.app`.

Con la convención + hook actual, Vercel sigue deployando solo lo que llega a `main` vía PR mergeado con CI verde. La diferencia con protección server-side: **si alguien usa `--no-verify` para pushear directo, Vercel deploya sin CI verde**. Es el riesgo aceptado de Opción C.

T-010 confirma la config de Vercel.
