# 04 · Arquitectura técnica

Este documento define el stack, el modelo de datos y los patrones de implementación. Lo que está acá es **decisión tomada** (con racional). Lo que aún no se decidió está marcado como `OPEN QUESTION`.

## Stack

```
┌─────────────────────────────────────────────────────────────┐
│ Cliente: PWA en navegador móvil/desktop                     │
│ Next.js 16 App Router · Tailwind · shadcn/ui · React Query  │
│ Service worker para offline · IndexedDB para cache local    │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────────┐
│ API: Next.js Route Handlers en Vercel (serverless)          │
│ Auth middleware con Supabase JWT                            │
│ Proxy a Claude API · Webhooks de Mercado Pago               │
└──────┬─────────────┬─────────────┬─────────────┬────────────┘
       │             │             │             │
       ▼             ▼             ▼             ▼
   Supabase      Supabase      Supabase      Anthropic
     Auth         Postgres      Storage      Claude API
                  + RLS          (S3)
```

### Frontend

- **Framework:** Next.js 16 con App Router. Server components por defecto, client components donde haya interactividad. SSR para SEO de landing.
- **Estilos:** Tailwind CSS 3 con `tailwindcss/forms`. La paleta oscura del prototipo Fase 0 ya está definida (zinc + indigo).
- **Componentes:** shadcn/ui (Radix UI + Tailwind). No instalar ant-design, MUI ni nada pesado.
- **State:** React Query (`@tanstack/react-query`) para fetching/cache. Zustand si hace falta state global compartido.
- **Forms:** React Hook Form + Zod para validación.
- **PWA:** `next-pwa` o manualmente con `next.config.js`. Service worker que cachea assets y APIs públicas.
- **Offline:** IndexedDB vía `idb-keyval` para guardar borradores. Estrategia `stale-while-revalidate` en GET cacheables.
- **Charts:** Chart.js o Recharts cuando lleguemos a dashboards.
- **PDFs:** generación server-side con `@react-pdf/renderer` o `puppeteer-core` + Vercel Edge.

### Backend

- **Runtime:** Vercel serverless (Node.js 20). Edge runtime solo para endpoints simples (auth check).
- **API:** Route Handlers de Next.js (`app/api/*/route.ts`). Convención REST.
- **Auth:** Supabase Auth con cookies (no localStorage). Middleware de Next.js valida JWT en cada request a `/api/*`.
- **DB client:** `@supabase/supabase-js` + `@supabase/ssr` para Next.js.
- **IA:** `@anthropic-ai/sdk` desde el server. **Nunca exponer API key al cliente**.
- **Pagos:** Mercado Pago SDK (`mercadopago`) en endpoints de webhook.
- **Background jobs:** Vercel Cron Jobs para tareas diarias (calcular vencimientos, enviar alertas).

### Persistencia

- **Postgres** vía Supabase. Schema gestionado con migraciones SQL versionadas en `supabase/migrations/`.
- **Row Level Security activo en TODAS las tablas.** Policies que matchean `consultora_id` contra el JWT claim del usuario.
- **Indexes obligatorios:** `consultora_id` en todas, `created_at`, FKs.
- **pgvector extension** activada para futuras features RAG (manuales, normativa).

### Storage

- **Supabase Storage** (S3 compatible). Buckets:
  - `epp-firmas/` — firmas digitales en PNG.
  - `epp-fotos/` — fotos opcionales de entrega.
  - `documentos/` — manuales, certificados, planos.
  - `informes-pdf/` — PDFs generados firmados.
- Archivos privados, accesibles solo vía URL firmada con expiración.

### Hosting

- **Vercel** para Next.js (free tier inicialmente, Pro a USD 20/mes cuando crezca).
- **Supabase** free → Pro a USD 25/mes.
- **Anthropic API** pay-per-use.
- **Mercado Pago** sin costo fijo, fees por transacción.

### Observability (Fase 2+)

- **Sentry** para errores frontend + backend.
- **Vercel Analytics** para tráfico.
- **Supabase Logs** para queries lentas y RLS violations.
- **OpenTelemetry** para tracing si crece.

## Modelo de datos

Las **tablas core**:

### `consultoras`
```sql
id              uuid PK
nombre          text
cuit            text
plan            text  -- 'free', 'pro', 'team', 'enterprise'
mp_subscription text  -- ID de suscripción Mercado Pago
created_at      timestamptz
```

### `usuarios`
```sql
id              uuid PK (=auth.users.id de Supabase)
consultora_id   uuid FK → consultoras
rol             text  -- 'admin', 'consultor', 'asistente', 'cliente'
nombre          text
matricula       text  -- para profesionales firmantes
colegio         text  -- 'CPHySA', 'CIE', etc.
foto_firma_url  text  -- imagen de su firma escaneada
created_at      timestamptz
```

