// T-152 · Unit del lint heurístico de DML peligroso en migraciones.
// Casos disparan / no-disparan + el pragma de allow. Los inputs van inline como
// template literals (untagged → prettier no reformatea su contenido; sin riesgo del
// hazard de fixtures .md). Importa el módulo .mjs que usa el wrapper de CI.
import { describe, expect, it } from 'vitest';

import { extractPragmas, findViolations, preprocess } from '../../../scripts/lib/dml-lint.mjs';

const rules = (sql: string) =>
  findViolations(sql)
    .map((v) => v.rule)
    .sort();

describe('findViolations · DISPARA (DML peligroso migration-time)', () => {
  it('UPDATE sin WHERE top-level', () => {
    expect(rules(`update public.consultoras set name = name;`)).toEqual(['update-without-where']);
  });

  it('DELETE sin WHERE top-level', () => {
    expect(rules(`delete from public.audit_log;`)).toEqual(['delete-without-where']);
  });

  it('TRUNCATE (bare)', () => {
    expect(rules(`truncate table public.x;`)).toEqual(['truncate']);
  });

  it('TRUNCATE ... CASCADE', () => {
    expect(rules(`truncate public.x cascade;`)).toEqual(['truncate']);
  });

  it('UPDATE sin WHERE DENTRO de un DO block (corre al aplicar la migración)', () => {
    const sql = `do $$ begin update public.x set a = 1; end $$;`;
    expect(rules(sql)).toEqual(['update-without-where']);
  });

  it('DELETE sin WHERE dentro de un DO block', () => {
    expect(rules(`do $$ begin delete from public.x; end $$;`)).toEqual(['delete-without-where']);
  });

  it('UPDATE con alias sin WHERE', () => {
    expect(rules(`update public.consultoras c set plan = 'pro';`)).toEqual([
      'update-without-where',
    ]);
  });

  it('reporta la línea correcta', () => {
    const sql = `-- header\n\nupdate public.x set a = 1;`;
    expect(findViolations(sql)[0].line).toBe(3);
  });
});

describe('findViolations · NO dispara (falsos positivos evitados)', () => {
  it('UPDATE con WHERE', () => {
    expect(
      rules(
        `update public.consultoras set plan = 'pro' where id = '00000000-0000-0000-0000-000000000000';`,
      ),
    ).toEqual([]);
  });

  it('UPDATE con WHERE solo en subquery (FN aceptable, lo tratamos como seguro)', () => {
    const sql = `update public.x set a = 1 where id in (select id from public.y where z = 1);`;
    expect(rules(sql)).toEqual([]);
  });

  it('DELETE con WHERE', () => {
    expect(rules(`delete from public.x where id = '1';`)).toEqual([]);
  });

  it('upsert: ON CONFLICT ... DO UPDATE SET (no es full-table)', () => {
    const sql = `insert into x (a) values (1) on conflict (a) do update set a = excluded.a;`;
    expect(rules(sql)).toEqual([]);
  });

  it('DML dentro de un CREATE FUNCTION (runtime, no migration-time)', () => {
    const sql = `create or replace function f() returns void language plpgsql as $$
      begin
        delete from public.x;
        update public.y set a = 1;
      end $$;`;
    expect(rules(sql)).toEqual([]);
  });

  it('DML dentro de CREATE PROCEDURE', () => {
    const sql = `create procedure p() language plpgsql as $$ begin truncate public.x; end $$;`;
    expect(rules(sql)).toEqual([]);
  });

  it('`after update of` en CREATE TRIGGER', () => {
    expect(
      rules(
        `create trigger t after update of status on public.x for each row execute function f();`,
      ),
    ).toEqual([]);
  });

  it('`for update` (row locking)', () => {
    expect(rules(`select * from public.x for update;`)).toEqual([]);
  });

  it('`on update cascade` en FK', () => {
    expect(
      rules(`alter table x add constraint fk foreign key (y) references z(id) on update cascade;`),
    ).toEqual([]);
  });

  it('columna updated_at / set_updated_at no confunden', () => {
    expect(rules(`alter table x add column updated_at timestamptz;`)).toEqual([]);
  });

  it('palabra UPDATE/DELETE dentro de un comment $c$...$c$', () => {
    const sql = `comment on table x is $c$ Triggers rechazan UPDATE y DELETE; INSERT-only. $c$;`;
    expect(rules(sql)).toEqual([]);
  });

  it('DML dentro de un comando $cron$...$cron$ de cron.schedule (runtime)', () => {
    const sql = `select cron.schedule('j', '0 3 * * *', $cron$ delete from public.x $cron$);`;
    expect(rules(sql)).toEqual([]);
  });

  it('UPDATE/DELETE mencionados en un comentario -- ...', () => {
    expect(rules(`-- update public.x set a = 1 sin where seria peligroso\nselect 1;`)).toEqual([]);
  });

  it('INSERT masivo NO se flaggea (additivo, fuera de alcance)', () => {
    expect(rules(`insert into x select * from y;`)).toEqual([]);
  });
});

describe('pragma -- lint:dml-allow', () => {
  it('silencia la regla correcta (línea encima)', () => {
    const sql = `-- lint:dml-allow update-without-where — backfill one-shot seguro\nupdate public.x set a = 1;`;
    expect(rules(sql)).toEqual([]);
  });

  it('silencia con el pragma en la misma sentencia', () => {
    const sql = `update public.x\n  -- lint:dml-allow update-without-where — motivo\n  set a = 1;`;
    expect(rules(sql)).toEqual([]);
  });

  it('un pragma de OTRA regla NO silencia (por-regla, no global)', () => {
    const sql = `-- lint:dml-allow truncate — regla equivocada\nupdate public.x set a = 1;`;
    expect(rules(sql)).toEqual(['update-without-where']);
  });

  it('extractPragmas parsea regla y línea', () => {
    const sql = `line1\n-- lint:dml-allow delete-without-where — x\ndelete from y;`;
    expect(extractPragmas(sql)).toEqual([{ line: 2, rule: 'delete-without-where' }]);
  });
});

describe('preprocess · invariantes', () => {
  it('preserva largo y posiciones de línea', () => {
    const sql = `/* c */\n-- l\ndo $$ begin update x set a=1 where b=2; end $$;\ncomment on table x is $c$ hi $c$;`;
    const out = preprocess(sql);
    expect(out.length).toBe(sql.length);
    expect(out.split('\n').length).toBe(sql.split('\n').length);
  });

  it('mantiene el cuerpo de los DO blocks (no lo blanquea)', () => {
    const out = preprocess(`do $$ begin update x set a=1; end $$;`);
    expect(out).toContain('update x set a=1');
  });

  it('blanquea el cuerpo de CREATE FUNCTION', () => {
    const out = preprocess(`create function f() as $$ delete from x; $$ language sql;`);
    expect(out).not.toContain('delete from x');
  });
});
