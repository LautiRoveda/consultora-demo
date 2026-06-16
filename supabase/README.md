# Supabase

Configuración de Supabase para ConsultoraDemo. Schema, migrations y tooling.

Referencias:
- [docs/technical/03-data-model.md](../docs/technical/03-data-model.md) — schema completo, RLS policies.
- [docs/adr/0002-stack-eleccion.md](../docs/adr/0002-stack-eleccion.md) — por qué Supabase.
- T-005 (`docs/technical/10-roadmap.md` línea 31-32) — ticket que dejó esto operativo.

## Estructura

```
supabase/
├── config.toml           # config local de la CLI (puertos, auth, storage)
├── migrations/           # SQL versionado, se aplica al remote con `pnpm db:push`
│   └── <ts>_extensions.sql
├── seed.sql              # data de desarrollo, se aplica con `pnpm db:reset`
├── .gitignore            # `.branches`, `.temp`, `.env.local`
└── README.md             # este archivo
```

`.supabase/` (en raíz del repo, gitignored) guarda metadata del link al proyecto remoto.

## Proyecto remoto

Creado al ejecutar T-005:

- Nombre: `consultora-demo`
- Plan: Free
- Región: `sa-east-1` (São Paulo) — elegida por baja latencia desde Argentina (~50 ms vs ~150 ms desde us-east-2).
- Dashboard: <https://supabase.com/dashboard/project/$SUPABASE_PROJECT_REF>

Las credenciales (URL, anon key, service role key, DB password, project ref) viven en `.env.local` (gitignored). La plantilla está en [`.env.example`](../.env.example).

**Producción (T-010):** las 3 vars `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` están configuradas como Vercel Environment Variables en scopes **Production + Preview**. La `SUPABASE_DB_PASSWORD` y el `SUPABASE_PROJECT_REF` NO se exponen al runtime — solo se usan desde CLI local con el dueño del proyecto. Ver [docs/technical/06-deployment.md](../docs/technical/06-deployment.md) para regenerar keys o agregar contributors.

## Setup local en una máquina nueva

1. Instalar dependencias: `pnpm install` — descarga la CLI de Supabase como devDep.
2. Login: `pnpm exec supabase login` — abre browser, autenticás contra tu cuenta de Supabase.
3. Link: `SUPABASE_DB_PASSWORD=<password> pnpm exec supabase link --project-ref <ref>`.
4. Listo. `pnpm db:push` aplica migrations pendientes al remoto.

## Comandos comunes

Todos definidos en `package.json`. La CLI corre como `pnpm exec supabase ...` o vía estos wrappers.

| Comando | Qué hace | Requiere Docker |
|---|---|---|
| `pnpm db:start` | Levanta stack local (Postgres + GoTrue + Storage + Studio + ...) | **Sí** |
| `pnpm db:stop` | Apaga la stack local | Sí |
| `pnpm db:status` | Estado de los containers locales | Sí |
| `pnpm db:reset` | Resetea la DB local + aplica migrations + seed | Sí |
| `pnpm db:push` | Aplica migrations pendientes al **remote** | No |
| `pnpm db:diff` | Diff schema local vs remote (genera nueva migration) | Sí |
| `pnpm db:migration:new <name>` | Crea archivo `<timestamp>_<name>.sql` en `migrations/` | No |
| `pnpm db:types` | Regenera `src/shared/supabase/types.ts` desde el remote | No |

## Docker / desarrollo local

**Docker Desktop NO es requisito de T-005.** Podés trabajar contra el remote para todo lo que necesites en Sprint 0 y la mayor parte de Sprint 1. Cuando lleguemos a iterar más rápido sobre el schema, instalar Docker Desktop te habilita:

- `pnpm db:start` para levantar una stack local idéntica al remote.
- `pnpm db:reset` para limpiar la base local y reaplicar migrations + seed.
- `pnpm db:diff` para autogenerar migrations a partir de cambios manuales en el schema local.
- `pnpm db:dump` (vía CLI directa) para snapshot del schema remoto.

