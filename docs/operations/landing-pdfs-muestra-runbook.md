# Runbook · Generar PDFs muestra para la landing

Propósito: regenerar los 3 PDFs + 3 PNGs preview que la landing pública (`/`, `/features`) usa como "Documentos reales" en la sección de muestras.

Cuándo correr este runbook:
- Pre-launch comercial (T-108 inicial · primera carga de archivos reales que reemplazan los placeholders del CP3).
- Cada vez que se agregue una nueva tabla SRT al prompt IA (T-A6-FU0 iluminación, T-A6-FU1 ergonomía con tabla cargada, etc).
- Cuando cambien las normas SRT y haya que mostrar la cita actualizada.
- Cuando se ajuste el branding del PDF (logo, footer).

Tiempo estimado: 45-60 minutos seguidos.

---

## Pre-requisitos

| Item | Valor |
|---|---|
| URL productiva | `https://consultora-demo.test-ia.cloud` |
| Cuenta a usar | Cuenta test productiva (NO la owner real) |
| Si no existe cuenta test | Signup nueva con email tipo `demo@dominio.com` |
| Path final de archivos | `public/landing/` en el repo |

Cantidad de archivos a generar:
- 3 PDFs (informe ruido, planilla EPP, informe ergonomía)
- 3 PNGs preview (1 por PDF, primera página)

Total: 6 archivos a reemplazar los placeholders existentes en `public/landing/`.

---

## Paso 1 · Crear cliente Demo

Menu lateral → **Clientes** → "Nuevo cliente":

| Campo | Valor |
|---|---|
| Razón social | `Cliente Demo SA` |
| CUIT | `30-00000000-1` |
| Domicilio | `Av. Demo 1234` |
| Localidad | `Ciudad Autónoma de Buenos Aires` |
| Provincia | `CABA` |

Guardar.

Si el cliente ya existe de runs anteriores: usar el existente, no duplicar.

---

## Paso 2 · Crear empleado

Dentro del cliente Demo → **Empleados** → "Nuevo empleado":

| Campo | Valor |
|---|---|
| Nombre | `Juan` |
| Apellido | `Pérez` |
| DNI | `30000000` |
| CUIL | `20-30000000-3` |
| Puesto | `Operario` |
| Fecha de ingreso | Cualquier fecha pasada (ej: `2024-01-15`) |

Guardar.

---

## Paso 3 · PDF 1 · Informe técnico de ruido

Menu lateral → **Informes** → "Nuevo informe":

| Campo | Valor |
|---|---|
| Tipo | `Relevamiento de riesgos` |
| Cliente | `Cliente Demo SA` |
| Título | `Informe técnico de ruido — operario prensa` |
| Agentes a relevar | Tildá SOLO `Ruido` (descheck el resto) |
| Áreas relevadas | `Producción / planta` |

En el campo de mediciones / equipos / descripción libre, pegá literal:

```
Puesto: Operario prensa hidráulica.
Medición: 92 dB(A) jornada efectiva 8 horas, sin protección auditiva.
Instrumental: sonómetro Tipo 1 (datos a completar por matriculado).
```

Click **Generar con IA**. Esperá streaming (~30-60 seg).

### Verificación del output

El PDF debe contener literal:
- "Resolución SRT 85/12" o "Resolución SRT 85/2012"
- "Decreto 351/79 Anexo V"
- Concluir "supera el TLV 85 dB(A)" o equivalente
- Jerarquía de controles completa (fuente → administrativo → EPP)
- Footnote "Nota normativa: ... vigencia verificada al [fecha actual] ... verificar en https://www.srt.gob.ar"

Si falta alguno de los 5 puntos, regenerá el informe.

### Descargar

Click **Descargar PDF** o **Exportar PDF**.

Guardar como: **`demo-informe-ruido.pdf`**

---

## Paso 4 · PDF 2 · Planilla SRT 299/11 EPP

Menu lateral → **EPP** → "Nueva entrega":

| Campo | Valor |
|---|---|
| Empleado | `Juan Pérez` |
| Fecha de entrega | Hoy |

### Items a agregar (3-4)

Si el catálogo de EPP está vacío, creá rápido estos items:

| Item | Cantidad | Tipo |
|---|---|---|
| Casco de seguridad ABS | 1 | No descartable |
| Antiparras de policarbonato | 1 | No descartable |
| Borcegos con puntera de acero | 1 par | No descartable |
| Guantes de cuero | 2 pares | No descartable |

### Firma del trabajador

