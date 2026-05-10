# Technical 00 · Skills, herramientas y best practices del stack

Inventario de qué skills de Claude Code valen la pena agregar al proyecto, qué best practices oficiales aplican a cada pieza del stack, y qué decisiones técnicas se desprenden de eso. Este documento se mantiene actualizado: cuando aparece una nueva skill útil o una práctica nueva, se suma acá.

## Skills de Claude Code recomendadas

Una **skill** en Claude Code es un módulo con conocimiento especializado y guías que el agente lee al recibir una tarea relacionada. Tener las skills correctas instaladas mejora la calidad del código que sale.

### Ya instaladas y útiles para el output del producto

- **docx** — generación de informes en Word. Lo vamos a usar para exportar los informes técnicos firmables.
- **pdf** — generación y manipulación de PDFs. Para planillas Resolución 299/11, certificados de capacitación, exportación final firmable de informes.
- **xlsx** — para exportación de padrones, informes de cumplimiento, reportes mensuales.
- **schedule** — para crear tareas programadas. Útil para alertas de vencimientos antes de tener pg_cron configurado.

### Recomendadas para el desarrollo

**doc-coauthoring** — guía estructurada para escribir documentación técnica de calidad. La queremos aplicar a los siguientes documentos de `docs/technical/`. Hace que cada documento siga un proceso de transferencia de contexto / iteración / verificación.

**mcp-builder** — útil cuando lleguemos a Fase 5+ y queramos exponer ConsultoraDemo como MCP server (para que un consultor con Claude Desktop pueda hacer preguntas sobre sus datos directamente desde el chat). No urgente, pero queda en el horizonte.

**web-artifacts-builder** — para crear mockups rápidos durante el desarrollo. Por ejemplo, prototipar una pantalla nueva antes de implementarla en el repo.

### Las que NO encontré como skills oficiales pero hay que cubrir igual

- Generación de tests (Vitest)
- Patrones Next.js 15 App Router
- Supabase RLS y multi-tenant
- Tailwind / shadcn/ui
- CI/CD GitHub Actions

Estas no las cubre una skill específica. Las cubrimos con **documentación técnica clara en el repo** (los archivos siguientes de `docs/technical/`) que cualquier agente de IA pueda leer y aplicar.

## Stack consolidado con justificación final

| Pieza | Elección | Por qué | Costo |
|-------|----------|---------|-------|
| Framework | Next.js 15 con App Router | Server components nativos, Server Actions reducen API code, deploy 1-click en Vercel | Gratis |
| Lenguaje | TypeScript con `strict: true` | Type safety end-to-end. Claude Code rinde mejor con tipos | Gratis |
| Estilos | Tailwind CSS + shadcn/ui | shadcn copia componentes a tu repo, podés modificarlos. Sin lock-in | Gratis |
| DB / Auth / Storage | Supabase | Postgres real con RLS para multi-tenant, auth y storage en un solo paquete | Gratis hasta 500MB DB |
| Acceso a DB | `@supabase/supabase-js` directo (sin ORM) | Curva de aprendizaje cero, type generation automática, alcance suficiente | Gratis |
| Validación | Zod | Schemas que validan input/output, generan tipos. Estándar 2026 | Gratis |
| IA | Anthropic SDK (`@anthropic-ai/sdk`) | Claude Sonnet 4.6 para informes, Haiku 4.5 para tareas simples, Opus 4.7 para análisis complejos (ver ADR-0003) | Pay-per-use |
| Tests | Vitest + Playwright | Vitest reemplazó Jest, ESM nativo, rápido. Playwright para E2E | Gratis |
| Emails | Resend | DX moderna, 3000 emails/mes gratis | Free → USD 20/mes |
| Notificaciones push móviles | Telegram Bot API | Gratis sin límite, alta entrega, soporte argentino bueno | Gratis siempre |
| Pagos | Mercado Pago | Cobro en pesos argentinos, suscripciones recurrentes | ~3% por transacción |
| Hosting | Vercel | Deploy automático desde Git, edge functions, gratis para arrancar | Free → USD 20/mes |
| Errores | Sentry | Stack traces con contexto, alertas, 5K errores/mes gratis | Free → USD 26/mes |
| CI/CD | GitHub Actions | 2000 minutos/mes gratis, integración nativa con repo | Gratis |
| Component dev | shadcn/ui CLI | Ejecuta scripts y copia componentes a tu repo | Gratis |
| Forms | React Hook Form | Standard de la industria para forms en React | Gratis |
| Cron / jobs | Supabase pg_cron | Incluido en Postgres de Supabase, no requiere otro servicio | Gratis |

