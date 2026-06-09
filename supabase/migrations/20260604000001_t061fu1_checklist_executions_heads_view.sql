-- T-061-FU1 · "Ver anuladas" en el listado de inspecciones (checklists).
--
-- Problema: getEjecucionesForConsultora lee de `checklist_executions_vigentes`,
-- que excluye las anuladas (head de cadena con anulacion=true / superseded por un
-- tombstone). Hoy una inspección anulada queda en DB pero NO hay forma de verla
-- desde la UI.
--
-- Solución: una segunda vista `checklist_executions_heads` = head de cada cadena
-- de correcciones SIN el filtro de anulación (vigentes + tombstones anulados;
-- excluye versiones superseded, que viven en el detalle). El toggle "Ver anuladas"
-- cambia la fuente de getEjecucionesForConsultora entre las dos vistas. Calca
-- EXACTO el patrón de incidentes_heads (T-063-FU2).
--
-- Append-only intacto: esto es SOLO lectura (vistas security_invoker). No toca
-- policies ni la tabla. PostgREST no expresa el anti-join NOT EXISTS, por eso es
-- una vista (mismo patrón que checklist_executions_vigentes, T-057).
--
-- Drift: `checklist_executions_vigentes` se REDEFINE sobre
-- `checklist_executions_heads` para single-source la lógica de head-of-chain
-- (antes duplicaba el NOT EXISTS).

-- =============================================================================
-- A. VISTA checklist_executions_heads (head de cada cadena, anuladas incluidas)
-- =============================================================================

-- security_invoker=true: corre con permisos del usuario que consulta -> la RLS de
-- checklist_executions aplica (multi-tenant correcto). Mismo patrón y semántica
-- que checklist_executions_vigentes, pero SIN el `anulacion = false`.
create view public.checklist_executions_heads
  with (security_invoker = true)
as
  select e.*
  from public.checklist_executions e
  where not exists (
    select 1 from public.checklist_executions s where s.corrige_id = e.id
  );

comment on view public.checklist_executions_heads is
  'T-061-FU1: head de cada cadena de correcciones (nadie la supersede vía '
  'corrige_id), INCLUIDAS las anuladas (anulacion=true). Vigentes + tombstones; '
  'excluye versiones superseded. security_invoker=true -> la RLS de '
  'checklist_executions aplica. getEjecucionesForConsultora lee de acá cuando el '
  'toggle "Ver anuladas" está on.';

grant select on public.checklist_executions_heads to authenticated, service_role;

-- =============================================================================
-- B. REDEFINIR checklist_executions_vigentes sobre _heads (single-source)
-- =============================================================================

-- Vigentes = heads no anuladas. Columnas/tipos idénticos -> create or replace
-- válido. La semántica observable no cambia (head no-anulada y no-superseded).
create or replace view public.checklist_executions_vigentes
  with (security_invoker = true)
as
  select h.*
  from public.checklist_executions_heads h
  where h.anulacion = false;

comment on view public.checklist_executions_vigentes is
  'T-057 (redefinida en T-061-FU1): ejecuciones vigentes = checklist_executions_heads '
  'no anuladas. security_invoker=true -> la RLS de checklist_executions aplica con '
  'los permisos del usuario que consulta. getEjecucionesForConsultora lee de acá por '
  'default. Réplica del patrón de incidentes_vigentes (T-062).';