Sin Docker, `db push` sigue funcionando contra remote (es el flujo principal de T-005). `migration list --linked` también.

## Cómo crear una nueva migration

```bash
pnpm db:migration:new <descripcion_breve>
# crea supabase/migrations/<ts>_<descripcion>.sql vacío

# editás el SQL

SUPABASE_DB_PASSWORD=<password> pnpm db:push
# aplica al remote. La migration queda registrada en supabase_migrations.schema_migrations.

pnpm db:types
# regenera tipos TypeScript (cuando haya tablas; en T-005 todavía no aplica).
```

**Reglas:**
- **Nunca** modificar una migration ya aplicada al remote. Para cambios, crear una migration nueva.
- Naming: `<YYYYMMDDHHMMSS>_<descripcion_snake_case>.sql` (lo genera el CLI con timestamp UTC).
- SQL en minúscula por convención (siguiendo `docs/technical/03-data-model.md`).
- Toda tabla nueva: `consultora_id` + RLS habilitado + policy + index. Sin excepción.

## Seguridad de migraciones — lint squawk (T-151)

CI lintea con **squawk** (`pnpm lint:migrations`, job `Migrations lint (squawk)`) **solo las migraciones nuevas del PR** (diff vs `origin/main`); las históricas ya están en prod y NUNCA se re-lintean. Config en [`.squawk.toml`](../.squawk.toml). El job es uno de los `needs` del gate `ci-passed`: una migración insegura pinta el CI rojo **antes** del merge. Cierra el hallazgo P-1 de la auditoría CI/CD (la clase de incidente de T-016: una migración que "aplica" bien pero cuelga prod por locks).

Reglas que más vas a tocar (el set completo está ON salvo `prefer-robust-stmts` y `ban-drop-column`, excluidas a propósito):

1. **Timeouts al tope (`require-timeout-settings`).** Toda migración nueva que toque tablas en uso arranca con:

   ```sql
   set lock_timeout = '2s';
   set statement_timeout = '30s';
   -- ...el resto de la migración
   ```

   `lock_timeout` acota cuánto esperás un lock (si no lo conseguís rápido, fallás en vez de colgar la tabla); `statement_timeout` corta operaciones largas. Sin ambos al tope, el job va rojo.

2. **`CREATE INDEX CONCURRENTLY` (`require-concurrent-index-creation`).** Crear un índice sobre una tabla **existente** bloquea writes; usá `concurrently`. Excepción: un índice sobre una tabla creada en la **misma** migración no se flaggea (no hay tráfico concurrente todavía).

   - Los índices concurrentes van en una migración **aislada** nombrada `*_concurrently.sql` (p.ej. `..._mi_idx_concurrently.sql`), con el `create index concurrently` como única sentencia. `supabase db push` solo la corre fuera de transacción si es la única sentencia → por eso **no** lleva los `set ...timeout` del tope (y el lint la saltea: `require-timeout-settings` no aplica).

3. **`NOT NULL` sin default (`adding-required-field` / `adding-not-nullable-field`).** Agregar una columna `not null` sin default a una tabla con datos fuerza un rewrite/scan. Hacela nullable, o con un default no-volátil, y backfilleá aparte.

4. **Constraints con lock (`constraint-missing-not-valid`, `adding-foreign-key-constraint`, `disallowed-unique-constraint`).** Agregar un CHECK/FK/UNIQUE valida toda la tabla bajo lock. Patrón expand-contract: `add constraint ... not valid` primero, luego `validate constraint ...` en una sentencia aparte.

5. **Drops de columna (expand-contract).** `ban-drop-column` está **excluida** (no enforzada) porque dropeás columnas a propósito. La convención (no lint, disciplina): dropeá una columna **solo después** de cortar todos sus consumers (código + tipos + triggers) en un release previo. Ver el lesson de T-129 fase B (grepear `new.col`/`old.col` en triggers antes del drop).