**Costo total estimado para los primeros 10 clientes pagos:** USD 5 a 15/mes.

## Best practices por pieza del stack

Lo que sale de la investigación, ordenado por prioridad de implementación.

### Next.js 15 + App Router + Server Actions

Las prácticas críticas de seguridad para 2026 según docs oficiales:

**Tratá las Server Actions como endpoints HTTP públicos.** Una validación de auth en una `page.tsx` NO se extiende a las Server Actions definidas dentro. Cada action tiene que verificar auth/autorización por sí misma. Sin excepciones.

**Defense-in-depth, nunca confiar solo en middleware.** Una vulnerabilidad CVSS 9.1 fue divulgada en marzo 2025 (CVE-2025-29927) donde se podía bypassear auth de middleware con un header. Lección permanente: middleware es la primera línea de defensa, no la única. Validar también en cada Server Action y en cada Data Access Layer.

**Validar inputs siempre, en el server.** Los inputs llegan sucios (formularios pueden manipular). Validar con Zod antes de procesar. Nunca pasar `formData` directo a la DB.

**Data Access Layer separado.** Cada Server Action delega a una función en `queries.ts` o `actions.ts` del módulo. Auth/autorización + DB en un módulo dedicado, no inline en la action.

**Server Actions usan POST y validan Origin/Host.** Esto es nativo, no hay que hacer nada — pero entender que es el motivo por el que solo se llaman desde la misma origen.

**Sin Form Actions IDs en producción que no se usen.** Next.js elimina IDs de Server Actions no usadas del bundle del cliente. Tip: no exportar acciones que no se llamen desde un client component.

**Multi-tenancy en Next.js: path-based primero.** `app.com/team-x/dashboard` con dynamic segments. Subdomain (`team-x.app.com`) es más fancy pero requiere DNS extra. Empezamos con path-based; si llega un cliente Enterprise que pide subdomain propio, evaluamos.

### Supabase + Row Level Security

**RLS desde el día uno en TODAS las tablas.** No "lo agregamos después". Cada tabla tiene `consultora_id` y una policy que filtra por `auth.jwt() ->> 'consultora_id'`.

**Tenant ID en JWT claim, no en sesión cliente.** Custom claim que Supabase Auth Hook agrega al login. Cliente no puede modificarlo, base no puede ser engañada.

**Index obligatorio en `consultora_id` en todas las tablas.** Sin esto las queries son lentísimas. RLS sin index = problema de performance #1 de la categoría.

**Filtros explícitos además de RLS.** RLS implica un WHERE, pero el optimizer de Postgres aprovecha mejor un filtro explícito. Por ejemplo: `select().eq('consultora_id', user.consultora_id)` aunque RLS ya lo filtre. Mejor performance.

**`app_metadata` es seguro, `user_metadata` no.** Los roles del usuario van en `app_metadata` (lo controla la app, no el usuario). El nombre, idioma, preferencias en `user_metadata`.

**Service role key SOLO en server, jamás en cliente.** La service role key bypasea RLS — si llega al cliente es game over. Variables de entorno server-only.

**Función `security definer` para joins multi-tabla.** Cuando una policy requiere consultar varias tablas, hacer la consulta dentro de una función con `security definer` evita que cada lookup vuelva a chequear RLS en cascada.

### Anthropic Claude API

**Prompt caching para reducir 90% el costo del input.** Si vas a usar el mismo prompt sistémico (ej: el template de "sos un Lic. en HyS argentino") en muchos requests, cachearlo. Cambia `cache_control: { type: "ephemeral" }` en el bloque de mensaje. Costo de tokens cacheados es 10% del original.

**Batch API para 50% de descuento si no hace falta tiempo real.** Para procesos en background (informes nocturnos, generación masiva de checklists, OCR de documentos) usar Batch API: respuesta en ≤24h, 50% off. Para flujos interactivos (consultor hace clic en "Generar"), API normal.

**Modelo según complejidad de tarea.**
- **Haiku 4.5** (USD 1/USD 5 por MTok) para tareas simples: clasificación, resúmenes cortos, extracción de campos.
- **Sonnet 4.6** (USD 3/USD 15) para informes técnicos completos. **Es nuestro modelo principal.**
- **Opus 4.7** (USD 5/USD 25) solo para análisis complejos (ej: análisis de accidentabilidad con jerarquía de controles, comparación de versiones de norma con razonamiento profundo). Usar parsimoniosamente.

Detalle completo de IDs (snapshot pinned, alias, deprecación) en `docs/adr/0003-modelo-claude-default.md`.

