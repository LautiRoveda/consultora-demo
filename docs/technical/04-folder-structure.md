# Technical 04 · Estructura de carpetas

Define dónde va cada archivo en el repo. Si todos respetamos esta estructura, navegar el código es predecible y Claude Code rinde mejor.

## Estructura completa

```
consultora-demo/
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # typecheck + lint + test + build
│       └── deploy-preview.yml        # deploys de PR
│
├── docs/
│   ├── discovery/                    # análisis de negocio (cerrado)
│   ├── technical/                    # documentos técnicos (este)
│   └── adr/                          # Architecture Decision Records
│
├── public/
│   ├── manifest.json                 # PWA manifest (Fase 3)
│   ├── icons/
│   └── sw.js                         # service worker (Fase 3)
│
├── src/
│   ├── app/                          # Next.js App Router (rutas)
│   │   ├── (marketing)/              # landing, pricing, sobre nosotros
│   │   │   ├── page.tsx
│   │   │   ├── pricing/
│   │   │   └── about/
│   │   ├── (auth)/                   # login, registro
│   │   │   ├── login/
│   │   │   ├── signup/
│   │   │   └── magic-link/
│   │   ├── (app)/                    # área autenticada
│   │   │   ├── layout.tsx            # nav, sidebar, auth gate
│   │   │   ├── dashboard/
│   │   │   ├── informes/
│   │   │   ├── empleados/
│   │   │   ├── epp/
│   │   │   ├── checklists/
│   │   │   ├── calendario/
│   │   │   ├── clientes/
│   │   │   ├── configuracion/
│   │   │   └── facturacion/
│   │   ├── api/
│   │   │   └── webhooks/
│   │   │       ├── mercadopago/
│   │   │       ├── telegram/
│   │   │       └── stripe.disabled/   # placeholder futuro
│   │   ├── layout.tsx                # root layout
│   │   ├── error.tsx
│   │   └── not-found.tsx
│   │
│   ├── modules/                      # módulos de negocio
│   │   ├── auth/
│   │   │   ├── components/           # componentes específicos (LoginForm, etc.)
│   │   │   ├── actions.ts            # Server Actions
│   │   │   ├── queries.ts            # Lecturas (cuando aplica)
│   │   │   ├── schemas.ts            # Zod schemas
│   │   │   ├── types.ts              # Tipos del módulo
│   │   │   ├── index.ts              # API pública del módulo
│   │   │   └── README.md             # Qué hace el módulo
│   │   ├── tenancy/
│   │   ├── auditoria/
│   │   ├── notificaciones/
│   │   │   ├── components/
│   │   │   ├── adapters/             # email-resend, telegram-bot, push-web
│   │   │   ├── actions.ts
│   │   │   ├── queries.ts
│   │   │   ├── dispatcher.ts         # routea evento al adapter correcto
│   │   │   ├── schemas.ts
│   │   │   ├── types.ts
│   │   │   ├── index.ts
│   │   │   └── README.md
│   │   ├── calendario/
│   │   ├── informes/
│   │   │   ├── components/
│   │   │   ├── generators/           # uno por tipo (ruido, iluminacion, etc.)
│   │   │   ├── prompts/              # plantillas de prompt por tipo
│   │   │   ├── actions.ts
│   │   │   ├── queries.ts
│   │   │   ├── pdf-generator.ts      # exportar PDF
│   │   │   ├── schemas.ts
│   │   │   ├── types.ts
│   │   │   ├── index.ts
│   │   │   └── README.md
│   │   ├── epp/
│   │   ├── checklists/
│   │   ├── catalogo-tareas/          # (placeholder Fase 3)
│   │   ├── accidentabilidad/
│   │   ├── permisos-trabajo/         # (placeholder Fase 3)
│   │   ├── documentos/               # (placeholder Fase 4)
│   │   ├── capacitaciones/           # (placeholder Fase 4)
│   │   └── pagos/
│   │       ├── components/
│   │       ├── mercadopago/          # SDK wrappers, webhook handlers
│   │       ├── actions.ts
│   │       ├── plans.ts              # definición de planes
│   │       ├── schemas.ts
│   │       ├── types.ts
│   │       ├── index.ts
│   │       └── README.md
│   │
│   ├── shared/                       # código compartido entre módulos
│   │   ├── ui/                       # componentes base (shadcn/ui extendidos)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── form.tsx
│   │   │   ├── dialog.tsx
│   │   │   └── ...
│   │   ├── lib/
│   │   │   ├── cn.ts                 # className utility
│   │   │   ├── format.ts             # date, number formatters
│   │   │   ├── errors.ts             # error classes custom
│   │   │   └── rate-limit.ts
│   │   ├── ai/
│   │   │   ├── client.ts             # cliente Claude abstracto
│   │   │   ├── pricing.ts            # cálculo de costos
│   │   │   └── prompt-cache.ts
│   │   ├── supabase/
│   │   │   ├── server.ts             # cliente server-side
│   │   │   ├── client.ts             # cliente browser
│   │   │   ├── middleware.ts         # refresh de sesión
│   │   │   ├── service-role.ts       # uso solo en jobs
│   │   │   └── types.ts              # tipos generados
│   │   ├── i18n/
│   │   │   └── es-AR.ts              # strings en español argentino
│   │   ├── observability/
│   │   │   ├── sentry.ts
│   │   │   ├── logger.ts
│   │   │   └── metrics.ts
│   │   └── validation/
│   │       └── argentinian-id.ts     # CUIT, CUIL, DNI validators
│   │
│   ├── tests/
│   │   ├── unit/                     # tests por módulo
│   │   │   ├── informes/
│   │   │   ├── epp/
│   │   │   └── ...
│   │   ├── integration/
│   │   │   ├── rls/                  # tests de Row Level Security
│   │   │   └── ...
│   │   ├── e2e/                      # Playwright
│   │   │   ├── auth.spec.ts
│   │   │   ├── informes.spec.ts
│   │   │   └── ...
│   │   ├── fixtures/                 # datos de test
│   │   └── helpers/                  # factories, db setup
│   │
│   ├── styles/
│   │   └── globals.css               # Tailwind base + custom CSS
│   │
│   └── env.ts                        # validación de variables de entorno con Zod
│
├── supabase/
│   ├── migrations/                   # SQL versionado
│   ├── seed.sql                      # datos de desarrollo
│   ├── functions/                    # edge functions (futuro)
│   └── config.toml
│
├── .env.example                      # plantilla de variables
├── .eslintrc.json
├── .gitignore
├── .prettierrc
├── CLAUDE.md                         # contexto para agentes IA
├── README.md                         # overview para humanos
├── components.json                   # config shadcn/ui
├── next.config.ts
├── package.json
├── pnpm-lock.yaml
├── postcss.config.js
├── tailwind.config.ts
├── tsconfig.json
└── vitest.config.ts
```

