# ADR-0004 · Diferir branch protection server-side

**Fecha:** 2026-05-09
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** API de GitHub Rulesets y classic branch protection (verificado empíricamente el 2026-05-09 sobre `LautiRoveda/consultora-demo`)

## Contexto

T-004 (commit `70b75dc`, mergeado en `origin/main` el 2026-05-09) configuró GitHub Actions CI con un workflow único `ci.yml` que ejecuta el pipeline completo (format → lint → typecheck → test → build → e2e) en cada PR a `main` y push a `main`. El primer run terminó verde después de un fix (`42dc24d`, orden de `pnpm/action-setup` antes de `actions/setup-node`).

El plan de T-004 incluía como paso siguiente aplicar **branch protection** a `main` con `gh CLI` para que el status check `CI` fuera obligatorio antes de cualquier merge. La doc `docs/technical/05-branch-protection.md` (versión original commiteada con T-004) tenía un script con el payload de la API classic.

Al ejecutar el script, GitHub respondió:

```
{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature.","status":"403"}
```

Probamos como alternativa la API moderna **Rulesets** (basados en información que sugería que era free para repos privados en 2024+). También devolvió 403, **incluso con un ruleset minimal** (solo `deletion` + `non_fast_forward`, las reglas menos restrictivas que existen).

**Conclusión empírica al 2026-05-09:** en cuenta GitHub free + repo privado, **ninguna de las dos APIs** permite proteger una branch, ni siquiera con la regla más mínima. La doc oficial de GitHub confirma que branch protection (en cualquier sabor) requiere Pro, Team, Enterprise, o repo público.

## Opciones evaluadas

### Opción A · Hacer el repo público

- **Pros:** Habilita classic + Rulesets gratis. Sin costo recurrente.
- **Contras:** Expone `docs/discovery/` (análisis de mercado, pricing, decisiones competitivas), `docs/technical/`, ADRs, discusiones internas. Ventaja competitiva pre-MVP queda al aire. Posible filtro adverso para futuras decisiones legales o de partners.
- **Costo:** $0 económico. Costo estratégico medio-alto en etapa pre-launch.

### Opción B · Upgrade a GitHub Pro

- **Pros:** Habilita ambas APIs en repos privados. Suma Codespaces extendido, Copilot Pro, code scanning, Actions minutes adicionales.
- **Contras:** USD 4/mes recurrentes (USD 48/año). Para un proyecto unipersonal, el ROI de "branch protection real" vs "convención + hook local" es bajo (los hooks ya cubren el 95% del riesgo). El ROI sube cuando se sume el segundo dev.
- **Costo:** USD 48/año.

### Opción C · Diferir + reforzar con convención auto-impuesta + hook local

- **Pros:** Sin costo, sin exposición. Convención de "todo cambio va por feature branch + PR + CI verde antes de merge" se aplica sola en proyecto unipersonal. Reforzada técnicamente con un hook `.husky/pre-push` que bloquea pushes directos a `main`/`master`.
- **Contras:** El hook local se puede saltar con `git push --no-verify`. Confianza basada en disciplina, no en enforcement server-side. Si en algún momento alguien con acceso al repo pushea con bypass, no hay rollback automático ni rechazo del server. Vercel deploya cualquier cosa que entre a `main`, esté testeada o no.
- **Costo:** $0.

## Decisión

**Opción C: diferir branch protection server-side, reforzar con convención y hook local.**

Implementación inmediata:

1. Hook `.husky/pre-push` actualizado para bloquear pushes directos a `main`/`master`. El typecheck previo se preserva como segundo step después del check de branch.
2. Doc `docs/technical/05-branch-protection.md` reescrita reflejando el estado real (3 opciones evaluadas, decisión, convención, script para reactivar cuando aplique).
3. Este ADR fija la decisión y los triggers de revisión.

## Consecuencias

### Positivas

- $0 de costo recurrente.
- Cero exposición de discovery / decisiones competitivas (repo sigue privado).
- Convención de flow PR auto-impuesta cubre el caso normal.
- Hook `pre-push` actúa como recordatorio + safety net contra distracción.
- CI sigue siendo el gate real de calidad sobre cada push y PR (T-004 ya activo).

### Negativas

- **El hook local NO es protección real.** `git push --no-verify` lo saltea silenciosamente.
- Vercel deploya cualquier cosa que llegue a `main`, esté con CI verde o no. Si se hace un push con bypass que rompe el build, prod queda roto hasta el próximo push fix.
- Si en algún momento la cuenta GitHub tiene un token comprometido, no hay barrera server-side que limite el daño.
- La auto-disciplina escala mal con más de 1 contributor.

### Inciertas

- **Cuándo se cumple un trigger de revisión.** Esperamos que sea por "nuevo contributor" o "MRR > USD 100" antes que por "incidente real". Si pasa lo contrario, fue mala apuesta.
- **Si Vercel implementa su propio gate de deploy basado en CI.** A veces lo configuran via integration GitHub para no deployar si checks fallaron. Vale verificar en T-010.

## Triggers para reactivar

Reabrir como ticket `T-004.5 · Activar branch protection server-side` cuando ocurra **alguno**:

1. **Nuevo contributor.** Apenas se sume otra persona al repo (interno o externo), la auto-disciplina deja de escalar y se requiere enforcement real.
2. **MRR > USD 100.** USD 4/mes de Pro deja de ser inversión "innecesaria" cuando hay revenue.
3. **Incidente real por push directo.** Si se rompe `main` por bypass (intencional o accidental) que cuesta tiempo restaurar, trigger inmediato.
4. **Open-sourcing del proyecto.** Si la decisión D-XX cambia y abrimos el repo, branch protection clásica + Rulesets quedan habilitadas gratis.

El script para reactivar (con payload de Rulesets ya listo) vive en [docs/technical/05-branch-protection.md](../technical/05-branch-protection.md), sección "Script para el día que se reactive". Se pega y corre apenas haya billing tier que lo permita.

## Referencias

- [docs/technical/05-branch-protection.md](../technical/05-branch-protection.md) — doc operativa con flow PR + script de reactivación.
- [GitHub Docs · About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) — confirma billing requirement.
- [docs/adr/0002-stack-eleccion.md](./0002-stack-eleccion.md) — ADR padre del stack que fija GitHub + Vercel.
- T-004 commit `70b75dc` — ticket original que planificó esta protección.
- T-004 fix commit `42dc24d` — fix de orden pnpm/setup-node en el workflow.
- T-004 follow-up commit (este, hash a confirmar al merge del PR `chore/T-004-diferir-branch-protection`).