Dibujá cualquier garabato en el canvas de firma. NO tiene que ser realista — es un demo.

### Cerrar entrega

Click **Generar planilla 299/11** o **Cerrar entrega** o **Confirmar**.

Descargar el PDF generado como: **`demo-planilla-epp.pdf`**

### Verificación del output

El PDF debe contener:
- Formato Res SRT 299/11 reconocible
- Datos del empleado (Juan Pérez, DNI 30000000)
- Lista de items entregados con cantidades
- Firma del trabajador embebida
- Fecha y firma del responsable

---

## Paso 5 · PDF 3 · Informe técnico de ergonomía

Menu lateral → **Informes** → "Nuevo informe":

| Campo | Valor |
|---|---|
| Tipo | `Relevamiento de riesgos` |
| Cliente | `Cliente Demo SA` |
| Título | `Informe técnico de ergonomía — operario prensa` |
| Agentes a relevar | Tildá SOLO `Ergonomía` |
| Áreas relevadas | `Producción / planta` |

Mediciones literal:

```
Puesto: Operario prensa hidráulica.
Movimientos repetitivos de miembro superior. Ciclo de trabajo
aproximado de 8 segundos. Postura semi-estática durante la jornada.
```

Click **Generar con IA**. Esperá streaming.

### Verificación del output (importante)

El PDF debe:
- NO mencionar "Resolución SRT 886/15" con número específico (no hay tabla cargada hoy, debe usar genérico).
- Usar fraseo tipo "Resolución SRT vigente sobre ergonomía" o "[El profesional matriculado completará el número de resolución SRT aplicable]".
- NO incluir footnote "Nota normativa: vigencia verificada al ..." (ese footnote es exclusivo de agentes con tabla cargada — hoy solo ruido).
- Citar normas reales (Res MTEySS 295/03, ISO 11228-3, método OCRA) sin inventar números.

Si el output cita "Res 886/15" con número, regenerá hasta que use genérico (es el comportamiento correcto de T-107).

Descargar como: **`demo-informe-ergonomia.pdf`**

---

## Paso 6 · Generar PNGs preview

Necesitás 3 imágenes, 1 por PDF, mostrando la primera página.

Tamaño objetivo: ~1200x630 (landscape). Si te quedan distintas, el `<Image>` de Next.js las reescala automático.

### Opciones para extraer la imagen

**Opción A · Windows Snipping Tool** (más fácil)

1. Abrí el PDF en Adobe Reader o en Edge (Chromium PDF viewer).
2. Zoom para que la primera página entre completa en pantalla.
3. `Win+Shift+S` → seleccionás el área del PDF.
4. Pegás en Paint o GIMP → guardás como PNG.

**Opción B · pdf24.org online** (sin login)

1. Andá a `https://tools.pdf24.org/es/pdf-a-png`.
2. Subí el PDF.
3. Descargá la primera página como PNG.

**Opción C · Preview.app** (Mac)

1. Abrí el PDF en Preview.
2. File → Export → Format: PNG → Save.

### Nombres exactos requeridos

| PDF origen | PNG preview |
|---|---|
| `demo-informe-ruido.pdf` | `demo-informe-ruido-preview.png` |
| `demo-planilla-epp.pdf` | `demo-planilla-epp-preview.png` |
| `demo-informe-ergonomia.pdf` | `demo-informe-ergonomia-preview.png` |

---

## Paso 7 · Reemplazar archivos en `public/landing/`

Una vez que tenés los 6 archivos en `Downloads/` o donde los guardaste:

```pwsh
# Asumiendo archivos en C:\Users\lauta\Downloads\
Copy-Item C:\Users\lauta\Downloads\demo-*.pdf C:\proyecto\consultora-demo\public\landing\ -Force
Copy-Item C:\Users\lauta\Downloads\demo-*-preview.png C:\proyecto\consultora-demo\public\landing\ -Force
```

Verificá que los 6 archivos están en `public/landing/`:

```pwsh
ls C:\proyecto\consultora-demo\public\landing\
```

Esperado:
- `demo-informe-ruido.pdf` (tamaño real ~150-300 KB, no 600 bytes del placeholder)
- `demo-planilla-epp.pdf`
- `demo-informe-ergonomia.pdf`
- `demo-informe-ruido-preview.png`
- `demo-planilla-epp-preview.png`
- `demo-informe-ergonomia-preview.png`

---

## Paso 8 · Commit + push

Si esto es la primera carga (durante T-108):

