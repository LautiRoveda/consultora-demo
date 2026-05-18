# Módulo Clientes · Smoke productivo runbook

Validación manual end-to-end del módulo Clientes (T-047..T-051) en el VPS productivo `https://consultora-demo.test-ia.cloud`.

**Cuándo correr**:
- Post-merge T-051 (responsabilidad de Lautaro como validación final del módulo).
- Post-deploy mayor que toque el módulo Clientes o la integración Clientes ↔ Informes.
- Smoke de regresión después de cambios en migration / RLS / audit triggers de `informes` o `clientes`.
- Si Lautaro observa síntomas raros en producción (cliente_id desincronizado, autocomplete vacío, archive no funciona).

**Tiempo total estimado**: **~25-35 min** ejecutando los 10 pasos secuencialmente. Si solo se valida un feature específico, ir directo a la sección correspondiente — cada sección es autocontenida con su cleanup propio.

**Prerequisitos globales**:
- Acceso productivo a `consultora-demo.test-ia.cloud` con cuenta owner.
- Acceso productivo a Supabase Studio (project `consultora-demo`).
- Para la sección 10 (cross-tenant adversarial): 2 cuentas owner de consultoras distintas. Si no tenés acceso a la segunda, skip esa sección — la cobertura action-level vive en integration test T-050.

---

## Índice