### `clientes`
```sql
id              uuid PK
consultora_id   uuid FK → consultoras
razon_social    text
cuit            text
contacto_nombre text
contacto_email  text
contacto_tel    text
industria       text  -- 'metalúrgica', 'construcción', 'frigorífico'...
art             text  -- nombre de la ART
created_at      timestamptz
```

### `establecimientos`
```sql
id              uuid PK
cliente_id      uuid FK → clientes
consultora_id   uuid FK → consultoras  -- denormalizado para RLS
nombre          text
domicilio       text
provincia       text
decreto_aplic   text  -- '351/79', '911/96', '617/97'
```

### `empleados`
```sql
id                uuid PK
establecimiento_id uuid FK
consultora_id     uuid FK
nombre            text
dni               text
cuil              text
puesto            text
talles            jsonb  -- { camisa: 'L', pantalon: '44', calzado: '42' }
foto_url          text
fecha_ingreso     date
created_at        timestamptz
```

### `informes`
```sql
id              uuid PK
consultora_id   uuid FK
cliente_id      uuid FK
establecimiento_id uuid FK nullable
tipo            text  -- 'ruido', 'iluminacion', 'pat', 'rgrl', 'cargafuego', 'kit_jornada', etc.
fecha_medicion  date
datos_input     jsonb  -- los datos crudos cargados
prompt_usado    text   -- para auditoría/iteración
contenido_html  text   -- el output generado
contenido_pdf_url text -- si se exportó
profesional_id  uuid FK → usuarios
estado          text  -- 'borrador', 'firmado', 'presentado'
firmado_at      timestamptz nullable
created_at      timestamptz
created_by      uuid FK → usuarios
```

### `entregas_epp`
```sql
id              uuid PK
consultora_id   uuid FK
establecimiento_id uuid FK
empleado_id     uuid FK
fecha_entrega   date
items           jsonb  -- [{ tipo, marca, talle, lote, cantidad }, ...]
firma_url       text
foto_url        text nullable
firmado         boolean default true
proxima_entrega_calc date  -- generated column: fecha_entrega + 6 meses
notas           text
created_by      uuid FK → usuarios
created_at      timestamptz
```

### `documentos`
```sql
id              uuid PK
consultora_id   uuid FK
cliente_id      uuid FK nullable
establecimiento_id uuid FK nullable
tipo            text  -- 'manual_equipo', 'cert_calibracion', 'plano', 'poliza', etc.
titulo          text
equipo_asociado text
archivo_url     text
fecha_emision   date
periodicidad_dias int  -- frecuencia de revisión
proxima_revision date  -- calculada
ocr_text        text  -- contenido extraído
embedding       vector(1536)  -- para RAG
created_at      timestamptz
```

### `permisos_trabajo`
```sql
id              uuid PK
consultora_id   uuid FK
establecimiento_id uuid FK
fecha           date
tipo            text  -- 'altura', 'confinado', 'caliente', 'electrico'
empleados_ids   uuid[]
mediciones      jsonb  -- { viento_kmh: 18, gas_co_ppm: 12, ... }
habilitado      boolean
firmas          jsonb  -- [{ nombre, dni, firma_url, timestamp }]
ubicacion_gps   point
created_by      uuid FK
created_at      timestamptz
```

### `capacitaciones`
```sql
id              uuid PK
consultora_id   uuid FK
establecimiento_id uuid FK
fecha           date
tema            text
duracion_min    int
material_url    text
asistentes      jsonb  -- [{ empleado_id, firma_url }]
created_by      uuid FK
```

### `incidentes`
```sql
id              uuid PK
consultora_id   uuid FK
establecimiento_id uuid FK
fecha           date
gravedad        text  -- 'leve', 'grave', 'mortal'
dias_perdidos   int
causa_raiz      text
empleado_id     uuid FK nullable
descripcion     text
created_by      uuid FK
```

### `checklists`
```sql
id              uuid PK
consultora_id   uuid FK
tipo_tarea      text   -- 'altura', 'confinado', etc.
equipo          text   -- 'arnes_petzl', 'andamio_metalico', etc.
items           jsonb  -- [{ pregunta, criterio_aprobacion }]
created_at      timestamptz
```

### `checklist_ejecuciones`
```sql
id              uuid PK
checklist_id    uuid FK
permiso_id      uuid FK nullable
respuestas      jsonb
firmado_por     uuid FK
firmado_at      timestamptz
```

## Multi-tenancy con Row Level Security

**Patrón:** cada tabla tiene `consultora_id`. Cada usuario en `auth.users` tiene un claim `consultora_id` en su JWT (vía Supabase Auth Hook que lo agrega al login). RLS policies:

```sql
-- Ejemplo en tabla "informes"
ALTER TABLE informes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consultora_isolation" ON informes
  FOR ALL
  USING (consultora_id = (auth.jwt() ->> 'consultora_id')::uuid)
  WITH CHECK (consultora_id = (auth.jwt() ->> 'consultora_id')::uuid);
```