Si squawk tira un falso positivo en sintaxis válida de Supabase, no apagues la regla global: documentá el caso. Para correrlo local: `pnpm lint:migrations` (no-op verde si tu branch no toca `supabase/migrations/`).

## Estado de extensiones (post-T-005)

Migration `<ts>_extensions.sql` instaló:

- `uuid-ossp` ✅ (ya venía habilitada por Supabase)
- `pgcrypto` ✅ (ya venía habilitada por Supabase)
- `vector` (pgvector) ✅ — habilitada para Fase 4 (búsqueda semántica de documentos)
- `pg_cron` ✅ — habilitada para Sprint 2 (alertas de calendario)

Verificación rápida (SQL Editor de supabase.com):

```sql
select extname, extversion
from pg_extension
where extname in ('uuid-ossp', 'pgcrypto', 'vector', 'pg_cron')
order by extname;
```

## Extensiones adicionales por ticket

| Extensión | Habilitada en | Para qué |
|---|---|---|
| `uuid-ossp` | T-005 | `uuid_generate_v4()`. Hoy preferimos `gen_random_uuid()` de pgcrypto. |
| `pgcrypto` | T-005 | `gen_random_uuid()` + `crypt()`/`gen_salt()` para hashing futuro. |
| `vector` (pgvector) | T-005 | Fase 4: búsqueda semántica de documentos. |
| `pg_cron` | T-005 | Sprint 2: jobs programados (alertas calendario). |
| `unaccent` | T-012 | Normalización de slug en `create_consultora_and_owner` (acentos español). |

## Funciones SQL del dominio

- `public.current_consultora_id()` (T-011) — extrae `app_metadata.consultora_id` del JWT.
- `public.set_updated_at()` (T-011) — trigger compartido para `updated_at`.
- `public.audit_log_immutable()` (T-011) — trigger BEFORE UPDATE/DELETE que rechaza modificaciones.
- `public.create_consultora_and_owner(uuid, text)` (T-012) — RPC atómica de signup: crea consultora (trial 7d, slug normalizado) + membership owner.

### RLS helpers (T-015)

4 helpers `stable security definer set search_path = ''` que las policies invocan en lugar de duplicar subqueries inline. Grant `execute` a `authenticated` + `service_role`; `revoke from anon`.

| Helper | Returns | Uso típico en policy |
|---|---|---|
| `public.is_member_of_consultora(p_consultora_id uuid)` | `boolean` | `using (public.is_member_of_consultora(consultora_id))` |
| `public.is_owner_of_consultora(p_consultora_id uuid)` | `boolean` | `using (public.is_owner_of_consultora(consultora_id))` para `UPDATE`/`DELETE` restringidas a owner |
| `public.role_on_consultora(p_consultora_id uuid)` | `text` (`'owner' \| 'member'` o `NULL`) | checks condicionales por rol granular |
| `public.my_consultora_ids()` | `setof uuid` | `using (consultora_id in (select public.my_consultora_ids()))` (multi-tenant per user futuro) |

**Ejemplo de policy con helper:**

```sql
-- Tabla de dominio futura (T-019+): clientes
alter table public.clientes enable row level security;

create policy clientes_select_own on public.clientes
  for select using (public.is_member_of_consultora(consultora_id));

create policy clientes_update_own_owner on public.clientes
  for update using (public.is_owner_of_consultora(consultora_id));
```

**Regla forward (T-015):** policies NUEVAS deben usar los helpers, NO subqueries inline a `consultora_members`. Las existentes (`consultoras_update_own_owner`, `consultoras_select_own_member`) ya fueron refactorizadas en `20260511131522_rls_use_helpers.sql`.

**Performance:** el planner Postgres inlinea funciones `sql + stable + security definer` directamente en la query — no hay overhead vs subquery escrita a mano. El `unique (user_id, consultora_id)` de T-011 da auto-index óptimo para los 4 helpers (columna líder `user_id`).

## Policies RLS adicionales por ticket