```pwsh
git switch feat/T-108-landing-comercial
git status
git add public/landing/
git commit -m "T-108 · CP5.3 reemplazar placeholders con PDFs Cliente Demo reales"
git push origin feat/T-108-landing-comercial
```

Si esto es post-merge T-108 (regeneración futura):

```pwsh
git switch main
git pull origin main
git switch -c chore/regenerar-pdfs-muestra-landing
git add public/landing/
git commit -m "chore: regenerar PDFs muestra landing (cliente Demo SA actualizado)"
git push origin chore/regenerar-pdfs-muestra-landing
gh pr create --base main --head chore/regenerar-pdfs-muestra-landing \
  --title "chore: regenerar PDFs muestra landing" \
  --body "Refresh de los 6 assets en public/landing/. Ver runbook docs/operations/landing-pdfs-muestra-runbook.md."
```

CI re-corre ~10 min. Esperar SUCCESS antes de mergear.

---

## Paso 9 · Verificación post-deploy

Una vez mergeado + click Implementar EasyPanel + container healthy:

1. Abrir `https://consultora-demo.test-ia.cloud/` en navegador incógnito.
2. Scroll hasta sección "Documentos reales".
3. Verificar que las 3 cards muestran preview real (NO "Preview pending").
4. Click "Ver muestra PDF" en cada una → debe descargar el PDF real (NO el placeholder de 600 bytes).

Si alguna card sigue mostrando placeholder:
- Verificar que el archivo en `public/landing/` se subió correctamente al repo.
- Verificar que el container de EasyPanel hizo redeploy (`uptime_seconds` chico en `/api/health`).
- Si todo OK pero sigue placeholder, hacer hard refresh `Ctrl+Shift+R` para invalidar cache del navegador.

---

## Datos a NO usar (PII)

NO uses estos datos reales aunque te tiente:

- Nombre/apellido de personas reales.
- CUITs de empresas reales conocidas (Acme SA, Apple, etc).
- DNIs reales.
- Emails personales.

Los datos del runbook son intencionalmente sintéticos:
- `Cliente Demo SA` no es nombre genérico de empresa real registrada.
- CUIT `30-00000000-1` es inválido por checksum (los CUITs reales no tienen prefix `30-0000`).
- `Juan Pérez DNI 30000000` es genérico no identificable.

Si por alguna razón emerge necesidad de un dato más específico, primero verificá que no matchea con persona/empresa real.

---

## Troubleshooting

### El informe IA dice "Acme SA" o algo distinto a "Cliente Demo SA"

La IA lee el contexto del cliente cargado en el form. Si decís "Cliente Demo SA" en el form pero el output dice "Acme SA", probablemente seleccionaste el cliente equivocado en el wizard. Volvé al paso 3 y verificá que el cliente seleccionado es `Cliente Demo SA`.

### El PDF ergonomía cita "Res 886/15" con número específico

Eso es alucinación de la IA (no hay tabla cargada hoy para ergonomía). Regenerá hasta que use genérico. Si pasa 3 veces seguidas, abrí issue en GitHub describiendo el caso para evaluar bug en el prompt condicional T-107.

### El canvas de firma no me deja firmar

Probá:
- Cambiar de navegador (Chrome vs Firefox).
- Desactivar bloqueador de scripts si tenés.
- Probar desde tablet o celular si Desktop falla.

### Los PNGs preview salen muy chicos o muy grandes

Tamaño objetivo es ~1200x630 pero no es estricto. El `<Image>` de Next.js usa `width={1200} height={800}` en el componente — si tus PNGs son distintos, se reescalan respetando aspect ratio. No hace falta editar el código.

### Necesito que los PDFs lleven mi marca real (logo + matrícula)

Antes de generar los PDFs, andá a Settings → Consultora y configurá:
- Logo (PNG 200x80 transparente recomendado)
- Color de marca
- Número de matrícula del responsable

Los PDFs generados después de esto van a llevar tu branding.

Para los PDFs muestra de la landing, podés usar branding genérico ConsultoraDemo o tu marca real — depende del posicionamiento que quieras.

---

## Forward · automatización futura

Este runbook es manual hoy. Cuando emerja necesidad real (regenerar 4+ veces al año), considerar:

- Script Node que hace login + crea cliente + genera informe + descarga PDF programáticamente.
- Endpoint `/api/internal/generate-demo-pdfs` gated por admin que hace lo mismo desde server.
- Cron job semanal que regenera los PDFs y los sube a CDN.

Hoy NO es prioridad (manual 1-2 veces al año es aceptable).
