-- T-152 DEMO (TEMPORAL): prueba e2e del guard DML en CI. Se REMUEVE antes del merge.
-- UPDATE sin WHERE: aplica limpio (self-assign no-op sobre consultoras, sin trigger
-- sobre la col `name`) en los jobs con DB, pero el pass heurístico de migrations-lint
-- debe pintarlo ROJO. Timeouts presentes para que squawk pase y el ÚNICO rojo sea el
-- guard DML.
set statement_timeout = '60s';
set lock_timeout = '10s';

update public.consultoras set name = name where id is not null;