**Consecuencias críticas:**
- Cualquier query desde el cliente solo ve sus datos. Garantizado por DB, no por código.
- Operaciones admin (cron jobs, migraciones) usan **service role key** que bypasea RLS — esa key vive solo en variables de entorno del servidor.
- Index obligatorio sobre `consultora_id` en todas las tablas — sin esto las queries son lentas.

## Seguridad

- **Auth:** Supabase Auth maneja contraseñas (bcrypt), magic links, OAuth Google.
- **Sessions:** cookies httpOnly + sameSite, no localStorage.
- **API key de Claude:** en `process.env.ANTHROPIC_API_KEY`, accesible solo en server.
- **Mercado Pago webhook signing:** validar firma de cada webhook.
- **Rate limiting:** middleware en `/api/generate-*` por usuario (ej: 100 informes/hora plan Pro).
- **CORS:** restringido al dominio propio.
- **Audit log:** tabla `audit_log` que registra crear/editar/eliminar de entidades sensibles (informes firmados, entregas EPP).
- **Backup:** Supabase Pro tiene point-in-time recovery 7 días. Activarlo apenas pasamos a producción.

## Patrones críticos de implementación

### Generación de informe (server-side)

```typescript
// app/api/informes/generar/route.ts
export async function POST(req: Request) {
  const supabase = createServerClient(...)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { tipo, datos, prompt_custom } = await req.json()

  // 1. Validar plan y rate limit
  const allowed = await checkUsage(user.id, tipo)
  if (!allowed) return new Response('Limit exceeded', { status: 429 })

  // 2. Construir prompt con contexto
  const prompt = await buildPrompt(tipo, datos, prompt_custom)

  // 3. Llamar Claude
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  })

  // 4. Persistir
  const { data: informe } = await supabase
    .from('informes')
    .insert({
      consultora_id: user.user_metadata.consultora_id,
      tipo, datos_input: datos, prompt_usado: prompt,
      contenido_html: msg.content[0].text,
      created_by: user.id, estado: 'borrador'
    })
    .select().single()

  // 5. Log de uso (para facturación / analytics)
  await logUsage(user.id, msg.usage)

  return Response.json(informe)
}
```

### Estrategia offline (PWA)

1. Service worker cachea assets y rutas estáticas (`/`, `/dashboard`).
2. `next-pwa` con runtime caching para APIs `GET /api/datos-maestros/*`.
3. Operaciones de escritura (entrega EPP en planta sin internet):
   - Se guardan en IndexedDB con flag `pending_sync = true`.
   - Service worker escucha el evento `sync` (BackgroundSync API).
   - Cuando reconecta, envía las pendientes al server.
   - Si hay conflicto (servidor más reciente), notificar al usuario.

### Generación de PDFs

Para informes firmables: usar `@react-pdf/renderer` server-side. Genera PDF/A-2 con metadatos. Subir a Storage. Devolver URL firmada al cliente.

Para planillas Resolución 299/11: usar plantilla de plantilla legal pre-aprobada por un abogado. Inyectar datos. PDF firmado digitalmente con la imagen de firma del usuario.

### Sincronización de cambios entre dispositivos

Supabase Realtime (websocket) para notificar al consultor "te firmaron una entrega EPP en otro dispositivo". Reduce confusión cuando hay 2 técnicos simultáneos en planta.

## Costos por escala

| Escala | Usuarios activos | DB | Storage | API Claude | Vercel | Total /mes |
|--------|------------------|----|---------|-----------:|-------:|-----------:|
| Validación | 10 | Free | Free | USD 5 | Free | USD 5 |
| Tracción | 100 | USD 25 | USD 0.02/GB | USD 100 | USD 20 | USD ~150 |
| Crecimiento | 500 | USD 25-100 | USD 30 | USD 500 | USD 20 | USD ~700 |
| Escala | 2000 | Add-ons USD 200 | USD 100 | USD 2000 | USD 100 | USD ~2400 |

A 100 usuarios pagando USD 30 promedio = USD 3000 ingresos. Margen 50%. Sano.

## OPEN QUESTIONS pendientes de decisión

1. ¿`@react-pdf/renderer` o `puppeteer-core`? El primero es nativo de React y rápido, el segundo soporta CSS arbitrario pero pesa.
2. ¿Embeddings con `@anthropic-ai/sdk` (Voyage) o con `text-embedding-3-large` de OpenAI? Anthropic recomienda Voyage; pero si ya pagamos Claude, ¿agregar otra API?
3. ¿Soporte de modo "una sola persona" o ya forzar siempre crear "consultora" aunque sea solo? La segunda es más limpia técnicamente.
4. ¿`payments-by-Stripe` con conversión a USD o `Mercado Pago` puro? El primero es internacional pero sufrimos retenciones; el segundo es local pero limita expansión.
