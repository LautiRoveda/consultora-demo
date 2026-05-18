# Seguridad — auditoría de dependencias (T-080)

> **Audiencia:** Lautaro. Procedimiento operativo para procesar PRs auto de
> Dependabot y findings de `pnpm audit` en CI.

Primer ticket del sándwich seguridad operacional T-080..T-083 que va antes
de Empleados (Sprint 4). Foco: detectar vulnerabilidades en dependencias
automáticamente, sin requerir auditoría manual semanal.

## Cuándo se corre

Tres disparadores automáticos + uno manual:

1. **Cada PR + cada push a `main`** — workflow `.github/workflows/security.yml`
   corre `pnpm audit --audit-level=high` y deja annotation visible (notice
   si clean, warning si hay findings). NO bloquea merge.
2. **Weekly Monday 09:00 UTC (= 06:00 ART)** — schedule del workflow detecta
   CVEs publicados durante la semana. Mismo día/hora que dependabot abre PRs.
3. **Manual** — Actions UI → "Security audit" → Run workflow. Útil tras
   incidente o pre-deploy crítico.
4. **Local** — `pnpm audit` (alias `pnpm audit --audit-level=high`).

## Dependabot — config en `.github/dependabot.yml`

**Schedule**: weekly Monday 09:00 UTC. Lunes a la mañana inicio de sprint.

**Ecosystems cubiertos**:
- `npm` — cubre `pnpm-lock.yaml` (dependabot lee el lockfile de pnpm via el
  ecosystem npm).
- `github-actions` — versiona acciones (`actions/checkout@v5`, `setup-node@v5`,
  `pnpm/action-setup@v6`, etc).

**Grouping**:
- Dev-deps minor + patch agrupados en **1 PR semanal** (eslint, prettier,
  vitest, playwright, testing-library, typescript, husky, etc). Raramente
  rompen, eficiente revisar agrupado.
- Runtime deps en **PRs individuales** (next, react, supabase, anthropic,
  resend, web-push, sharp, puppeteer, etc). Crítico, revisar uno por uno.

**Ignore list — major bumps no auto-PR** (revisar manual):
- `next`, `react`, `react-dom` (frameworks).
- `@supabase/supabase-js`, `@supabase/ssr` (auth + RLS APIs).
- `@anthropic-ai/sdk` (streaming/API).
- `puppeteer-core`, `sharp` (Docker + binarios nativos).
- `tailwindcss`, `eslint`, `typescript` (config + breaking changes).

Minor + patch de TODAS las deps SÍ auto-PR (rama feliz).

**Open PR limit**: 3 por ecosystem (npm + github-actions = max 6 simultáneos).
Evita inundación si estás mid-sprint sin procesar el dump semanal.

## Procedimiento de revisión — PRs auto de Dependabot

**Cada lunes a la mañana** (15-30 min según volumen):

1. **Filtrar PRs** abiertos por label `auto-pr` (los abre Dependabot con esa
   label + `dependencies`).

2. **Revisar CI verde** en cada PR (workflow `CI` debe pasar). Si rojo →
   no mergear, ir al paso 5.

3. **PR de dev-deps agrupada** (`dev-deps-minor-patch`):
   - CI verde → merge directo. Las dev-deps minor/patch raramente rompen.
   - Si CI rojo → cerrar PR + investigar manual (probablemente regla nueva de
     eslint que el código no respeta, o cambio en API de testing-library).

4. **PR de runtime dep individual** (next, supabase, anthropic, etc):
   - Abrir el changelog del paquete (el PR de dependabot incluye link).
   - Si patch (`x.y.z → x.y.z+1`) o minor benigno → merge si CI verde.
   - Si minor con cambios notorios → smoke local antes de mergear:
     `git fetch origin && git checkout dependabot/...` → `pnpm install` →
     `pnpm dev` + smoke 2-3 features del paquete actualizado.

