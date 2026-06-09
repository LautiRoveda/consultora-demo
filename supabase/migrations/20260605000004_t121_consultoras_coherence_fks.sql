-- =============================================================================
-- T-121 (A) · Coherencia de consultora_id denormalizado vía FK COMPUESTAS (Ring A).
-- =============================================================================
-- PORQUE: ~12 tablas hijas copian consultora_id para el fast-path de RLS
-- (is_member_of_consultora(consultora_id) sin join al parent). Hoy TODAS las
-- RPCs/server actions lo copian bien (censo de write-paths: coherence_risk
-- none/low — el consultora_id sale de getCurrentConsultora()/JWT o del row parent),
-- pero NADA lo impone a nivel DB. Un INSERT mal hecho o una RPC futura con bug
-- podría plantar un hijo con consultora_id de OTRO tenant -> la RLS del hijo (que
-- confía en su consultora_id denormalizado) daría un veredicto basado en el tenant
-- equivocado -> fuga cross-tenant.
--
-- FIX (declarativo, sin trigger): por cada relación de OWNERSHIP NOT-NULL donde
-- hijo Y parent tienen consultora_id NOT NULL (Ring A):
--   (1) en el PARENT: unique (id, consultora_id) — id ya es PK, redundante para
--       unicidad pero REQUERIDO como destino del FK compuesto (Postgres exige una
--       UNIQUE CONSTRAINT, no un índice suelto).
--   (2) en el HIJO: reemplazar el FK simple (<fk> -> parent.id) por un FK COMPUESTO
--       ((<fk>, consultora_id) -> parent(id, consultora_id)) preservando el ON DELETE.
-- Postgres garantiza estructuralmente hijo.consultora_id = parent.consultora_id.
--
-- ALCANCE (owner): RING A CORE ONLY — solo FK de ownership NOT-NULL con ambos lados
-- consultora_id NOT NULL (cero gaps de MATCH SIMPLE, no toca el árbol de templates).
-- 17 FK compuestas + 9 uniques. Ring B (nullable / set null / self-ref) y Ring C
-- (template tree / system rows con consultora_id NULL) quedan DORMIDOS (T-121-FU,
-- censo en docs/plan). Razón: máximo valor estructural, mínimo blast radius.
--
-- DROP DINÁMICO (owner): NO hardcodear los nombres default <tabla>_<col>_fkey.
-- Resolvemos el conname real desde pg_constraint por (conrelid, confrelid, columna
-- referenciante) y dropeamos vía execute format. Si no se encuentra -> ABORTA (NO
-- if-exists silencioso), así nunca queda un FK simple viejo conviviendo con el
-- compuesto. Mismo enfoque dinámico que T-124 con el CHECK.
--
-- PRE-CONTEO (guard fail-fast): al tope, un do-block cuenta mismatches por relación
-- y raise exception si alguno > 0 — aborta transaccionalmente con mensaje legible en
-- vez de dejar fallar el add constraint a mitad. Esperado 0 (censo de write-paths).
--
-- LOCKS: add constraint unique construye índice bajo ACCESS EXCLUSIVE en el parent;
-- add constraint foreign key valida filas existentes bajo SHARE ROW EXCLUSIVE.
-- Sub-segundo con el dataset actual; si crece, evaluar not valid + validate constraint.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. GUARD PRE-CONTEO: 0 mismatches en las 17 relaciones Ring A (sino aborta).
-- -----------------------------------------------------------------------------
do $$
declare
  r       record;
  v_count bigint;
  v_total bigint := 0;
begin
  for r in
    select * from (values
      ('informe_attachments',      'informe_id',             'informes'),
      ('calendar_event_reminders', 'event_id',               'calendar_events'),
      ('empleados',                'cliente_id',             'clientes'),
      ('epp_items',                'categoria_id',           'epp_categorias'),
      ('empleados_puestos',        'empleado_id',            'empleados'),
      ('empleados_puestos',        'puesto_id',              'puestos'),
      ('epp_entregas',             'empleado_id',            'empleados'),
      ('epp_entregas',             'cliente_id',             'clientes'),
      ('epp_entrega_items',        'entrega_id',             'epp_entregas'),
      ('epp_entrega_items',        'item_id',                'epp_items'),
      ('epp_planificaciones',      'empleado_id',            'empleados'),
      ('epp_planificaciones',      'item_id',                'epp_items'),
      ('epp_planificaciones',      'generado_de_entrega_id', 'epp_entregas'),
      ('execution_respuestas',     'execution_id',           'checklist_executions'),
      ('execution_adjuntos',       'execution_id',           'checklist_executions'),
      ('execution_firmas',         'execution_id',           'checklist_executions'),
      ('acciones_correctivas',     'execution_id',           'checklist_executions')
    ) as t(hijo, fk_col, parent)
  loop
    execute format(
      'select count(*) from public.%I c join public.%I p on p.id = c.%I '
      'where c.consultora_id is distinct from p.consultora_id',
      r.hijo, r.parent, r.fk_col
    ) into v_count;

    if v_count > 0 then
      raise warning 'T-121 mismatch: %.% -> % tiene % filas cross-tenant', r.hijo, r.fk_col, r.parent, v_count;
      v_total := v_total + v_count;
    end if;
  end loop;

  if v_total > 0 then
    raise exception 'T-121: % filas con consultora_id != parent. Abortando antes de crear FK compuestas (arreglar la data primero).', v_total;
  end if;

  raise notice 'T-121 pre-conteo: 0 mismatches en las 17 relaciones Ring A. OK para crear FK compuestas.';