**Cliente abstracto con wrapper.** Nunca llamar `new Anthropic()` directo desde una Server Action. Crear `src/shared/ai/client.ts` que wrappea el SDK con: rate limiting, retry exponential backoff, logging, métricas de tokens, posibilidad de cambiar de modelo dinámicamente. Si en Fase 5 cambia el provider, tocás un archivo.

**Exponential backoff + retry con jitter.** El SDK ya trae `maxRetries: 2` por default, pero para producción seria conviene custom retry con jitter para evitar thundering herd. Para tareas críticas, considerar 4-5 retries.

**Tracking de costos por consultora.** Cada llamada a Claude registra `consultora_id`, `model`, `input_tokens`, `output_tokens`. Permite ver quién consume cuánto y eventualmente cobrar por uso si el consumo desbalancea el modelo flat.

**Rate limiting propio antes del de Anthropic.** Definir límites por plan (Pro: X informes/día, Team: Y/día). Implementarlos en la app, antes de mandar a Claude. Esto protege a Claude de tu mal uso y a vos del bill sorpresivo.

### Testing

**Vitest para unit + integration.** Sintaxis casi idéntica a Jest, ESM nativo, mucho más rápido. Standard 2026.

**Playwright para E2E.** Ejecuta browsers reales (Chromium, Firefox, Webkit). Tests por flujo de usuario crítico, no por cada feature.

**Pirámide de tests.** Aproximadamente 70% unit, 20% integration, 10% E2E. Si la pirámide se invierte, los tests son lentos y frágiles.

**Tests obligatorios para:**
- Generadores de informe (cada tipo)
- Cálculo de fechas de vencimiento
- Detección de doble entrega EPP
- Lógica de RLS (test que un usuario de consultora A no ve datos de B)
- Auth y refresh de sesión

**Tests opcionales para:**
- Componentes de UI puramente presentacionales
- Páginas wrapper

**Coverage como métrica de soporte, no de objetivo.** Apuntar a > 70% en lógica de dominio, no en código de UI.

### CI/CD con GitHub Actions

**Pipeline mínimo en cada PR:**
1. `pnpm install` con cache
2. `pnpm typecheck` (TypeScript)
3. `pnpm lint` (ESLint)
4. `pnpm test:unit`
5. `pnpm test:integration` (con DB de test efímera)
6. `pnpm build` (Next.js)

**Branch `main` protegida.** No se puede pushear directo, todo va por PR con CI verde + 1 review (o auto-aprobado si trabajás solo, pero el CI debe pasar).

**Deploy automático a Vercel desde main.** Cero "subo a mano". Cualquier merge a main triggea deploy. Si hay un error, rollback con un click.

**E2E en staging, no en cada PR.** Los E2E son lentos. Ejecutarlos en deploy a staging, no en cada commit.

### Observabilidad

**Sentry desde el día uno con `release` por commit.** Permite asociar errores a versión específica de código.

**Logs estructurados con contexto.** Cada log incluye `consultora_id`, `user_id`, `request_id`. JSON en server, no `console.log` plano.

**Vercel Analytics para tráfico básico.** Gratis, sin cookies, suficiente para arrancar.

**Métricas custom para el negocio.** Cada vez que se genera un informe, se registra evento. Permite dashboards "informes por día", "consultora top consumidor", "tipo de informe más usado".

**Alertas en Sentry para errores con tasa > N/min.** No vivir mirando dashboards.

### Seguridad

**Secrets solo en variables de entorno cifradas (Vercel).** Nunca en repo, nunca en cliente.

**Rate limiting por endpoint y por usuario.** Especialmente en `/api/generate-*` y `/api/auth/*`.

**Validación Zod en cada Server Action.** Repetir hasta el cansancio: el cliente miente.

**Audit log inmutable.** Tabla `audit_log` que registra: firmar informe, eliminar empleado, cambio de plan, acceso a datos sensibles. Append-only, sin update/delete.

**Cookies httpOnly + SameSite Lax + Secure.** Auth cookies no accesibles desde JS, no se mandan en cross-site.

**Política de privacidad clara, conforme Ley 25.326 (Argentina).** Datos personales (CUIL, DNI, foto, firma) tratados como sensibles. Derecho de eliminación, consentimiento explícito.

### Documentación

**README por módulo en `src/modules/*/README.md`.** Qué hace, qué expone, qué consume, ejemplos básicos de uso.

