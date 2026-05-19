# Sprint 1 — Auth + Tenancy + base multi-tenant

**Status:** ✅ COMPLETO (8/8)

| Ticket | Status | Descripción |
|--------|--------|-------------|
| T-011 | ✅ | Migration `tenancy.sql` + RLS default-deny + ADR-0006 |
| T-012 | ✅ | Signup flow productivo (auth.signUp + RPC atómica + email confirm) |
| T-013 | ✅ | Login real (password) + magic link + `/dashboard` stub |
| T-014 | ✅ | Password recovery + logout formalizado |
| T-015 | ✅ | RLS helpers SQL reusables (4 funciones stable security definer) |
| T-016 | ✅ | Custom claim `consultora_id` en JWT via Supabase Auth Hook |
| T-017 | ✅ | Layout autenticado route group `(app)` + sidebar + user menu |
| T-018 | ✅ | E2E auth flow con Playwright |

## T-011 ✅ Migration tenancy.sql

Migration `tenancy.sql`: 3 tablas (`consultoras`, `consultora_members`, `audit_log`) + función `current_consultora_id()` + triggers + 5 RLS policies default-deny + ADR-0006.

## T-012 ✅ Signup flow productivo

`/signup` → `auth.signUp` + RPC `create_consultora_and_owner` (atómico, trial 7d, slug `unaccent`) → `/check-email` → email confirm → `/auth/callback?next=/login` → `/login?confirmed=1`.

## T-013 ✅ Login real + magic link + `/dashboard` stub

Login real (password) + magic link (botón secondary) + `/dashboard` stub (server-protected). `/auth/callback` con `?next=` allowlisted. Migration `dashboard_rls.sql` suma policy defensiva `consultoras_select_own_member`. `signOutAction` server-side.

## T-014 ✅ Password recovery + logout

Password recovery completo + logout formalizado: `/recuperar-password` (form anti-enumeration) + `/cambiar-password` (server-protected) + `updatePasswordAction` con flujo `resetPasswordForEmail` → `/auth/callback?next=/cambiar-password` → `/dashboard?reset=ok`. Banner "Contraseña actualizada" en dashboard. Link "¿Olvidaste tu contraseña?" en LoginForm. 7 integration tests recovery + 6 E2E.

## T-015 ✅ RLS helpers SQL reusables

RLS helpers SQL reusables: 4 funciones `stable security definer` en schema `public` (`is_member_of_consultora`, `is_owner_of_consultora`, `role_on_consultora`, `my_consultora_ids`). Policies pre-existentes refactorizadas (`consultoras_update_own_owner`, `consultoras_select_own_member`) — semántica idéntica, sin regresiones. 5 integration tests nuevos (13 → 18 RLS, 48/48 total). Migrations `20260511130757_rls_helpers.sql` + `20260511131522_rls_use_helpers.sql`. Dev tool `pnpm dev:smoke-rls-helpers`.

## T-016 ✅ Custom claim consultora_id en JWT

Custom claim `consultora_id` en JWT via Supabase Auth Hook: `custom_access_token_hook()` inyecta `app_metadata.consultora_id` + `consultora_role` en cada token issue. `current_consultora_id()` refactor lee del claim. Fast-path en los 4 RLS helpers de T-015 (claim primero, fallback a `consultora_members`). Refresh explícito post-signin + post-callback PKCE. Validado E2E en prod: JWT real trae los claims.

## T-017 ✅ Layout autenticado route group (app)

Layout autenticado con route group `(app)`: server-protected layout valida sesión + carga consultora via helper `getCurrentConsultora` (decodifica JWT claim para fast-path + fallback a `consultora_members`). App shell con sidebar (desktop fija + mobile Sheet), nav items con `usePathname`, user menu (DropdownMenu con cambiar contraseña + logout via `useTransition`). 4 shadcn components nuevos (sheet, dropdown-menu, avatar, tooltip). Dashboard simplificado con cards "Próximamente" por feature. Migración: `src/app/dashboard/*` → `src/app/(app)/dashboard/*`; `signOutAction` → `src/shared/auth/actions.ts`. Alert `?error=no_consultora` en LoginForm para edge case (user autenticado sin membership).

## T-018 ✅ E2E auth flow con Playwright

E2E auth flow con Playwright: 5 tests con sesión real en `src/tests/e2e/auth-flows.spec.ts` (layout protection sin sesión + `no_consultora` alert + login happy path + logout + recovery completo 7 pasos). Helpers reusables en `src/tests/e2e/helpers/` (`createTestUserWithConsultora`, `deleteTestUser`, `generateRecoveryLinkUrl`, `loginViaUI`, `logoutViaUI`) que bypasean email rate limit via `admin.createUser({email_confirm:true})` + `admin.generateLink`. Cierra drift de placeholders Supabase en `ci.yml` → GitHub Secrets reales. Bump Node 20 → 22 LTS en CI (WebSocket nativo requerido por `@supabase/realtime-js`). Suite total: **39 unit/component + 57 integration + 28 E2E = 124 tests verdes** corriendo en CI sin opt-in flags.