end $$;

-- -----------------------------------------------------------------------------
-- 1. UNIQUE (id, consultora_id) en los 9 parents (destino del FK compuesto).
--    Todos con consultora_id NOT NULL -> unique limpio. id ya es PK (redundante
--    para unicidad, requerido para referenciar desde el FK compuesto).
-- -----------------------------------------------------------------------------
alter table public.clientes             add constraint clientes_id_consultora_id_key             unique (id, consultora_id);
alter table public.informes             add constraint informes_id_consultora_id_key             unique (id, consultora_id);
alter table public.calendar_events      add constraint calendar_events_id_consultora_id_key      unique (id, consultora_id);
alter table public.empleados            add constraint empleados_id_consultora_id_key            unique (id, consultora_id);
alter table public.puestos              add constraint puestos_id_consultora_id_key              unique (id, consultora_id);
alter table public.epp_categorias       add constraint epp_categorias_id_consultora_id_key       unique (id, consultora_id);
alter table public.epp_items            add constraint epp_items_id_consultora_id_key            unique (id, consultora_id);
alter table public.epp_entregas         add constraint epp_entregas_id_consultora_id_key         unique (id, consultora_id);
alter table public.checklist_executions add constraint checklist_executions_id_consultora_id_key unique (id, consultora_id);

-- -----------------------------------------------------------------------------
-- 2. Reemplazo de FK simple -> FK compuesto (drop dinámico + add), 17 relaciones.
--    Resuelve el conname real del FK simple actual desde pg_constraint (single-col,
--    conrelid=hijo, confrelid=parent, conkey=[fk_col]); si no lo encuentra ABORTA.
--    Preserva el ON DELETE original de cada FK.
-- -----------------------------------------------------------------------------
do $$
declare
  r             record;
  v_conname     text;
  v_new_conname text;
begin
  for r in
    select * from (values
      ('informe_attachments',      'informe_id',             'informes',             'cascade'),
      ('calendar_event_reminders', 'event_id',               'calendar_events',      'cascade'),
      ('empleados',                'cliente_id',             'clientes',             'restrict'),
      ('epp_items',                'categoria_id',           'epp_categorias',       'restrict'),
      ('empleados_puestos',        'empleado_id',            'empleados',            'cascade'),
      ('empleados_puestos',        'puesto_id',              'puestos',              'cascade'),
      ('epp_entregas',             'empleado_id',            'empleados',            'restrict'),
      ('epp_entregas',             'cliente_id',             'clientes',             'restrict'),
      ('epp_entrega_items',        'entrega_id',             'epp_entregas',         'cascade'),
      ('epp_entrega_items',        'item_id',                'epp_items',            'restrict'),
      ('epp_planificaciones',      'empleado_id',            'empleados',            'restrict'),
      ('epp_planificaciones',      'item_id',                'epp_items',            'restrict'),
      ('epp_planificaciones',      'generado_de_entrega_id', 'epp_entregas',         'restrict'),
      ('execution_respuestas',     'execution_id',           'checklist_executions', 'cascade'),
      ('execution_adjuntos',       'execution_id',           'checklist_executions', 'cascade'),
      ('execution_firmas',         'execution_id',           'checklist_executions', 'cascade'),
      ('acciones_correctivas',     'execution_id',           'checklist_executions', 'restrict')
    ) as t(hijo, fk_col, parent, on_del)
  loop
    -- Resolver el conname del FK simple ACTUAL (single-col que referencia parent vía fk_col).
    select con.conname
      into v_conname
      from pg_constraint con
      join pg_attribute att
        on att.attrelid = con.conrelid
       and att.attnum   = con.conkey[1]
     where con.conrelid = ('public.' || r.hijo)::regclass
       and con.confrelid = ('public.' || r.parent)::regclass
       and con.contype = 'f'
       and array_length(con.conkey, 1) = 1
       and att.attname = r.fk_col;

    if v_conname is null then
      raise exception
        'T-121: no se encontró el FK simple % .% -> %. No se dropea a ciegas (evita dejar el FK viejo conviviendo con el compuesto).',
        r.hijo, r.fk_col, r.parent;
    end if;

    execute format('alter table public.%I drop constraint %I', r.hijo, v_conname);

    v_new_conname := r.hijo || '_' || r.fk_col || '_consultora_fkey';
    execute format(
      'alter table public.%I add constraint %I '
      'foreign key (%I, consultora_id) references public.%I (id, consultora_id) on delete %s',
      r.hijo, v_new_conname, r.fk_col, r.parent, r.on_del
    );

    raise notice 'T-121: %.% -> % : FK simple % reemplazado por compuesto % (on delete %).',
      r.hijo, r.fk_col, r.parent, v_conname, v_new_conname, r.on_del;
  end loop;
end $$;
