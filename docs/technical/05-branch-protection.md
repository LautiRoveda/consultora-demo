# Technical 05 · Branch protection de `main`

Configuración de protección de la branch `main` en GitHub. Se aplica **una sola vez** después de validar que el primer run del workflow `CI` (ver `.github/workflows/ci.yml`) pasa verde.

## Cuándo aplicarla

1. T-004 mergeado en `main`.
2. Primer run del workflow `CI` ejecutado y verde en `https://github.com/LautiRoveda/consultora-demo/actions`.
3. **Recién entonces** correr el script de Parte A o aplicar Parte B manualmente.

Si la aplicás antes de que CI haya corrido al menos una vez, GitHub no encuentra el status check `CI` registrado y rechaza la config.

## Configuración resultante

| Regla | Valor | Por qué |
|-------|-------|---------|
| Require status checks to pass before merging | ✅ con check `CI` | El pipeline es el gate real (P5). |
| Require branches to be up to date before merging | ✅ | Garantiza linear history sobre `main`. |
| Require conversation resolution before merging | ✅ | Cierra discusiones de PR antes de mergear. |
| Required pull request reviews | 0 (no requerido) | Proyecto unipersonal hoy. Subir cuando se sume gente. |
| Allow force pushes | ❌ | No queremos reescribir historia de `main`. |
| Allow deletions | ❌ | `main` no se borra nunca. |
| Enforce for admins | ❌ | El dueño puede hot-fix si rompe algo (por convención no lo hace). |
| Lock branch | ❌ | `main` recibe merges de PRs, no está locked. |

## Parte A · Aplicar con `gh CLI` (recomendado)

Pre-requisito: tener GitHub CLI instalado y autenticado (`gh auth status` debe devolver OK).

```bash
gh api -X PUT \
  repos/LautiRoveda/consultora-demo/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
EOF
```

Verificación:

```bash
gh api repos/LautiRoveda/consultora-demo/branches/main/protection | jq
```

Debe devolver el JSON con la misma config aplicada.

## Parte B · Aplicar vía UI de GitHub (alternativa manual)

1. Ir a `https://github.com/LautiRoveda/consultora-demo/settings/branches`.
2. Click **Add branch ruleset** (o **Add classic branch protection rule** si preferís el flujo viejo).
3. **Branch name pattern:** `main`.
4. Activar las siguientes reglas:
   - ✅ **Require a pull request before merging**
     - Required approvals: **0**
     - ✅ Require conversation resolution before merging
   - ✅ **Require status checks to pass**
     - ✅ Require branches to be up to date before merging
     - Buscar y seleccionar: **CI**
   - ✅ **Require linear history**
   - ❌ Require deployments to succeed (no aplica)
   - ❌ Lock branch
   - ❌ Do not allow bypassing the above settings
5. **Restrict pushes:**
   - ❌ Allow force pushes
   - ❌ Allow deletions
6. Click **Create** o **Save changes**.

## Verificación post-aplicación

Test rápido para confirmar que la protección funciona:

```bash
# Desde main local, intentar push directo de un commit cualquiera
git checkout main
git commit --allow-empty -m "chore: test branch protection"
git push origin main
```

Esperado: GitHub rechaza el push con un mensaje tipo `Required status check 'CI' is expected` o `protected branch hook declined`. Si pasa, la protección NO está activa — revisar la config.

Limpieza (revertir el commit de prueba):

```bash
git reset --soft HEAD~1
```

(Notar `--soft`, alineado con la regla de seguridad de tickets anteriores: nunca `--hard`.)

## Cómo trabajar con `main` protegida

Workflow de aquí en adelante:

```bash
# 1. Crear branch para el ticket
git checkout -b feature/T-005-supabase-tenancy

# 2. Hacer cambios, commits con formato T-XXX · ... (validados por commit-msg hook)
git add .
git commit -m "T-005 · ..."

# 3. Push de la branch (pre-push hook corre typecheck local)
git push -u origin feature/T-005-supabase-tenancy

# 4. Abrir PR
gh pr create --base main --head feature/T-005-supabase-tenancy --fill

# 5. Esperar CI verde en el PR. Mergear via gh CLI o UI.
gh pr merge --squash --delete-branch

# 6. Volver a main
git checkout main
git pull
```

`main` queda intocable salvo vía PR mergeado con CI verde.

## Para revertir la protección (emergencia)

Si por algún motivo necesitás push directo (hot-fix de un bug que rompe prod):

```bash
gh api -X DELETE repos/LautiRoveda/consultora-demo/branches/main/protection
# ... hacés el hot-fix con push directo ...
# después VOLVER A APLICAR la protección con el script de Parte A.
```

Mejor evitar esta ruta. Preferir un PR de hot-fix con CI verde aún en emergencias.

## Relación con el deploy de Vercel

Vercel está integrado con GitHub via su app. Cada push a `main` triggea un deploy de producción automático. Cada PR triggea un deploy preview en una URL `consultora-demo-git-<branch>-<scope>.vercel.app`.

La protección de `main` no afecta el flujo de Vercel — al contrario, lo hace más seguro: solo se deploya código que pasó por CI verde.

T-010 va a confirmar la config de Vercel. Hoy el proyecto está deployado como sitio estático (vía `vercel.json` que apunta al `index.html` viejo, ahora movido a `public/prototipo/`). El próximo deploy de Vercel post-T-010 va a servir el Next.js 16.
