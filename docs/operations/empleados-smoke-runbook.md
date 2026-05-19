# Módulo Empleados · Smoke productivo runbook

Validación manual end-to-end del módulo Empleados (T-052..T-054) en el VPS productivo `https://consultora-demo.test-ia.cloud`.

**Cuándo correr**:
- Post-merge T-054 (responsabilidad de Lautaro como validación final del módulo UI).
- Post-deploy mayor que toque el módulo Empleados o la integración Empleados ↔ Clientes.
- Smoke de regresión después de cambios en migration / RLS / audit triggers de `empleados`.
- Si Lautaro observa síntomas raros en producción (DNI desincronizado, search empty, archive no funciona, edge case DUPLICATE_DNI en unarchive).

**Tiempo total estimado**: **~20-25 min** ejecutando los 8 pasos secuencialmente.

**Prerequisitos globales**:
- Acceso productivo a `consultora-demo.test-ia.cloud` con cuenta owner.
- Acceso productivo a Supabase Studio (project `consultora-demo`).
- Al menos 1 cliente activo en la consultora de prueba (los empleados se cargan dentro de un cliente).

---

## Índice

1. [Setup pre-smoke](#1-setup-pre-smoke)
2. [Landing `/empleados`](#2-landing-empleados)
3. [Crear empleado](#3-crear-empleado)
4. [Detail view](#4-detail-view)
5. [Editar empleado](#5-editar-empleado)
6. [Archive/unarchive flow](#6-archiveunarchive-flow)
7. [Search inline](#7-search-inline)
8. [Toggle "Ver archivados"](#8-toggle-ver-archivados)

Plus: [Cleanup post-smoke](#cleanup-post-smoke)

---

## 1. Setup pre-smoke

**Verificar que el deploy está sano antes de empezar**.

### 1.1 Deploy verde en EasyPanel

EasyPanel UI → service `consultora-demo` → último deploy `running` verde post-merge de T-054. Sin errores en los últimos logs.

### 1.2 Migration del módulo aplicada en remote

Studio → SQL Editor:

```sql
select version
  from supabase_migrations.schema_migrations
 where version = '20260519114309'
 order by version;
```

Esperado: **1 row** — `20260519114309` (T-052 empleados).

### 1.3 Schema sanity

```sql
-- T-052: tabla empleados con 17 columnas + UNIQUE partial + audit trigger.
select count(*) as empleados_columns
  from information_schema.columns
 where table_schema = 'public' and table_name = 'empleados';
-- Esperado: 17.

select indexname
  from pg_indexes
 where schemaname = 'public' and tablename = 'empleados'
 order by indexname;
-- Esperado al menos: idx_empleados_consultora_cliente_dni (UNIQUE partial),
-- idx_empleados_cliente, idx_empleados_consultora_apellido.

-- CHECK constraint sobre DNI ^\d{7,8}$.
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.empleados'::regclass
   and contype = 'c'
 order by conname;
-- Esperado: chk_empleados_dni_format con regex '^\d{7,8}$'.
```

### Criterios de éxito

- ✅ Deploy verde en EasyPanel.
- ✅ Migration `20260519114309` aplicada.
- ✅ Tabla `empleados` con 17 columnas + indexes esperados.
- ✅ CHECK `chk_empleados_dni_format` presente.

Si algo falla, **STOP**. Revisar logs del deploy + estado del remote en Studio antes de continuar.

---

## 2. Landing `/empleados`

**Validar el landing condicional (sin cliente_id → índice de clientes)**.

### 2.1 Sin clientes en la consultora

1. Login con cuenta owner **sin clientes existentes** (si no tenés una, saltar a §2.2).
2. Sidebar → `Empleados` (item `live` desde T-054, icon `UserCheck`).
3. URL pasa a `/empleados`.
4. Verificar:
   - Header `Empleados` + descripción `Elegí un cliente para ver y administrar sus empleados`.
   - Card empty state con texto `Necesitás un cliente antes de cargar empleados`.
   - CTA `Crear primer cliente` (link a `/clientes/nuevo`).

### 2.2 Con clientes existentes

1. Login con cuenta owner que tiene clientes activos.
2. Sidebar → `Empleados`.
3. URL pasa a `/empleados`.
4. Verificar:
   - Lista de cards con razón social + CUIT + nombre fantasía (placeholders `—` si no aplica).
   - Cada card linkea a `/empleados?cliente_id=<uuid>` (hover → `Ver empleados →`).

### Criterios de éxito

- ✅ Sin clientes → empty state con CTA a crear cliente.
- ✅ Con clientes → índice clickable de cards.

---

## 3. Crear empleado

**Validar el form completo + DNI normalize + cliente_id fijado por query param**.

### 3.1 Navegar al form

1. Desde `/empleados` con clientes existentes, click una card cliente.
2. URL pasa a `/empleados?cliente_id=<uuid>`.
3. Empty state inicial (si no hay empleados) con CTA `Crear primer empleado` + toggle `Ver archivados` visible (T-049-FU2 cerrado en T-054).
4. Click `Crear primer empleado` → URL `/empleados/nuevo?cliente_id=<uuid>`.
5. Verificar header del form:
   - `← Volver a Empleados de <razon_social>`.
   - Título `Nuevo empleado`.
   - Box destacado `Cliente: <razón_social>` (el cliente está fijado, no se puede cambiar).

### 3.2 Llenar form

Form con 3 secciones: **Identificación**, **Contacto**, **Laboral**. Completar:

| Sección | Field | Valor |
|---------|-------|-------|
| Identificación | Nombre * | `Juan` |
| Identificación | Apellido * | `Smoke` |
| Identificación | DNI * | `30.111.222` (con puntos — se normaliza pre-INSERT) |
| Identificación | CUIL | `20301112229` (sin guiones — el onBlur autoformat lo canonicaliza) |
| Contacto | Email | `juan.smoke@test.local` |
| Contacto | Teléfono | `+54 11 5555-6666` |
| Laboral | Puesto | `Operario Smoke Test` |
| Laboral | Fecha de ingreso | `2026-01-15` (input date nativo) |
| Laboral | Fecha de nacimiento | `1990-05-20` |
| Laboral | Notas internas | `Smoke test T-054 — borrar post-validación.` |

### 3.3 CUIL autoformat onBlur

1. Tipear `20301112229` (11 dígitos sin guiones) en el field CUIL.
2. Click fuera del field (Tab o click en otro field).
3. Verificar: el field auto-canonicaliza a `20-30111222-9`.

### 3.4 Submit

1. Click `Crear empleado`.
2. Redirect a `/empleados/<uuid>` (detail view).
3. Header muestra `Smoke, Juan` + subheader `DNI 30.111.222 · Creado el <fecha>`.

### 3.5 Sanity check DB

```sql
select
  id, nombre, apellido, dni, cuil, email, telefono, puesto,
  fecha_ingreso, fecha_nacimiento, cliente_id, consultora_id, created_by
  from public.empleados
 where apellido = 'Smoke'
 order by created_at desc
 limit 1;
```

Esperado: 1 row con:
- `dni = '30111222'` (digits-only, NO con puntos).
- `cuil = '20-30111222-9'` (canonicalizado).
- `cliente_id` = UUID del cliente fijado en el query param.
- `consultora_id` = tu consultora.
- `created_by` = tu user_id.
- `fecha_ingreso = '2026-01-15'` + `fecha_nacimiento = '1990-05-20'`.

### 3.6 Audit log row

```sql
select action, entity_type, after_data
  from public.audit_log
 where entity_type = 'empleados' and entity_id = (
   select id from public.empleados
    where apellido = 'Smoke'
    order by created_at desc limit 1
 )
 order by created_at desc;
```

Esperado: 1 row con `action='created'` + `after_data` jsonb con los fields del payload INSERT.

### Criterios de éxito

- ✅ Form de 10 fields con 3 secciones renderizadas + box "Cliente: ..." visible.
- ✅ DNI normaliza a digits-only pre-INSERT.
- ✅ CUIL autoformat onBlur.
- ✅ Submit redirige a detail con datos visibles.
- ✅ DB row creado con `cliente_id` correcto + `dni` normalizado.
- ✅ Audit log INSERT row capturado.

---

## 4. Detail view

**Validar render condicional de las Cards según fields populated**.

### 4.1 Estructura del detail

Desde el empleado recién creado en §3, en `/empleados/<id>`:

1. Header: `Apellido, Nombre` + Badge `Archivado` solo si aplica (no debería aparecer ahora).
2. Subheader: `DNI 30.111.222 · Creado el <fecha>`.
3. Breadcrumb: `← Volver a Empleados de <razon_social>`.
4. Botones top-right: `Editar` + `Archivar`.
5. **Cards renderizadas condicionalmente**:
   - **Identificación** — SIEMPRE renderiza (nombre + apellido + DNI son required). Muestra Apellido, Nombre, DNI formateado, CUIL si existe.
   - **Contacto** — renderiza si hay al menos uno de: email, telefono.
   - **Laboral** — renderiza si hay al menos uno de: puesto, fecha_ingreso, fecha_nacimiento.
   - **Notas internas** — renderiza si `notas` no es null + preserva saltos de línea con `whitespace-pre-wrap`.

### 4.2 Verificar Cards visibles

Con el empleado del §3 (10 fields completados), TODAS las cards deben aparecer:
- ✅ Identificación: Apellido, Nombre, DNI (formato `XX.XXX.XXX`), CUIL.
- ✅ Contacto: Email, Teléfono.
- ✅ Laboral: Puesto, Fecha de ingreso (formato es-AR), Fecha de nacimiento.
- ✅ Notas internas: el texto con saltos preservados.

### Criterios de éxito

- ✅ Cards condicionales todas visibles para empleado con 10 fields.
- ✅ DNI mostrado como `30.111.222` (formateado).
- ✅ Fechas formateadas en es-AR (`15 de ene de 2026`).

---

## 5. Editar empleado

**Validar el form de edit + diff calculation + "sin cambios para guardar"**.

### 5.1 Navegar al form de edit

1. Desde `/empleados/<id>`, click `Editar`.
2. URL pasa a `/empleados/<id>/editar`.
3. Header `Editar empleado` + descripción con apellido/nombre.
4. Form pre-populado con los valores del empleado.

### 5.2 Editar 1 field y guardar

1. Cambiar `Puesto`: `Operario Smoke Test` → `Operario EDITADO`.
2. Click `Guardar cambios`.
3. Redirect a `/empleados/<id>` (detail).
4. Card Laboral muestra el nuevo puesto.

### 5.3 "Sin cambios para guardar"

1. Volver a `/empleados/<id>/editar`.
2. NO modificar ningún field.
3. Click `Guardar cambios`.
4. Verificar: toast info `Sin cambios para guardar`.

### 5.4 Audit log UPDATE row

```sql
select action, before_data, after_data
  from public.audit_log
 where entity_type = 'empleados' and action = 'updated'
   and entity_id = (
     select id from public.empleados
      where apellido = 'Smoke'
      order by created_at desc limit 1
   )
 order by created_at desc limit 1;
```

Esperado: 1 row con `before_data.puesto = 'Operario Smoke Test'` + `after_data.puesto = 'Operario EDITADO'`.

### Criterios de éxito

- ✅ Form pre-popula correctamente.
- ✅ Submit con cambio redirige y persiste.
- ✅ Toast "Sin cambios para guardar" si no se modificó nada.
- ✅ Audit UPDATE row capturado con diff before/after.

---

## 6. Archive/unarchive flow

**Validar AlertDialog confirm + edge case DUPLICATE_DNI en unarchive**.

### 6.1 Archive happy path

1. Desde `/empleados/<id>`, click `Archivar`.
2. AlertDialog: `¿Archivar a <Apellido, Nombre>?` + descripción.
3. Click `Archivar` dentro del dialog.
4. Toast `Empleado archivado`.
5. Badge `Archivado` aparece en el header.
6. Botón cambia a `Desarchivar`.

### 6.2 DB sanity post-archive

```sql
select archived_at
  from public.empleados
 where apellido = 'Smoke'
 order by created_at desc limit 1;
```

Esperado: `archived_at` != null (timestamp del archive).

### 6.3 Unarchive happy path

1. Click `Desarchivar`.
2. AlertDialog confirm.
3. Toast `Empleado desarchivado`.
4. Badge `Archivado` desaparece.

### 6.4 Edge case DUPLICATE_DNI en unarchive

Este flow valida el edge case real: empleado A archivado, otro user (o el mismo) creó empleado B con mismo DNI activo en el mismo cliente, ahora unarchive de A debe fallar.

1. Crear empleado A con DNI `28.999.888` en el cliente del §3 (form normal).
2. Archivar empleado A (§6.1).
3. Crear empleado B con DNI `28.999.888` en el MISMO cliente — debe permitir porque A está archivado (UNIQUE partial WHERE archived_at IS NULL).
4. Ir al detail de empleado A (`/empleados/<id-A>`), click `Desarchivar`.
5. Verificar: toast error `No podés desarchivar` con descripción del action — mensaje completo:
   > `No podés desarchivar este empleado: ya existe otro empleado activo con el mismo DNI en este cliente. Archivá el otro primero.`
6. Empleado A sigue archivado en DB.

### Criterios de éxito

- ✅ AlertDialog confirm aparece + dialog content correcto.
- ✅ Archive/unarchive persiste en DB.
- ✅ DUPLICATE_DNI en unarchive muestra el mensaje completo del action sin redirect.

---

## 7. Search inline

**Validar filter cliente-side por apellido OR nombre OR DNI digits-only**.

### 7.1 Setup

Con al menos 3 empleados activos en el mismo cliente, con apellidos/DNIs diversos para que el filter sea visible.

### 7.2 Search por apellido

1. Desde `/empleados?cliente_id=<uuid>`, tipear apellido parcial en el search box.
2. Debounce 300ms → URL pasa a incluir `&q=<text>`.
3. Lista filtrada en cliente-side: solo cards con apellido matcheando.

### 7.3 Search por nombre

1. Limpiar search, tipear nombre parcial.
2. Solo cards con nombre matcheando aparecen.

### 7.4 Search por DNI digits-only

1. Limpiar search, tipear 5 dígitos del DNI (sin puntos): `30111`.
2. Lista filtrada: el empleado del §3 (DNI 30111222) aparece.
3. Tipear con puntos: `30.111`.
4. Lista igual filtrada (DNI normalize ambos lados).

### Criterios de éxito

- ✅ Search filtra por los 3 campos (apellido / nombre / DNI digits-only).
- ✅ Debounce 300ms — URL actualiza tras pausa.
- ✅ DNI normalize: tipear con/sin puntos da el mismo resultado.

---

## 8. Toggle "Ver archivados"

**Validar que el switch alterna la query y persiste el state en URL**.

### 8.1 Toggle ON

1. Desde `/empleados?cliente_id=<uuid>`, click switch `Ver archivados`.
2. URL pasa a `&archived=1` (preserva cliente_id + q si había).
3. Lista incluye empleados archivados (Badge `Archivado` visible en cards).

### 8.2 Toggle OFF

1. Click switch otra vez.
2. URL pierde `&archived=1`.
3. Lista filtra solo activos.

### 8.3 Toggle desde empty state

1. Login con cuenta cliente sin empleados activos.
2. `/empleados?cliente_id=<uuid>` → empty state visible.
3. Verificar: switch `Ver archivados` aparece arriba del empty state (cierra T-049-FU2).
4. Si hay empleados archivados → toggle ON los muestra.

### Criterios de éxito

- ✅ Switch alterna URL state + lista visible.
- ✅ Cliente_id + q preservados en URL al toggle.
- ✅ Toggle visible desde empty state (FU2 cerrado).

---

## Cleanup post-smoke

```sql
-- Borrar empleados de smoke test (por apellido fixture).
delete from public.empleados
 where apellido in ('Smoke', 'SmokeArchive2');

-- Si dejaste audit_log rows huérfanos (FK ON DELETE CASCADE los borra, pero
-- verificar por las dudas):
select count(*) from public.audit_log
 where entity_type = 'empleados'
   and entity_id not in (select id from public.empleados);
-- Esperado: 0.
```

**Si no podés borrar empleados por FK (planillas EPP / capacitaciones futuras los usan)**: archivarlos en su lugar (botón `Archivar` desde detail view).

---

## Lessons forward (post-smoke)

Si encontrás:
- Drift entre comportamiento UI y action codes → registrar lesson en [docs/lessons-learned.md](../lessons-learned.md).
- Edge case no cubierto → crear ticket follow-up `T-054-FU<n>` en [docs/sprints/sprint-4.md](../sprints/sprint-4.md).
- Bug en migration / RLS / audit → STOP smoke + abrir issue urgente.