- `consultoras_select_own` + `consultoras_update_own_owner` (T-011) — basadas en `current_consultora_id()`.
- `consultora_members_select_own` + `consultora_members_select_self` (T-011) — la 2da es defensiva pre-T-016.
- `audit_log_select_own` (T-011).
- `consultoras_select_own_member` (T-013) — defensiva pre-T-016: espejo de `consultora_members_select_self`, permite al dashboard leer la propia consultora vía JOIN sin depender del custom claim.

## Supabase Auth Email Templates (T-079)

Wording + HTML de los 6 templates (Confirm signup, Magic Link, Reset Password, Invite User, Change Email, Reauthentication) vive en [`docs/operations/email-templates.md`](../docs/operations/email-templates.md) — fuente de verdad versionada del repo. Aplicar via `Supabase Dashboard → Authentication → Email Templates` cuando cambien.

Reset Password en particular: `{{ .ConfirmationURL }}` apunta a `/auth/callback?next=/cambiar-password&from=recovery` (config T-014).

## Test data residual (T-011 + T-012)

`pnpm test:integration` crea data de test contra Supabase remoto:

- **T-011 (RLS):** consultoras + users + audit_log con slug `t011-test-*-<runId>`. El `afterAll` borra users (cascada limpia memberships), pero el trigger inmutable del `audit_log` impide DELETE de sus filas — y la FK `audit_log.consultora_id → consultoras` con `on delete restrict` impide borrar las consultoras.
- **T-012 (signup RPC):** consultoras + users con slug `t012-test-*-<runId>`. Misma situación: users limpios, consultoras orphan.
- **T-013 (signin + dashboard):** consultoras + users con slug `t013-test-*-<runId>`. Misma situación.
- **T-014 (recovery + logout):** consultoras + users con slug `t014-test-*-<runId>`. Misma situación.

Es aceptable para Sprint 1 (developer-discipline local). Limpieza manual periódica vía SQL Editor:

```sql
-- Disable trigger inmutable temporalmente para limpiar test data.
alter table public.audit_log disable trigger audit_log_no_delete;

delete from public.audit_log
where consultora_id in (
  select id from public.consultoras
  where slug like 't011-test-%' or slug like 't012-test-%' or slug like 't013-test-%'
     or slug like 't014-test-%'
);

delete from public.consultoras
where slug like 't011-test-%' or slug like 't012-test-%' or slug like 't013-test-%'
   or slug like 't014-test-%';

alter table public.audit_log enable trigger audit_log_no_delete;
```

Cuando T-018 (cierre Sprint 1) configure CI con Supabase secrets, evaluar limpiar tests para que sean self-cleaning end-to-end.

## Supabase Auth config (T-012)

Configuración no versionada (vive en el dashboard, no en el repo):

- **Authentication → URL Configuration:**
  - Site URL: `https://consultora-demo.vercel.app`
  - Redirect URLs allow-list: `https://consultora-demo.vercel.app/auth/callback`, `http://localhost:3000/auth/callback`.
- **Authentication → Sign In / Up:** "Enable signups" ON · "Confirm email" ON.
- **Authentication → Emails → Templates → "Confirm signup":** subject + body en español rioplatense (ver T-012 PR para wording final).
- **Rate limits:** default Supabase (~30 signUp/h por IP). Si vemos abuse, evaluar middleware o Upstash Redis.

## Troubleshooting

- **`Access token not provided`**: corriste `supabase` sin `supabase login` previo, o tu token expiró. Volvé a loguear.
- **`Cannot find project ref`**: no hiciste `supabase link --project-ref <ref>` aún en esta carpeta.
- **`extension "X" is not available`**: el nombre canónico de la extensión es distinto al package name. Ej: `pgvector` en Postgres se crea como `vector`. Verificar en [supabase docs · extensions](https://supabase.com/docs/guides/database/extensions).
- **`Docker Desktop is a prerequisite`**: el comando que invocaste necesita Docker (típicamente `db diff`, `db reset`, `db dump`, `start`). Para `db push` y `migration list` no hace falta.