**ADRs (Architecture Decision Records) en `docs/adr/`.** Una por decisión arquitectónica importante. Formato Michael Nygard:
- Contexto: por qué surge la decisión
- Opciones evaluadas: qué consideramos
- Decisión tomada: qué elegimos
- Consecuencias: lo bueno, lo malo, lo desconocido

**JSDoc en funciones públicas.** Especialmente las de `actions.ts` y `queries.ts` de cada módulo.

**OpenAPI generado automático para endpoints públicos.** Cuando lleguemos a Plan Enterprise con API, exponer un Swagger UI. Por ahora opcional.

**CLAUDE.md actualizado.** El archivo raíz que cualquier agente de IA lee primero. Tiene que estar siempre al día con lo que es real en el repo, no con lo que pensábamos hace 3 meses.

## Patrones específicos que vamos a aplicar

### Pattern 1 — Server Action con auth, validación, action

Plantilla universal para mutations:

```typescript
// src/modules/informes/actions.ts
'use server'

import { z } from 'zod'
import { createClient } from '@/shared/supabase/server'
import { Anthropic } from '@anthropic-ai/sdk'

const GenerarInformeSchema = z.object({
  tipo: z.enum(['ruido', 'iluminacion', 'pat', 'rgrl', 'cargafuego']),
  cliente_id: z.string().uuid(),
  datos: z.record(z.unknown()),
  prompt_custom: z.string().max(5000).optional(),
})

export async function generarInforme(input: unknown) {
  const supabase = await createClient()

  // 1. Auth check (siempre, no confiar en middleware)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('UNAUTHORIZED')

  // 2. Validar input
  const datos = GenerarInformeSchema.parse(input)

  // 3. Rate limiting
  await checkRateLimit(user.id, 'generar_informe')

  // 4. Lógica de negocio (delega a service)
  const informe = await informesService.generar(user, datos)

  // 5. Log de auditoría
  await auditLog.append({ accion: 'informe.generar', user, datos })

  return informe
}
```

### Pattern 2 — Repository con tipos generados

```typescript
// src/modules/informes/queries.ts
import { Database } from '@/shared/supabase/types'

export async function getInformesByConsultora(consultora_id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('informes')
    .select('*, cliente:clientes(*)')
    .eq('consultora_id', consultora_id)  // RLS lo filtra igual, pero explícito mejora performance
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}
```

### Pattern 3 — Cliente IA abstracto

```typescript
// src/shared/ai/client.ts
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

export async function generateWithClaude(opts: {
  model: 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6' | 'claude-opus-4-7'
  systemPrompt: string  // cacheable
  userPrompt: string
  consultora_id: string
}) {
  const start = Date.now()
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 4000,
    system: [{
      type: 'text',
      text: opts.systemPrompt,
      cache_control: { type: 'ephemeral' }  // 90% off cached input
    }],
    messages: [{ role: 'user', content: opts.userPrompt }]
  })

  // Track cost por consultora
  await trackUsage({
    consultora_id: opts.consultora_id,
    model: opts.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    cached_tokens: response.usage.cache_read_input_tokens,
    duration_ms: Date.now() - start,
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}
```

## Próximos pasos

Con este documento como base de qué herramientas usamos y qué patrones aplicamos, los siguientes documentos técnicos pueden referirlo:

1. `01-principles.md` — los principios rectores no negociables
2. `02-architecture.md` — arquitectura modular completa, módulos, dependencias
3. `03-data-model.md` — schema completo, RLS policies
4. `04-folder-structure.md` — organización del repo
5. `05-coding-standards.md` — convenciones
6. `06-testing-strategy.md` — qué testeamos cómo
7. `07-security.md` — auth, secrets, OWASP, audit
8. `08-observability.md` — logs, métricas, alertas
9. `09-cicd.md` — pipeline, deploy
10. `10-roadmap.md` — implementación por módulos

## Sources

- [Next.js 15 Security Best Practices Guide 2026](https://www.authgear.com/post/nextjs-security-best-practices/)
- [Next.js Multi-Tenant Guide](https://nextjs.org/docs/app/guides/multi-tenant)
- [Supabase RLS Best Practices](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
- [Row Level Security in Supabase with Next.js (2026)](https://blog.starmorph.com/blog/row-level-security-supabase-tables-nextjs)
- [Anthropic API Pricing 2026](https://www.finout.io/blog/anthropic-api-pricing)
- [Claude API Developer Guide 2026](https://apiscout.dev/guides/anthropic-claude-api-complete-developer-guide-2026)
- [Anthropic Compute Updates May 2026](https://letsdatascience.com/news/anthropic-increases-claude-code-and-api-usage-limits-735fd0ac)
