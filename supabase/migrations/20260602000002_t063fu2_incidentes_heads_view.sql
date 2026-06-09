-- T-063-FU2 · "Ver anulados" en el listado del libro de incidentes.
--
-- Problema: getIncidentes lee de `incidentes_vigentes`, que excluye los anulados
-- (head de cadena con anulacion=true). Hoy un incidente anulado queda en DB pero
-- NO hay forma de verlo desde la UI.
--
-- Solucion: una segunda vista `incidentes_heads` = head de cada cadena de
-- correcciones SIN el filtro de anulacion (vigentes + tombstones anulados;
-- excluye versiones superseded, que viven en el historial del detalle). El toggle
-- "incluir anulados" cambia la fuente de getIncidentes entre las dos vistas.
--
-- Append-only intacto: esto es SOLO lectura (vistas security_invoker). No toca
-- policies ni la tabla. PostgREST no expresa el anti-join NOT EXISTS, por eso es
-- una vista (mismo patron que incidentes_vigentes, T-062).
--
-- Drift: `incidentes_vigentes` se REDEFINE sobre `incidentes_heads` para
-- single-source la logica de head-of-chain (antes duplicaba el NOT EXISTS).

-- =============================================================================
-- A. VISTA incidentes_heads (head de cada cadena, anulados incluidos)
-- =============================================================================

-- security_invoker=true: corre con permisos del usuario que consulta -> la RLS de
-- incidentes aplica (multi-tenant correcto). Requiere Postgres 15+. Mismo patron
-- y semantica que incidentes_vigentes, pero SIN el `anulacion = false`.
create view public.incidentes_heads
  with (security_invoker = true)
as
  select i.*
  from public.incidentes i
  where not exists (
    select 1 from public.incidentes s where s.corrige_id = i.id
  );

comment on view public.incidentes_heads is
  'T-063-FU2: head de cada cadena de correcciones (nadie lo supersede via '
  'corrige_id), INCLUIDOS los anulados (anulacion=true). Vigentes + tombstones; '
  'excluye versiones superseded. security_invoker=true -> la RLS de incidentes '
  'aplica. getIncidentes lee de aca cuando el toggle "incluir anulados" esta on.';

grant select on public.incidentes_heads to authenticated, service_role;

-- =============================================================================
-- B. REDEFINIR incidentes_vigentes sobre incidentes_heads (single-source)
-- =============================================================================

-- Vigentes = heads no anulados. Columnas/tipos identicos -> create or replace
-- valido. La semantica observable no cambia (head no-anulado y no-superseded).
create or replace view public.incidentes_vigentes
  with (security_invoker = true)
as
  select h.*
  from public.incidentes_heads h
  where h.anulacion = false;

comment on view public.incidentes_vigentes is
  'T-062 (redefinida en T-063-FU2): registros vigentes del libro = incidentes_heads '
  'no anulados. security_invoker=true -> la RLS de incidentes aplica con los '
  'permisos del usuario que consulta. getIncidentes lee de aca por default.';