## Reglas de naming

### Archivos

- Componentes React: `kebab-case.tsx` (Next.js convention).
- Server Actions: `actions.ts` (singular: el módulo tiene un archivo).
- Queries: `queries.ts`.
- Schemas: `schemas.ts`.
- Tipos: `types.ts`.
- Tests: `<archivo>.test.ts` o `<archivo>.spec.ts`.
- E2E tests: `<flujo>.spec.ts` en `tests/e2e/`.
- API public del módulo: `index.ts`.

### Imports

Usar imports absolutos con alias `@/`:

```typescript
// Correcto
import { generateReport } from '@/modules/informes'
import { Button } from '@/shared/ui/button'

// Incorrecto
import { generateReport } from '../../../modules/informes/actions'
```

`tsconfig.json` configura el alias.

### Server vs Client components

- Server Component por default.
- Client Component solo cuando se necesita estado, efectos, o eventos del browser.
- Nombrar `*.client.tsx` no es obligatorio pero ayuda la legibilidad cuando un módulo tiene varios.

## Reglas de organización por módulo

Cada módulo en `src/modules/<nombre>/` sigue esta estructura mínima:

```
modulo/
├── components/        # componentes React específicos del módulo
├── actions.ts         # Server Actions (mutations)
├── queries.ts         # funciones de lectura
├── schemas.ts         # Zod schemas para validación
├── types.ts           # tipos TypeScript del módulo
├── index.ts           # API pública (lo que se exporta afuera)
└── README.md          # qué hace, qué expone, qué consume
```

Subcarpetas opcionales según necesidad:
- `adapters/` para módulos con múltiples implementaciones (ej: notificaciones)
- `generators/` para informes
- `prompts/` cuando hay plantillas de IA
- `lib/` para utilidades internas del módulo

### Lo que NO va dentro del módulo

- Páginas/rutas → van en `src/app/(app)/<modulo>/`
- Componentes UI base (Button, Input, Dialog) → van en `src/shared/ui/`
- Cliente Supabase → va en `src/shared/supabase/`
- Cliente IA → va en `src/shared/ai/`

## API pública (`index.ts`) de un módulo

Ejemplo para informes:

```typescript
// src/modules/informes/index.ts

export { generateReport, signReport, exportPDF } from './actions'
export { getReports, getReportById, compareNormVersions } from './queries'
export type { Report, ReportType, ReportStatus } from './types'
export { ReportSchema, GenerateReportSchema } from './schemas'
```

Lo que no se exporta desde acá no existe afuera del módulo. Otros módulos importan así:

```typescript
import { generateReport, type Report } from '@/modules/informes'
```

## Variables de entorno

Validadas con Zod en `src/env.ts`. Si una variable falta o es inválida, el server no arranca.

```typescript
// src/env.ts
import { z } from 'zod'

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
  RESEND_API_KEY: z.string(),
  TELEGRAM_BOT_TOKEN: z.string(),
  MERCADOPAGO_ACCESS_TOKEN: z.string(),
  MERCADOPAGO_WEBHOOK_SECRET: z.string(),
  SENTRY_DSN: z.string().url().optional(),
  // ... más variables
})

export const env = envSchema.parse(process.env)
```

## Tests al lado del código vs en `tests/`

Convención del proyecto: **tests separados en `src/tests/`**, no co-localizados.

Razones:
- Más fácil ignorar tests al hacer build de producción.
- Cobertura por capa (unit/integration/e2e) más explícita.
- Estructura de `tests/` espeja la de `modules/`.

Excepción: tests muy pequeños y específicos (helpers puros) pueden vivir junto al archivo como `helper.test.ts`.

## Imports compartidos vs módulos

- Si un módulo necesita algo que solo él usa, va dentro del módulo.
- Si dos o más módulos lo necesitan, se promueve a `shared/`.
- No promover preventivamente. Esperar a tener dos casos reales antes de extraer.

## Migraciones

Cada cambio en el schema de DB es una nueva migración. Nunca modificar una migración aplicada. Naming: `YYYYMMDDHHMMSS_breve_descripcion.sql`.

## CLAUDE.md actualizado

El archivo raíz del repo se mantiene como índice navegable que cualquier agente lee primero. Apunta a los documentos clave en orden de importancia. Se actualiza con cada cambio significativo en arquitectura o roadmap.