1. [Setup pre-smoke](#1-setup-pre-smoke)
2. [List view (T-049)](#2-list-view)
3. [Crear cliente (T-049)](#3-crear-cliente)
4. [Detail view (T-049)](#4-detail-view)
5. [Editar cliente (T-049)](#5-editar-cliente)
6. [Archive/unarchive flow (T-049)](#6-archiveunarchive-flow)
7. [Search inline (T-049)](#7-search-inline)
8. [Autocomplete en wizard RGRL (T-050)](#8-autocomplete-en-wizard-rgrl)
9. [Detail cliente con Informes vinculados (T-050)](#9-detail-cliente-con-informes-vinculados)
10. [Cross-tenant adversarial (T-050) — opcional](#10-cross-tenant-adversarial--opcional)

Plus: [Cleanup post-smoke](#cleanup-post-smoke)

---

## 1. Setup pre-smoke

**Verificar que el deploy está sano antes de empezar**.

### 1.1 Deploy verde en EasyPanel

EasyPanel UI → service `consultora-demo` → último deploy `running` verde post-merge de T-051. Sin errores en los últimos logs.

### 1.2 Migrations del módulo aplicadas en remote

Studio → SQL Editor:

```sql
-- Confirmar que las 2 migrations del módulo Clientes están aplicadas.
select version
  from supabase_migrations.schema_migrations
 where version in ('20260517235110', '20260518000001')
 order by version;
```

Esperado: **2 rows** — `20260517235110` (T-047 clientes) + `20260518000001` (T-050 informes_cliente_id).

### 1.3 Schema sanity

```sql
-- T-047: tabla clientes con 18 columnas + 2 indexes.
select count(*) as clientes_columns
  from information_schema.columns
 where table_schema = 'public' and table_name = 'clientes';
-- Esperado: 18.

select indexname
  from pg_indexes
 where schemaname = 'public' and tablename = 'clientes'
 order by indexname;
-- Esperado al menos: idx_clientes_consultora_cuit, idx_clientes_consultora_razon_social.

-- T-050: informes tiene cliente_id como FK opcional ON DELETE SET NULL.
select column_name, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'informes' and column_name = 'cliente_id';
-- Esperado: 1 row, is_nullable='YES'.
```

### Criterios de éxito

- ✅ Deploy verde en EasyPanel.
- ✅ Las 2 migrations del módulo aplicadas en remote.
- ✅ Tabla `clientes` con 18 columnas + 2 indexes esperados.
- ✅ `informes.cliente_id` existe + nullable.

Si algo falla, **STOP**. Revisar logs del deploy + estado del remote en Studio antes de continuar.

---

## 2. List view

**Validar el empty state, CTA inicial y header del módulo**.

### 2.1 Empty state

1. Login en `consultora-demo.test-ia.cloud` con cuenta owner de una consultora **sin clientes existentes**. Si no tenés una nueva, creá una de prueba o saltea a §3 directo.
2. Sidebar → `Clientes` (el item está `live` desde T-049 con icon `Users`).
3. URL pasa a `/clientes`.
4. Verificar:
   - Header `Clientes` + descripción `Gestioná tus clientes y vinculá informes a cada uno`.
   - Texto `Todavía no tenés clientes` visible.
   - Botón `Crear primer cliente` (link a `/clientes/nuevo`).
   - NO se renderiza el toggle `Ver archivados` ni el search box (consultora vacía, no aplican).

### Criterios de éxito

- ✅ Empty state visible con CTA correcto.
- ✅ Sin search/toggle (no aplica en lista vacía).

---

## 3. Crear cliente

**Validar el form completo de 12 fields + CUIT autoformat + provincia Select**.

### 3.1 Navegar al form

1. Desde `/clientes` (empty o no), click `Crear primer cliente` o `Nuevo cliente`.
2. URL pasa a `/clientes/nuevo`.
3. Verificar header `Nuevo cliente` + descripción.
4. Form con 4 secciones visibles: **Identificación**, **Ubicación**, **Contacto**, **Detalles**.

### 3.2 Llenar form

Completar (todos los fields excepto `razon_social` y `cuit` son opcionales):

| Sección | Field | Valor |
|---------|-------|-------|
| Identificación | Razón social | `Smoke Productivo SRL` |
| Identificación | CUIT | `30911223344` (sin guiones — se autoformatea) |
| Identificación | Nombre fantasía | `Smoke Galpón` |
| Ubicación | Domicilio | `Av. Test 100` |
| Ubicación | Localidad | `La Plata` |
| Ubicación | Provincia | `Buenos Aires` (Select dropdown PROVINCIAS_AR) |
| Contacto | Nombre | `QA Manual` |
| Contacto | Email | `qa@smoke.test` |
| Contacto | Teléfono | `+54 11 1234-5678` |
| Detalles | Industria | `Industria` |
| Detalles | ART | `Provincia ART` |
| Detalles | Notas | `Smoke test T-051 — borrar post-validación.` |

### 3.3 CUIT autoformat onBlur

1. Tipear `30911223344` (11 dígitos sin guiones) en el field CUIT.
2. Hacer click fuera del field (Tab o click en otro field).
3. Verificar: el field auto-canonicaliza a `30-91122334-4` (formato `XX-XXXXXXXX-X`).

### 3.4 Submit

1. Click `Crear cliente`.
2. Redirect a `/clientes/<uuid>` (detail view).
3. Header muestra `Smoke Productivo SRL` + CUIT `30-91122334-4`.

### 3.5 Sanity check DB

```sql
select
  id, razon_social, cuit, nombre_fantasia, provincia, contacto_nombre,
  archived_at, created_by, created_at
  from public.clientes
 where razon_social = 'Smoke Productivo SRL'
 order by created_at desc
 limit 1;
```

Esperado: 1 row con `cuit='30-91122334-4'` + `provincia='BA'` (code, no name) + `archived_at=null` + `created_by` = tu user_id.

### 3.6 Audit log row

```sql
select action, entity_type, after_data
  from public.audit_log
 where entity_type = 'clientes' and entity_id = (
   select id from public.clientes
    where razon_social = 'Smoke Productivo SRL'
    order by created_at desc limit 1
 )
 order by created_at desc;
```

Esperado: 1 row con `action='created'` + `after_data` jsonb con los 6 fields del payload INSERT (razón_social, cuit, nombre_fantasia, industria, localidad, provincia).

### Criterios de éxito

- ✅ Form de 12 fields con 4 secciones renderizadas.
- ✅ CUIT autoformat onBlur funciona (input sin guiones → canonicalizado).
- ✅ Provincia Select muestra 24 opciones PROVINCIAS_AR.
- ✅ Submit redirige a detail view con datos visibles.
- ✅ DB row creado con provincia code (`BA`).
- ✅ Audit log INSERT row capturado.

---

## 4. Detail view

**Validar render condicional de las 4 Cards según fields populated**.

### 4.1 Estructura del detail

Desde el cliente recién creado en §3, en `/clientes/<id>`:

1. Header con razón social + Badge solo si archivado (no debería aparecer ahora).
2. Subheader con CUIT + fecha de creación formato es-AR (`d de mes de yyyy`).
3. Botones top-right: `Editar` + `Archivar`.
4. **4 Cards renderizadas condicionalmente** (solo si tienen al menos un field populated):
   - **Identificación** — SIEMPRE renderiza (razón social + cuit son required).
   - **Ubicación** — renderiza si hay al menos uno de: domicilio, localidad, provincia.
   - **Contacto** — renderiza si hay al menos uno de: contacto_nombre, contacto_email, contacto_telefono.
   - **Detalles** — renderiza si hay al menos uno de: industria, art.
5. **Card "Notas" full-width** — renderiza si `notas` no es null + preserva saltos de línea con `whitespace-pre-wrap`.

### 4.2 Verificar Cards visibles

Con el cliente del §3 (12 fields completados), TODAS las cards deben aparecer:
- ✅ Identificación: razón social, cuit, nombre_fantasia.
- ✅ Ubicación: domicilio, localidad, provincia (mapping `BA` → "Buenos Aires" via helper local).
- ✅ Contacto: nombre, email, teléfono.
- ✅ Detalles: industria, ART.
- ✅ Notas: el texto con saltos preservados.

### Criterios de éxito

- ✅ Las 4 Cards + Notas card visibles.
- ✅ Provincia muestra name "Buenos Aires" no code "BA".
- ✅ Saltos de línea preservados en notas.

---

## 5. Editar cliente

**Validar el form de edit + diff calculation + "sin cambios para guardar"**.

### 5.1 Navegar al form de edit

1. Desde `/clientes/<id>`, click `Editar`.
2. URL pasa a `/clientes/<id>/editar`.
3. Header `Editar cliente` + descripción `Modificá los datos del cliente`.
4. Form pre-populado con los valores del cliente.

### 5.2 Editar 1 field y guardar

1. Cambiar `Razón social`: `Smoke Productivo SRL` → `Smoke Productivo EDITADO`.
2. Click `Guardar cambios`.
3. Redirect a `/clientes/<id>` (detail).
4. Header muestra el nuevo razón social.

### 5.3 "Sin cambios para guardar"

1. Volver a `/clientes/<id>/editar`.
2. NO modificar ningún field.
3. Click `Guardar cambios`.
4. Verificar: toast info `Sin cambios para guardar` (el diff calculation client-side detecta patch vacío y NO invoca el action).

### 5.4 Audit log UPDATE row

```sql
select action, before_data, after_data
  from public.audit_log
 where entity_type = 'clientes' and action = 'updated'
   and entity_id = (
     select id from public.clientes
      where razon_social = 'Smoke Productivo EDITADO'
      order by created_at desc limit 1
   )
 order by created_at desc limit 1;
```

Esperado: 1 row con `before_data.razon_social = 'Smoke Productivo SRL'` + `after_data.razon_social = 'Smoke Productivo EDITADO'`.

### Criterios de éxito

- ✅ Form pre-popula correctamente con valores existentes.
- ✅ Submit con cambio redirige y persiste.
- ✅ Toast "Sin cambios para guardar" si no se modificó nada.
- ✅ Audit UPDATE row capturado con diff before/after.

---

## 6. Archive/unarchive flow

**Validar el soft-delete via `archived_at` + toggle UI + idempotency**.

### 6.1 Archivar

1. Desde `/clientes/<id>` (cliente del §3 editado), click `Archivar`.
2. AlertDialog confirm: texto `¿Archivar a Smoke Productivo EDITADO?`.
3. Click `Archivar` (botón confirm).
4. Toast success `Cliente archivado`.
5. Header del detail view muestra Badge `Archivado` (variant secondary, no destructive).

### 6.2 Lista default NO muestra archivados

1. Goto `/clientes`.
2. El cliente `Smoke Productivo EDITADO` **NO aparece** en la lista.
3. Toggle `Ver archivados` visible al lado del search.

### 6.3 Toggle "Ver archivados"

1. Click toggle `Ver archivados`.
2. URL pasa a `/clientes?archived=1`.
3. El cliente aparece con Badge `Archivado`.

### 6.4 Desarchivar

1. Click sobre la card del cliente archivado → goto `/clientes/<id>`.
2. Click `Desarchivar`.
3. AlertDialog confirm: `¿Desarchivar a Smoke Productivo EDITADO? El cliente volverá a la lista activa.`
4. Click `Desarchivar` (botón confirm).
5. Toast success `Cliente desarchivado`.
6. Badge `Archivado` desaparece del header.

### 6.5 DB sanity

```sql
select archived_at
  from public.clientes
 where razon_social = 'Smoke Productivo EDITADO';
```

Esperado: `archived_at = null` post-desarchivar.

### 6.6 Idempotency

Si por accidente clickeás `Archivar` 2x rápido (UI race), la segunda call retorna toast info `Ya estaba archivado` (code `ALREADY_ARCHIVED`) en lugar de error. Mismo comportamiento para `Desarchivar` cuando ya está activo (`ALREADY_ACTIVE`).

### Criterios de éxito

- ✅ AlertDialog confirm aparece antes de archivar/desarchivar.
- ✅ Toast por code correcto.
- ✅ Badge `Archivado` aparece/desaparece según estado.
- ✅ Toggle URL state `?archived=1` persiste tras refresh.
- ✅ Idempotency: re-archivar/desarchivar no rompe.

---

## 7. Search inline

**Validar el search scope de 3 fields con CUIT digits-only normalize**.

### 7.1 Setup: insertar 2 clientes más para diversidad de matches

Studio:

```sql
insert into public.clientes
  (consultora_id, razon_social, cuit, nombre_fantasia, created_by)
values
  ((select consultora_id from public.consultora_members where user_id = auth.uid() limit 1),
   'Smoke Other A', '30-22222222-2', 'Galpón Norte', auth.uid()),
  ((select consultora_id from public.consultora_members where user_id = auth.uid() limit 1),
   'Smoke Other B', '30-33333333-3', null, auth.uid());
```

### 7.2 Search por razón social

1. Goto `/clientes` (debería tener 3 clientes activos visibles).
2. En el search box, tipear `Smoke`.
3. Verificar: 3 cards visibles (los 3 matchean por prefijo razón social).
4. Tipear `Productivo` → solo el cliente `Smoke Productivo EDITADO` visible.

### 7.3 Search por nombre fantasía

1. Limpiar search, tipear `Galpón`.
2. Verificar: 2 cards visibles (`Smoke Productivo EDITADO` con nombre_fantasia `Smoke Galpón` + `Smoke Other A` con `Galpón Norte`).

### 7.4 Search por CUIT con digits-only normalize

1. Limpiar search, tipear `30911223344` (sin guiones, 11 dígitos).
2. Verificar: 1 card visible (`Smoke Productivo EDITADO` cuyo CUIT en DB es `30-91122334-4`).
3. El search client-side normaliza ambos lados (strip guiones del input + strip guiones del CUIT DB) para que matchee.

### 7.5 Search sin matches

1. Limpiar search, tipear `ZZZ_inexistente`.
2. Verificar: mensaje `Ningún cliente coincide con "ZZZ_inexistente"` (no cae a empty state inicial — el empty state es para lista vacía, no para filtrado).

### Criterios de éxito

- ✅ Search por razón social funciona.
- ✅ Search por nombre fantasía funciona.
- ✅ Search por CUIT funciona con o sin guiones.
- ✅ Mensaje "Ningún cliente coincide" cuando filtro no matchea.

### Cleanup

Mantener los 3 clientes — se reusan en §8.

---

## 8. Autocomplete en wizard RGRL

**Validar el autocomplete del wizard step 2 + autopopulate de 5 fields**.

### 8.1 Navegar al wizard

1. Sidebar → `Informes`.
2. Click `Nuevo informe`. URL `/informes/nuevo`.
3. Step 1:
   - Select tipo → `RGRL`.
   - Título → `Smoke RGRL T-051 autocomplete`.
4. Click `Siguiente: cargar datos`.

### 8.2 Autocomplete cliente

1. Step 2 visible con sección `Vincular cliente (opcional)` arriba del form RGRL.
2. En el field `Buscar cliente`, tipear `Smoke Productivo`.
3. Después del debounce 300ms + roundtrip, aparece el resultado `Smoke Productivo EDITADO` con CUIT al lado.
4. Click sobre el resultado.

### 8.3 Card "Cliente seleccionado"

1. Aparece card verde `Cliente seleccionado` con `Smoke Productivo EDITADO` + CUIT.
2. Botón `Limpiar selección` visible.

### 8.4 Autopopulate de los 5 fields del form RGRL

Scrollear al form RGRL debajo del autocomplete y verificar que estos 5 fields se populán automáticamente del cliente seleccionado:

| Field | Valor esperado |
|-------|----------------|
| Razón social | `Smoke Productivo EDITADO` |
| CUIT | `30-91122334-4` |
| Domicilio | `Av. Test 100` |
| Localidad | `La Plata` |
| Provincia | Select muestra `Buenos Aires` (mapping `BA` → name) |

### 8.5 Path "Crear sin datos" (no completamos las 14 fields RGRL)

1. Scroll up. Click `Crear sin datos`.
2. AlertDialog confirm: texto `¿Crear el informe sin completar los datos del establecimiento?`.
3. Click `Crear vacío`.
4. Redirect a `/informes/<uuid>` con el informe creado.

### 8.6 DB verify cliente_id linkeado

```sql
select id, titulo, cliente_id
  from public.informes
 where titulo = 'Smoke RGRL T-051 autocomplete'
 order by created_at desc limit 1;
```

Esperado: 1 row con `cliente_id` = id del cliente `Smoke Productivo EDITADO`.

### 8.7 Audit log INSERT informe con cliente_id

```sql
select action, after_data->'cliente_id' as cliente_id_audit
  from public.audit_log
 where entity_type = 'informes' and action = 'created'
   and entity_id = (
     select id from public.informes
      where titulo = 'Smoke RGRL T-051 autocomplete'
      order by created_at desc limit 1
   );
```

Esperado: 1 row con `cliente_id_audit` = id del cliente (audit_informes extendido en T-050 captura la FK).

### Criterios de éxito

- ✅ Autocomplete responde post-debounce 300ms.
- ✅ Click resultado dispara autopopulate de los 5 fields.
- ✅ Provincia mapping code → name funciona en el Select.
- ✅ Path "Crear sin datos" submitea con `cliente_id` propagado correctamente.
- ✅ DB row del informe tiene `cliente_id` linkeado.
- ✅ Audit log captura `cliente_id` en `after_data`.

---

## 9. Detail cliente con Informes vinculados

**Validar la sección "Informes vinculados" en el detail view del cliente**.

### 9.1 Navegar al detail del cliente

1. Sidebar → `Clientes` → click sobre `Smoke Productivo EDITADO`.
2. URL `/clientes/<id>`.

### 9.2 Verificar sección "Informes vinculados"

1. Scrollear al final del detail (debajo de las 4 Cards + Notas).
2. Aparece la sección `Informes vinculados` con:
   - Título `Informes vinculados`.
   - Descripción `1 informe asociado a este cliente`.
   - Lista con 1 item: título `Smoke RGRL T-051 autocomplete` + Badge `Borrador` (status `draft` default).
3. Click sobre el título → goto `/informes/<id>` (link funcional).

### 9.3 Cliente sin informes (defensa)

1. Goto `/clientes/<id>` de un cliente sin informes vinculados (ej `Smoke Other A`).
2. Verificar: la sección `Informes vinculados` **NO se renderiza** (condicional `linkedInformes.length > 0`).

### Criterios de éxito

- ✅ Sección visible con 1 informe.
- ✅ Pluralización correcta (`1 informe asociado`).
- ✅ Badge status del informe correcto.
- ✅ Link al informe funcional.
- ✅ Sección oculta si cliente sin informes vinculados.

---

## 10. Cross-tenant adversarial — opcional

**Validar que el autocomplete filtra cross-tenant via RLS automático**.

⚠️ Skip esta sección si no tenés acceso a una segunda cuenta de otra consultora. La cobertura action-level vive en integration test `informes-cliente-id.test.ts:2` (T-050).

### 10.1 Setup

Necesitás 2 cuentas activas:
- **Cuenta A** (cAId): la consultora donde estás haciendo el smoke (`Smoke Productivo EDITADO` etc).
- **Cuenta B** (cBId): otra consultora cualquiera, sin clientes en común.

### 10.2 Logout de A, login en B

1. Logout via user menu → click `Cerrar sesión`.
2. Login con cuenta de cuenta B.

### 10.3 Intento de búsqueda cross-tenant

1. Sidebar → `Informes` → `Nuevo informe`.
2. Step 1: tipo `RGRL` + título `Cross-tenant smoke attempt`. Click `Siguiente: cargar datos`.
3. Step 2: en el autocomplete `Buscar cliente`, tipear `Smoke Productivo`.
4. Esperar 1-2 segundos (debounce 300ms + roundtrip).
5. Verificar: **NO aparece** el cliente `Smoke Productivo EDITADO` (RLS automático del query `searchClientesByRazonSocial` filtra por consultora_id del JWT de cuenta B).

### 10.4 Sanity check DB (post-attempt)

```sql
-- Si por error se hubiera creado un informe en cB linkeando al cliente de cA,
-- esta query lo detectaría. Esperado: 0 rows.
select i.id, i.consultora_id, i.cliente_id, c.consultora_id as cliente_consultora
  from public.informes i
  join public.clientes c on c.id = i.cliente_id
 where i.consultora_id != c.consultora_id;
```

Esperado: **0 rows** (defensa en profundidad funciona — RLS UI filter + action-level SELECT defensive).

### 10.5 DevTools defensa adicional (opcional avanzado)

Si querés validar la segunda capa de defensa (action-level), abrí DevTools → Network mientras hacés el step 8.5 en cuenta A (`Crear sin datos`). Hash de form action + CSRF token visibles. Cualquier intento de modificar el body del request manualmente y reenviar via `curl` requeriría reverse-engineering del protocolo Next.js — no factible en runtime browser. La defensa real vive en el código del server action (`createInformeAction` línea ~108-127 con SELECT pre-INSERT RLS-aware).

### Criterios de éxito

- ✅ Autocomplete NO devuelve clientes de tenant ajeno (RLS filter).
- ✅ DB sanity: 0 informes cross-tenant.

---

## Cleanup post-smoke

Limpiar todos los artifacts del smoke. Studio:

```sql
-- Borrar informes del smoke (cliente_id pasa a null via FK ON DELETE SET NULL
-- si el cliente se elimina antes, pero borramos los informes explícito).
delete from public.informes
 where titulo like 'Smoke RGRL T-051%' or titulo like 'Cross-tenant smoke%';

-- Borrar clientes del smoke.
delete from public.clientes
 where razon_social like 'Smoke Productivo%' or razon_social like 'Smoke Other%';

-- Verificar cleanup.
select count(*) as remaining_smoke_informes
  from public.informes
 where titulo like 'Smoke RGRL%' or titulo like 'Cross-tenant smoke%';
-- Esperado: 0.

select count(*) as remaining_smoke_clientes
  from public.clientes
 where razon_social like 'Smoke Productivo%' or razon_social like 'Smoke Other%';
-- Esperado: 0.
```

⚠️ **NO borrar `audit_log` rows** — el audit log es inmutable por diseño. Los rows del smoke quedan como traza histórica.

---

## Troubleshooting común

| Síntoma | Causa probable | Fix |
|---------|----------------|-----|
| `Crear cliente` falla con `DUPLICATE_CUIT` | Ya existe un cliente activo con ese CUIT en el tenant | Elegir otro CUIT o archivar el existente |
| CUIT no autoformatea onBlur | Field no recibió blur event (Tab no funcionó) | Click en otro field manualmente o submit (validate on submit) |
| Autocomplete devuelve vacío con query > 2 chars | Sin clientes que matcheen o RLS bloquea | Verificar lista en `/clientes` que existan + estar logueado en la consultora correcta |
| Provincia Select no muestra valor en form de edit | Field stored como `null` o code fuera de enum PROVINCIAS_AR | Re-seleccionar manualmente |
| "Sin cambios para guardar" cuando hubo cambios | Whitespace-only diff en field opcional (`'' → null` colapsa) | Verificar que el cambio sea significativo |
| Audit log no aparece UPDATE para edit | El diff guard excluye `notas` del trigger | Si solo cambiaste `notas`, no se escribe row (intencional, T-047 design) |
| Sección "Informes vinculados" no aparece | El cliente no tiene informes con `cliente_id` apuntando a su id | Verificar en `/informes/<id>` que el informe tenga `cliente_id` populado |

---

## Notas operativas

- **Tiempo total real**: corriendo secuencialmente sin pausas, ~25-35 min con DB checks via Studio. Con pausas para investigar errores, hasta 60 min.
- **Reusabilidad**: cada sección es autocontenida — Lautaro puede correr §3 solo para validar el form post-fix sin tener que hacer las 10 secciones.
- **Issue tracking**: si encontrás un bug durante el smoke, abrir issue GitHub con prefijo `[smoke-clientes] ...` + referencia a la sección + reproducción minimal.
- **Audit log retention**: los audit rows del smoke quedan permanentes. Si querés purgar manualmente, requiere migration admin (default-deny via service-role only, decisión T-011).
- **Cross-tenant smoke (sección 10)**: si no tenés una segunda consultora real, podés crear una temporal via `/signup` + cleanup explícito al final. Bypass del email confirm requiere SQL admin (no es trivial productivo).

---

**Última actualización**: 2026-05-18 (post-merge T-051).