5. **CI rojo**: cerrar PR + abrir issue tech-debt con el changelog y los
   logs del fallo. El upgrade vuelve manual cuando haya tiempo.

6. **Smoke productivo post-merge**: redeploy automático en EasyPanel (Auto
   Deploy webhook). Verificar `consultora-demo.test-ia.cloud` carga + login
   funciona. Si rompe en prod (raro post-CI verde), rollback con
   `git revert` del merge commit.

## Cuándo escalar un finding de `pnpm audit`

El workflow corre `--audit-level=high` (solo HIGH + CRITICAL). Medium + low
están filtrados (demasiado ruido con falsos positivos transitivos).

**Escalación según severidad y path**:

| Severidad | Path en runtime crítico | Acción |
|-----------|------------------------|--------|
| CRITICAL  | next, react, supabase, anthropic, web-push, sharp, puppeteer, resend | **Hotfix PR manual ASAP** (mismo día). |
| CRITICAL  | Dep transitiva sin path en código real | Hotfix PR esta semana. |
| HIGH      | runtime crítico                | Hotfix PR esta semana. |
| HIGH      | Dep transitiva sin path en código real | Follow-up tech-debt slot (próximo sprint). |
| MEDIUM/LOW | cualquiera                    | Ignorar (filtrado por `--audit-level=high`). |

**Cómo verificar el path**:
```bash
pnpm why <paquete-vulnerable>
```
Muestra qué dep top-level lo está trayendo. Si es transitiva sin uso real en
nuestro código (`pnpm why` muestra 5+ niveles de profundidad sin path
directo), priorizar más bajo.

**Hotfix manual** cuando dependabot no resolvió auto (porque el major bump
está en ignore list, o porque el paquete no publicó fix aún):
```bash
git checkout -b fix/audit-<paquete>
pnpm update <paquete>  # o pnpm add <paquete>@<version> si es major bump
pnpm audit --audit-level=high  # verificar que el finding desaparece
# Smoke local + tests + commit + PR
```

## Major version bumps manuales

Los paquetes del ignore list NO disparan PR auto en major. Iniciar el bump
cuando:

- **Frameworks (next, react)**: en sprint operacional con tiempo dedicado.
  Leer release notes completas, validar features clave (App Router, RSC,
  Server Actions).
- **Supabase**: ojo a cambios en auth APIs + RLS — testear con sesión real
  + migraciones de RLS policies.
- **Anthropic SDK**: validar streaming + prompt caching ephemeral siguen
  funcionando.
- **Puppeteer + sharp**: testear PDF export end-to-end (T-023) + image
  pipeline (T-024) — son los features más sensibles a binarios.
- **Tailwind**: testear el tema custom + componentes shadcn.
- **eslint + typescript**: típicamente requieren ajuste de config + fixes
  inline. No bloqueante.

## Lessons forward (T-081/T-082/T-083)

- **T-081 rate limiting** va a sumar `@upstash/ratelimit` + `@upstash/redis`
  como deps runtime nuevas. Dependabot las va a trackear auto desde el merge.
- **T-082 backups + T-083 monitoring** son operacional (Supabase scheduled
  backups + Sentry alerts), NO suman deps npm. Sin impacto en este config.
- **Convención T-080+**: tickets transversales fuera del rango formal
  T-001..T-078 del roadmap (matcheando T-079 email templates).

## Convención de PRs auto

Dependabot abre PRs con shape:
- **Título**: `chore(deps): bump <paquete> from X.Y.Z to X.Y.Z+1` (runtime) o
  `chore(deps): bump the dev-deps-minor-patch group` (agrupado).
- **Labels**: `dependencies` + `auto-pr` (npm) o `dependencies` + `auto-pr` +
  `area:ci` (github-actions).
- **Commit message prefix**: `chore(deps)` para npm, `chore(actions)` para
  github-actions.
- **Reviewer**: vacío (single-owner repo, Lautaro recibe notif email default
  como repo owner).
