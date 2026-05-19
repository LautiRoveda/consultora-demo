# Sprint 0 — setup del repo

**Status:** ✅ COMPLETO (10/10)

| Ticket | Status | Descripción |
|--------|--------|-------------|
| T-001 | ✅ | Next.js 16 + TS strict + Tailwind 4 + shadcn/ui base |
| T-002 | ✅ | ESLint 9 (flat) + Prettier 3 + Husky 9 |
| T-003 | ✅ | Vitest 3 + Playwright (chromium) |
| T-004 | ✅ | GitHub Actions CI + flow PR-based + branch protection |
| T-005 | ✅ | Supabase CLI + proyecto remoto + extensiones |
| T-006 | ✅ | Cliente Supabase + env validation con Zod |
| T-007 | ✅ | Sentry + logger pino |
| T-008 | ✅ | Theme shadcn alineado al prototipo + 7 componentes base |
| T-009 | ✅ | Landing pública + `/login` UI + páginas legales |
| T-010 | ✅ | Vercel deploy desde main (hot-backup post-T-022.5) |

## T-001 ✅ Next.js 16 + TS strict + Tailwind 4 + shadcn/ui base

Setup base del proyecto.

## T-002 ✅ ESLint 9 (flat) + Prettier 3 + Husky 9

Hooks `commit-msg`, `pre-commit`, `pre-push`.

## T-003 ✅ Vitest 3 + Playwright (chromium)

Vitest 3 con projects: unit, component. Playwright con chromium.

## T-004 ✅ GitHub Actions CI + flow PR-based

`.github/workflows/ci.yml` + flow PR-based + hook pre-push contra push directo a `main` (branch protection server-side diferida, ver ADR-0004).

## T-005 ✅ Supabase CLI + proyecto remoto

Supabase CLI + proyecto remoto `consultora-demo` en sa-east-1 + migration de extensiones (uuid-ossp, pgcrypto, vector, pg_cron) aplicada al remote. Docker Desktop **no** instalado: trabajamos contra el remote.

## T-006 ✅ Cliente Supabase + validación de env con Zod

Cliente Supabase (server, browser, service-role) + helper proxy + validación de env con Zod en `src/env.ts` (server-only).

## T-007 ✅ Sentry + logger pino

Sentry (client + server + edge configs + `instrumentation.ts`) + logger pino con captura automática a Sentry en `error()`/`fatal()`. `/api/test-error` dev tool.

## T-008 ✅ Theme shadcn alineado al prototipo

Theme shadcn alineado al prototipo (indigo brand + 4 severity tokens) + 7 componentes base + `/styleguide` dev tool.

## T-009 ✅ Landing pública productiva + `/login` UI + páginas legales

Landing pública productiva (`/`) + `/login` UI (auth real T-012) + páginas legales `/terminos` y `/privacidad` con noindex + `robots.txt` + `sitemap.xml`. Lighthouse 97/100/100/100.

## T-010 ✅ Vercel deploy desde main

Vercel deploy desde main con 9 env vars (Production + Preview) + `SENTRY_AUTH_TOKEN` activo (source maps automáticos) + ADR-0005 + runbook `docs/technical/06-deployment.md`. URL Vercel: <https://consultora-demo.vercel.app> (hot-backup post-T-022.5; **URL productiva actual: <https://consultora-demo.test-ia.cloud>**).
