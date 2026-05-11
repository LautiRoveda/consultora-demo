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

## Test data residual (T-011)

`pnpm test:integration` (RLS cross-tenant) crea consultoras + users + audit_log con slug `t011-test-*-<runId>`. El `afterAll` borra users (cascada limpia memberships), pero el trigger inmutable del `audit_log` impide DELETE de sus filas — y la FK `audit_log.consultora_id → consultoras` con `on delete restrict` impide borrar las consultoras. Resultado: cada run deja 2 consultoras + 2 audit_log rows orphan en `sa-east-1`.

Es aceptable para Sprint 1 (developer-discipline local). Limpieza manual periódica vía SQL Editor (cuando se acumulen muchos rows o cuando se quiera resetear):

```sql
-- Disable trigger inmutable temporalmente para limpiar test data.
alter table public.audit_log disable trigger audit_log_no_delete;

delete from public.audit_log
where consultora_id in (select id from public.consultoras where slug like 't011-test-%');

delete from public.consultoras where slug like 't011-test-%';

alter table public.audit_log enable trigger audit_log_no_delete;
```

Cuando T-018 (cierre Sprint 1) configure CI con Supabase secrets, evaluar limpiar tests para que sean self-cleaning end-to-end.

## Troubleshooting

- **`Access token not provided`**: corriste `supabase` sin `supabase login` previo, o tu token expiró. Volvé a loguear.
- **`Cannot find project ref`**: no hiciste `supabase link --project-ref <ref>` aún en esta carpeta.
- **`extension "X" is not available`**: el nombre canónico de la extensión es distinto al package name. Ej: `pgvector` en Postgres se crea como `vector`. Verificar en [supabase docs · extensions](https://supabase.com/docs/guides/database/extensions).
- **`Docker Desktop is a prerequisite`**: el comando que invocaste necesita Docker (típicamente `db diff`, `db reset`, `db dump`, `start`). Para `db push` y `migration list` no hace falta.
