# Análisis completo · ConsultoraDemo vs mercado argentino HyS

> Fecha: 2026-05-23 · Autor: análisis Claude Code · Benchmark: [Previo](https://previo-ar.vercel.app/landing).
>
> Este documento es un análisis interno. No edita código. Toda recomendación entra al backlog vía ticket.

## 1. Executive Summary

Cinco hallazgos, en orden de importancia:

1. **El mercado argentino de software HyS tiene densidad competitiva media-baja: 6-7 players reales activos, y solo 2 publican precios públicos** (Previo $35k-$179k ARS/mes y GENESIS Broker $32,9k-$53,3k ARS/mes por usuario). El resto (SIGHyS, Previnnova, SEHIGIENE, Smart Safety, EHS Tool) opera con "pedí cotización", apuntando a empresas medianas/industriales, NO al consultor freelance. **Hay hueco real para una propuesta de consumo simple, pricing público accesible, foco freelance.**
2. **Previo me lleva entre 3 y 5 meses de ventaja funcional** en EPP, capacitaciones, exámenes médicos, índices SRT (Res 463/09), IPER, cronograma CIIU y módulos SGSST ISO 45001. Hoy ConsultoraDemo cubre **aproximadamente el 25-30% de la superficie de features de Previo**. Pero Previo es código congelado en stack desconocido y sin IA generativa, mientras vos tenés una base modular limpia (Next 16 + Supabase RLS + Claude 4.6) que escala mejor en 12 meses.
3. **Tu única ventaja real defendible hoy es la generación de informes con IA streaming sobre 5 tipos genéricos + el calendario con notificaciones email/Telegram/push web.** Ningún competidor argentino tiene ese loop. Previnnova menciona "asistente IA" pero es Q&A sobre documentos, no generación. Eso es **lo único que tenés que clavar antes de lanzar**; sin eso, sos un Previo más feo y con menos features.
4. **El módulo Pagos está a medio hacer** (T-070..T-074: schema + webhook MP + dunning emails). Sin esto cerrado, no podés cobrar y todo el resto del análisis es académico. Es el bloqueante #1 del MVP.
5. **Riesgo crítico latente que nadie te avisó**: la tabla `empleados` arranca con `cliente_id` obligatorio (T-052/T-053) pero la UI no existe (T-054 next). Si lanzás sin UI de empleados, el flujo de EPP (Res SRT 299/11), exámenes médicos y capacitaciones queda muerto. **No hay producto vendible sin empleados + EPP mínimo.** No la cagues priorizando "informes con IA con 3 tipos más" antes de cerrar empleados.

Recomendación de una línea: **cerrá el trial → suscripción MP → trial expira → bloqueo, sumá EPP con planilla 299/11 + alertas de vencimiento, mantené la IA como diferenciador, salí a la calle por WhatsApp + grupos AHRA.** Lo demás postergable.

---

## 2. Radiografía de tu proyecto (Fase 1)

### 2.1 Stack técnico

Verificado en [package.json](package.json):

- **Frontend / Framework**: Next.js 16.2.6 (App Router) + React 19.2 + TypeScript strict.
- **UI**: Tailwind 4 + shadcn/ui (Radix UI primitives) + lucide-react + sonner.
- **Formularios**: react-hook-form 7.75 + zod 4.4 + @hookform/resolvers.
- **Backend**: Server Actions + Route Handlers en Next.js (no API externa).
- **Base de datos**: Supabase (Postgres + RLS + Auth + Storage) + 28 migrations aplicadas.
- **IA**: Anthropic SDK 0.95 (`@anthropic-ai/sdk`) — Claude Sonnet 4.6 con streaming SSE ([src/shared/ai/anthropic.ts](src/shared/ai/anthropic.ts), [src/shared/ai/stream.ts](src/shared/ai/stream.ts)).
- **Notificaciones**: Resend 6.12 (email) + Telegram Bot API + web-push 3.6 (VAPID).
- **Pagos**: Mercado Pago (cliente custom en [src/shared/mercadopago/](src/shared/mercadopago/)) — **a medio hacer** (T-070..T-074 en operativo).
- **PDFs**: puppeteer-core 23.11 + Chromium-alpine en el VPS para `/print` SSR de informes.
- **Observabilidad**: Sentry 10.52 + pino 10.3.
- **Rate limiting**: @upstash/ratelimit 2.0 + @upstash/redis (probable: cron + webhooks).
- **Hosting**: VPS Hostinger + EasyPanel + Docker (Node 22 alpine, ~600 MB) — ADR-0007.
- **Tests**: Vitest 3.2 (unit + component + integration) + Playwright 1.59 (E2E chromium).
- **CI/CD**: GitHub Actions + Auto Deploy EasyPanel webhook.

**Observación de stack**: el setup es **maduro y profesional para un MVP**, no es código de fin de semana. Pre-commit hooks + husky + lint-staged. Coverage v8. Backup de Storage. Smoke runbooks en `docs/operations/`. Esto es ventaja competitiva no tan obvia pero real frente a competidores con stacks legacy (HST Custombit = Windows desktop).

### 2.2 Funcionalidades implementadas

Mapeado leyendo [src/app/](src/app/), [src/modules/](src/modules/) (no existe — se eligió no separar módulos, todo vive en `src/app/(app)/` + `src/shared/`), [docs/sprints/](docs/sprints/) y migrations. Hay **438 archivos TS/TSX + 28 migrations SQL**.

| Capacidad | Estado | Evidencia |
|---|---|---|
| Auth (signup + login + magic link + recovery + logout) | ✅ Completo | [src/app/(auth)/](src/app/(auth)/), [src/app/auth/callback/route.ts](src/app/auth/callback/route.ts), [src/app/cambiar-password/](src/app/cambiar-password/), [src/app/recuperar-password/](src/app/recuperar-password/) |
| Multi-tenancy + RLS + JWT custom claim `consultora_id` | ✅ Completo | [supabase/migrations/20260511130757_rls_helpers.sql](supabase/migrations/20260511130757_rls_helpers.sql), [20260511134455_auth_hook_custom_claim.sql](supabase/migrations/20260511134455_auth_hook_custom_claim.sql) |
| Audit log inmutable + triggers `audit_*` por tabla | ✅ Completo | Patrón replicado en cada migration de dominio |
| Informes (5 tipos: `rgrl` / `relevamiento` / `capacitacion` / `accidente` / `otros`) | ✅ Core completo, sin IPER ni mediciones específicas | [src/shared/templates/](src/shared/templates/), [src/app/(app)/informes/](src/app/(app)/informes/), [src/shared/ai/prompts/](src/shared/ai/prompts/) |
| Generación IA streaming SSE con prompt por tipo | ✅ | [src/app/api/informes/[id]/generate-stream/route.ts](src/app/api/informes/[id]/generate-stream/route.ts), [src/shared/ai/stream.ts](src/shared/ai/stream.ts) |
| Editor markdown + publish workflow (draft → published → archived) | ✅ | [src/app/(app)/informes/[id]/page.tsx](src/app/(app)/informes/[id]/page.tsx) |
| Export PDF con branding (logo + color consultora) | ✅ | [src/app/api/informes/[id]/pdf/route.ts](src/app/api/informes/[id]/pdf/route.ts), [src/app/(print)/informes/[id]/print/](src/app/(print)/informes/[id]/print/), [src/shared/pdf/](src/shared/pdf/) |
| Attachments (fotos adjuntas al informe) | ✅ | [src/app/(app)/informes/[id]/attachments/](src/app/(app)/informes/[id]/attachments/) |
| Clientes (CRUD + search + archive + autocomplete en informes) | ✅ Completo (T-047..T-051) | [src/app/(app)/clientes/](src/app/(app)/clientes/), [supabase/migrations/20260517235110_clientes.sql](supabase/migrations/20260517235110_clientes.sql) |
| Empleados (schema + server actions + queries) | ⚠️ Backend listo, **UI pendiente T-054** | [supabase/migrations/20260519114309_empleados.sql](supabase/migrations/20260519114309_empleados.sql), [src/app/(app)/empleados/actions.ts](src/app/(app)/empleados/actions.ts) |
| Calendario de vencimientos + scheduling | ✅ Completo | [supabase/migrations/20260514125515_calendar_events.sql](supabase/migrations/20260514125515_calendar_events.sql), [src/app/(app)/calendario/](src/app/(app)/calendario/), [src/shared/calendar/scheduling.ts](src/shared/calendar/scheduling.ts) |
| Notificaciones email (Resend) + Telegram + Web Push VAPID | ✅ Completo | [src/shared/notifications/](src/shared/notifications/), [src/app/api/webhooks/telegram/](src/app/api/webhooks/telegram/), [src/shared/push/](src/shared/push/) |
| Cron pg_cron para alertas de vencimientos próximos | ✅ Completo | [supabase/migrations/20260515095701_notifications_infrastructure.sql](supabase/migrations/20260515095701_notifications_infrastructure.sql), [src/app/api/calendar/dispatch-reminder/route.ts](src/app/api/calendar/dispatch-reminder/route.ts) |
| Pagos Mercado Pago (suscripciones + webhook + dunning) | 🚧 En curso T-070..T-074 | [supabase/migrations/20260520000001_t070_pagos_schema.sql](supabase/migrations/20260520000001_t070_pagos_schema.sql), [src/app/api/webhooks/mercadopago/route.ts](src/app/api/webhooks/mercadopago/route.ts), [src/shared/mercadopago/](src/shared/mercadopago/), [src/shared/billing/](src/shared/billing/) |
| Trial 7 días + bloqueo features pagas | 🚧 Schema listo (`trial_hasta`), gate en [src/shared/billing/access.ts](src/shared/billing/access.ts) | Operativo, pero UI de billing recién en T-045 (no mapeado a real) |
| Settings (consultora + logo + notificaciones + Telegram link) | ✅ Completo | [src/app/(app)/settings/](src/app/(app)/settings/) |
| Páginas legales (privacidad + términos) | ✅ | [src/app/privacidad/](src/app/privacidad/), [src/app/terminos/](src/app/terminos/) |
| Health check + monitoring + uptime | ✅ | [src/app/api/health/route.ts](src/app/api/health/route.ts), [docs/operations/uptime-monitoring.md](docs/operations/uptime-monitoring.md) |
| Styleguide interno | ✅ | [src/app/styleguide/](src/app/styleguide/) |

### 2.3 Features a medio hacer / faltantes críticos

- **Empleados UI** ([src/app/(app)/empleados/](src/app/(app)/empleados/) tiene `actions.ts` y `queries.ts` pero `page.tsx` está pendiente de T-054). Sin UI no se da de alta empleados → no hay EPP → no hay planilla 299/11 → no hay producto vendible para HyS.
- **EPP completo**: no existe módulo. Es bloqueante porque Previo lo tiene como pilar. Roadmap legacy T-049..T-056 lo tenía agendado pero los numbers se renumeraron al Sprint 4 Clientes/Empleados; el módulo EPP real no está iniciado.
- **Pagos**: webhook + schema OK pero falta el flujo de checkout limpio + bloqueo end-to-end + UI `/facturacion`. T-071-FU3/FU4 todavía abiertos según commits recientes.
- **Onboarding interactivo + tour** (T-067): no existe. Un consultor nuevo va a perderse.
- **IPER / Matriz de riesgos**: no existe módulo, no es uno de los 5 tipos de informe. Previo lo tiene.
- **Índices SRT** (Res 463/09: IF, IG, PESE, Incidencia, Duración Media, etc.): no existe. Previo lo destaca como pilar.
- **Cronograma de cumplimiento por CIIU** (53 obligaciones Dec 351/911/617): no existe. Previo lo tiene.
- **Capacitaciones módulo dedicado** (Res 905/15): hay tipo de informe `capacitacion` pero no hay padrón de asistencia, alertas de renovación 12m, ni constancias firmadas.
- **Exámenes médicos** (preocupacional / periódico / egreso, Res 37/10): no existe.
- **Importación masiva CSV** de empleados o clientes: no existe. Friction alta para consultor con 10 clientes y 200 empleados.
- **Marca blanca completa**: el branding existe (`consultora_logo`, color) en informes, pero no es un "plan superior" diferenciado vs el plan base — todos los planes tienen branding por igual. No es problema técnico, es decisión comercial.

### 2.4 Decisiones de arquitectura notables (lo bueno)

- **Multi-tenant con JWT custom claim + helpers RLS reusables** ([supabase/migrations/20260511143906_rls_helpers_claim_fast_path.sql](supabase/migrations/20260511143906_rls_helpers_claim_fast_path.sql)). Fast-path en cada policy → query directa del claim sin JOIN. Esto es **mejor que el promedio del mercado argentino** que probablemente usa app-layer tenancy o subqueries inline (lo cual es bug factory).
- **Audit log inmutable con triggers AFTER por tabla** + diff guard por columnas mutables. Cumple parcialmente ISO 45001 cláusula 7.5.3 sin esfuerzo extra.
- **Discriminated unions en server actions** ([src/app/(app)/clientes/actions.ts](src/app/(app)/clientes/actions.ts), [src/app/(app)/empleados/actions.ts](src/app/(app)/empleados/actions.ts)): código tipo-seguro, UX de errores fina (`DUPLICATE_CUIT`, `CLIENTE_NOT_FOUND_OR_FORBIDDEN`, `INVALID_INPUT` con `fieldErrors`).
- **Streaming SSE para IA** ([src/app/api/informes/[id]/generate-stream/route.ts](src/app/api/informes/[id]/generate-stream/route.ts)): UX percibida 3x mejor que un POST que tarda 30s. Previo seguro no tiene esto (no usa IA generativa).
- **Templates registry split client/server/print** ([src/shared/templates/registry/](src/shared/templates/registry/)): permite agregar tipos nuevos sin tocar core. Buen patrón forward.
- **Smoke runbooks operativos** en [docs/operations/](docs/operations/): vos podés debuguear producción de noche. Esto es ventaja real frente a competencia que probablemente no tiene runbooks.

### 2.5 Decisiones que te limitan (lo malo)

- **No tenés tabla `establecimientos`** (sedes por cliente). El comentario en la migration empleados dice "MVP asume 1 sede por cliente (95% PYME)". Aceptable para PYME chica, pero el cliente industrial mediano de 2-5 plantas no entra. **No es bloqueante hoy.**
- **No tenés tabla `puestos` ni catálogo de EPP por puesto**. Previo lo tiene. Cuando armes EPP vas a necesitar `puestos` para sugerir EPP por puesto (que el roadmap real T-056 tenía pero quedó renumerado).
- **El branding/marca blanca es flat**: el logo del PDF es el mismo logo de la consultora. Si querés vender "Plan Consultor Pro" estilo Previo $179k que incluye marca blanca, vas a tener que diferenciar a nivel UI/PDF.
- **No tenés sistema de roles fino** (admin / consultor senior / consultor junior / asistente). Hoy es `owner` vs `member`. Suficiente para Plan Pro (un higienista freelance solo), insuficiente para Plan Team Fase 2.
- **No tenés API pública**: el roadmap Fase 2 lo menciona. No urgente para MVP pero sí para Enterprise.
- **No tenés PWA / offline / mobile-first**. Fase 3 del roadmap, pero **este es tu mayor hueco vs realidad del consultor de obra** (Dec 911/96 construcción → consultor sin conexión en planta). Detallo en sección 6.

---

## 3. Mapa del mercado argentino (Fase 2)

### 3.1 Competidores SaaS argentinos directos

Verifiqué 7 SaaS argentinos con presencia activa hoy. Lo que cada uno tiene cubierto está marcado contra la grilla de features de Previo.

| Competidor | URL | Ubicación | Tipo | Precio (ARS/mes) | Pricing público | IA generativa | Index SRT 463 | Multi-empresa | Target |
|---|---|---|---|---|---|---|---|---|---|
| **Previo** | [previo-ar.vercel.app](https://previo-ar.vercel.app/landing) | Rosario | SaaS Cloud | $35k / $79k / $179k | ✅ | ❌ | ✅ 8 índices | ✅ ilimitadas (Pro) | Higienista freelance + estudios |
| **GENESIS Broker** | [genesisbroker.com.ar](https://genesisbroker.com.ar/) | Buenos Aires | SaaS Cloud | $32,9k / $42,5k / $53,3k por user + IVA | ✅ | ❌ | Parcial (matrices) | ✅ | Profesional independiente + empresas |
| **SIGHyS** | [sighys.com.ar](https://sighys.com.ar/) | Córdoba | SaaS Cloud | "Solicitar demo" | ❌ | ❌ | ❌ (no menciona Res 463) | ✅ ("Gestionar todas las empresas") | Consultoras + industrias + municipios |
| **Previnnova** | [previnnova.com.ar](https://www.previnnova.com.ar/) | AMBA/CABA | SaaS Cloud | "Personalizado" | ❌ | ⚠️ Asistente Q&A (no generación) | ❌ | ✅ multi-sede | PYMEs + industrias + construcción |
| **SEHIGIENE** | [sehigiene.com](https://www.sehigiene.com/) | Rosario | SaaS Cloud | "Solicitar info" | ❌ | ❌ | ❌ (menciona Res 84/12, 85/12, 886/15) | ❌ (foco intra-empresa) | Empresas (no foco consultor) |
| **Smart Safety** | [smartsafety.com.ar](https://smartsafety.com.ar/software/) | Argentina | SaaS Cloud | "Solicitar demo" | ❌ | ❌ | ❌ | ❌ (foco planta industrial) | Empresas industriales medianas/grandes |
| **HST Custombit** | [custombit.com.ar](https://www.custombit.com.ar/programas-higiene-seguridad/) | Argentina | Desktop Windows | USD 250 / $370k (licencia única) | ✅ | ❌ | ❌ (foco carga fuego + medios escape) | ❌ | Profesional HyS individual |

Otros laterales (no compiten directo, fuera de scope):

- [Safetynova](https://safetynova.com/digitalizacion/) — origen consultora 2015, plataforma genérica de inspecciones, NO foco AR-específico, sin pricing público (modelo freemium opaco). Compite contra Previo en inspecciones, no contra nosotros en generación de informes.
- [EHS Tool / EHS Department](https://ehsdepartment.com/) — foco ISO 45001 enterprise, genérico LATAM.
- [Genesis Broker variante BITH](https://bith.com.ar/genesis-un-software-de-hys-para-la-gestion/) — el mismo GENESIS, comercializado por BITH.

**Comparación 1-a-1 contra grilla Previo de los 4 más cercanos:**

| Feature Previo | Previo | GENESIS | SIGHyS | Previnnova | SEHIGIENE |
|---|---|---|---|---|---|
| Multi-empresa / multi-cliente | ✅ ilimitado Pro | ✅ | ✅ | ✅ | ❌ |
| 8 índices SRT (Res 463/09) | ✅ | Parcial (reportes) | ❌ | ❌ | Parcial (siniestralidad) |
| Importación PDF/Excel listado ART | ✅ | ❌ | ❌ | ❌ | ❌ |
| Legajo digital empleados + import Excel | ✅ + Excel | ✅ | ✅ | ✅ | ✅ |
| Siniestros / accidentes / cuasi-accidentes | ✅ | ✅ | ✅ | ✅ | ✅ |
| EPP con alertas 30d | ✅ | Parcial | ✅ | ✅ | ✅ |
| Capacitaciones (Res 905/15) | ✅ | ✅ | ✅ (e-learning) | ✅ | ✅ |
| Exámenes médicos PDF | ✅ | ❌ | ✅ | ❌ | ✅ |
| Matriz Riesgos (IPER) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Cronograma CIIU (53 obligaciones) | ✅ | Parcial (programa anual) | ❌ | ✅ por sede | ❌ |
| SGSST ISO 45001 (7 módulos) | ✅ | ✅ | ✅ | ❌ explícito | ❌ |
| Informes PDF con marca blanca | ✅ (Pro $179k) | ✅ | ✅ | ✅ | ✅ |
| IA generativa de informes | ❌ | ❌ | ❌ | ⚠️ Q&A asistente | ❌ |
| Streaming en vivo del LLM | ❌ | ❌ | ❌ | ❌ | ❌ |
| Móvil app nativa / PWA offline | ❌ explícito | ❌ | ❌ | ❌ | ❌ |
| Captación WhatsApp visible | ✅ +543464499828 | ✅ +5491178302603 | ✅ +543563 / +543541 | ✅ | ❌ |
| Trial gratuito sin tarjeta | ✅ 30d | ❌ explícito | ❌ explícito | ❌ explícito | ❌ |

**Calidad UX inferida** (basada en landings, no probé los productos):

- **Previo**: landing limpia con tabla de planes pública. Mejor posicionamiento higienista freelance del grupo. Pricing claro.
- **GENESIS Broker**: landing densa pero info clara. Pricing por user **caro para freelance** ($53,3k por usuario = ~USD 50/user/mes, contra USD 30 plan completo tuyo).
- **SIGHyS**: landing más "corporativa" (Córdoba). Sin pricing público. Mostraron mockups de dashboard analytics.
- **Previnnova**: copy "pack ART exportable" es **muy fuerte** para vender a higienistas que sufren auditorías. Vale la pena mirar de cerca.
- **HST Custombit**: estética 2010, desktop Windows. **No es competencia real**: target nicho cargas de fuego.

### 3.2 Automatizaciones puntuales argentinas (no SaaS completos)

- **Plantillas Excel con macros para índices SRT**: dispersas en blogs (`prevencionar.com`), en universidades (UTN), en el portal SRT mismo ([acc_indicadores_anuales.php](https://www.srt.gob.ar/estadisticas/acc_indicadores_anuales.php)). El SRT publica matrices Excel oficiales ([Protocolo Ergonomía](https://www.srt.gob.ar/wp-content/uploads/2016/04/AnexoI-ProtocoloDeErgonomia.xls), [Res 886 IFR](https://www.cie.gov.ar/web/images/Planillas_Res-886.xls)) — los higienistas las usan tal cual.
- **MercadoLibre / Tiendanube**: hay listings de "Software Seguridad Higiene" y "Programa Seguridad e Higiene" — pero no son productos identificables, mayoría son repackagings de plantillas Excel o cursos. **No vi un SaaS argentino vendido en ML que compita directo**.
- **Plantillas Res 299/11 (entrega EPP)**: ampliamente disponibles en blogs como [higieneyseguridadlaboralcvs.wordpress.com](https://higieneyseguridadlaboralcvs.wordpress.com/2012/07/15/formulario-entrega-de-ropa-de-trabajo-y-elementos-de-proteccion-personal-srt-resol-29911/). El consultor las llena a mano.
- **Bots WhatsApp / scrapers SRT / integraciones ART**: no encontré ningún proveedor activo público haciendo esto. Hueco de mercado.
- **No verificado**: existencia de plantillas IPER específicas vendidas en Hotmart/Workana. Probablemente sí pero baja escala.

### 3.3 Comunidades + formadores de opinión argentinos

- **AHRA (Asociación de Higienistas de la República Argentina)** — [ahra.org.ar](https://ahra.org.ar/), [LinkedIn](https://www.linkedin.com/company/ahraasociacionargentina/), Facebook, Instagram. La red profesional más grande. **Es donde tenés que estar.**
- **EDUCAHRA** — brazo educativo de AHRA, cursos online y presenciales.
- **IV Jornadas de Higiene Ocupacional y Ambiental** ([ahra.org.ar/j4/](https://ahra.org.ar/j4/)) — evento clave anual.
- **Primer Foro Federal de Profesionales HyS** (organizado por SRT en Manzana de las Luces). Anual.
- **Colegios provinciales** (CPIA Corrientes hizo convenio con GENESIS Broker — [cpiaya.org.ar/convenio-con-genesis-broker/](https://cpiaya.org.ar/convenio-con-genesis-broker/)). **Esta es la jugada táctica que tenés que copiar**: convenio comercial con colegio provincial = distribución capturada.
- **Asesoría Laboral, IRAM, UTN, UAI, IAS** — formadores opinión, cursos donde el consultor se actualiza.
- **Prevencionar.com** — portal LATAM hispanohablante, indexa noticias de Argentina pero no es argentino.
- **No verificado**: existencia de grupos Facebook / WhatsApp grandes específicos AR. Probablemente existen 5-10 grupos chicos (50-500 miembros) pero no son indexables en search.

### 3.4 Top dolores recurrentes del higienista argentino

Inferidos de landings de competencia (qué problema venden resolver) + conocimiento del dominio en `docs/discovery/01-mercado.md`. **No tuve acceso a foros/grupos cerrados**, así que es 80% inferencia razonable + 20% del expert interview tuyo.

| # | Dolor | Frecuencia inferida | Previo lo resuelve | Otro lo resuelve mejor |
|---|---|---|---|---|
| 1 | "Se me pasó el vencimiento del EPP / capacitación / examen médico y me comieron una multa" | Altísima | ✅ Alertas | SIGHyS también |
| 2 | "Hacer cada informe técnico me lleva 2-4 hs entre datos + redacción" | Altísima | ❌ (lo hace a mano) | **Nadie en AR** → tu hueco |
| 3 | "Cuando viene ART o auditoría tengo que armar el legajo en 1 día y se me dispersan papeles" | Alta | ✅ Repositorio | Previnnova lo vende fuerte ("pack ART") |
| 4 | "Tengo 5-15 clientes y los manejo en Excels distintos, no sé qué cliente está al día" | Alta | ✅ Multi-empresa | GENESIS, SIGHyS, Previnnova también |
| 5 | "Calcular los 8 índices SRT cada año es repetitivo y propenso a error" | Alta | ✅ Automático | Parcial GENESIS |
| 6 | "Tengo que ir a la planta sin conexión y volver a tipear todo a la noche" | Media-alta (construcción y rural) | ❌ Explícito | Safetynova parcial (forms móviles) |
| 7 | "Mis clientes PYME no entienden por qué les facturo $80k/mes y quieren ver lo que hago" | Media | ⚠️ Marca blanca Pro | Previo Pro |
| 8 | "El protocolo de ruido/iluminación lo redacto desde una plantilla Word que tengo guardada" | Alta | ❌ | **Nadie** → tu hueco IA |
| 9 | "RGRL anual es 40 páginas y odio hacerlo cada año en marzo" | Altísima (1 vez al año) | Parcial | **Nadie** → tu hueco IA |
| 10 | "El cliente quiere ver dashboard de cumplimiento, no PDFs sueltos" | Media | ✅ Dashboard | SIGHyS lo destaca |

**Implicancia para vos**: los dolores #2, #8 y #9 son el **único hueco real defendible** que no resuelve nadie en Argentina hoy. Es exactamente donde tu IA pega. Si la generación de IA es buena, te van a perdonar que falte algo de EPP en el MVP. Si la IA es mala, vas a ser un Previo más feo.

---

## 4. Análisis comparativo (Fase 3)

### 4.1 Matriz de features (Mi SaaS vs Previo vs Competencia)

Criticidad MVP: **Must** = imprescindible Ola 1 · **Should** = Ola 2 · **Could** = Ola 3 · **Won't** = Fase 2+.

Esfuerzo: **S** ≤ 1 día · **M** = 2-5 días · **L** = 1-2 semanas · **XL** > 2 semanas.

| Feature | Previo | Mi SaaS hoy | Mejor competidor AR que la tiene | Gap | Esfuerzo | Criticidad MVP |
|---|---|---|---|---|---|---|
| Multi-empresa (cartera de clientes) | ✅ | ✅ (T-047..T-051) | GENESIS, SIGHyS | Cubierto | — | Must ✅ |
| Legajo digital empleados | ✅ + CSV import | ⚠️ Schema OK, UI pendiente T-054 | GENESIS, SIGHyS | UI 3-5d + CSV import 1-2d | M | **Must** |
| EPP entregas + alertas 6m (Res 299/11) | ✅ | ❌ | SIGHyS, Previnnova | Schema + actions + UI + firma + planilla PDF | **XL (3 semanas)** | **Must** |
| Capacitaciones módulo dedicado | ✅ | ⚠️ Tipo informe `capacitacion` solo | SIGHyS (e-learning), GENESIS | Padrón asistencia + renovación 12m + constancia | L | Should |
| Exámenes médicos (preocupacional / periódico) | ✅ | ❌ | SEHIGIENE, SIGHyS | Schema + alertas + PDF | L | Should |
| IPER (matriz riesgos) | ✅ | ❌ | Todos | Schema + UI + heatmap | L | Should |
| 8 índices SRT (Res 463/09) automáticos | ✅ | ❌ | Parcial GENESIS | Cálculo + dashboard + export | M (con datos) | Should |
| Cronograma CIIU Dec 351/911/617 | ✅ | ❌ | Parcial Previnnova | Catálogo CIIU + 53 obligaciones + ticking | L | Could |
| Siniestros / accidentes / cuasi-accidentes | ✅ | ⚠️ Tipo `accidente` informe | Todos | Tabla `incidentes` con seguimiento → no es informe | M | Should |
| SGSST 7 módulos ISO 45001 | ✅ Plan Pro | ❌ | SIGHyS, GENESIS, EHS Tool | Auditorías + revisión dirección + plan emergencias + MOC + comité mixto | **XL (4+ semanas)** | **Won't MVP** |
| Importación PDF/Excel listado ART | ✅ | ❌ | Nadie | Parser + reconciliación | L | Could |
| Marca blanca PDF (logo + color) | ✅ Pro | ✅ Todos los planes | Pro de varios | Diferenciar por plan | S | Could |
| Notificaciones email + Telegram + Push Web | Email | ✅ los 3 + cron | Email/email | **Tu ventaja** | — | ✅ |
| **IA generativa informes (5 tipos)** | ❌ | ✅ | ⚠️ Previnnova Q&A | **Tu ventaja única** | — | ✅ |
| **Streaming SSE en vivo del LLM** | ❌ | ✅ | ❌ | **Tu ventaja única** | — | ✅ |
| Trial 7d sin tarjeta + bloqueo | ✅ 30d | 🚧 T-070..T-074 | Previo | Cerrar Pagos MP end-to-end | M | **Must** |
| Pricing público accesible | ✅ ARS | ❌ aún sin landing | Previo, GENESIS, HST | Landing planes + checkout | M | **Must** |
| PWA offline mobile-first | ❌ | ❌ | Safetynova parcial | Service worker + IndexedDB + queue sync | XL | **Won't MVP** (Fase 3) |
| Firma digital en pantalla (canvas) | Parcial | ❌ | Kizeo (no AR) | Canvas + storage + PDF embed | M | Should |
| Onboarding tutorial primer login | Parcial | ❌ | — | Hotspots + checklist | M | Should |
| Audit log inmutable (cumplimiento ISO 45001) | No verificado | ✅ desde día 1 | Inferible en otros | **Tu ventaja silenciosa** | — | ✅ |

**Estimación cobertura: ~25-30% de Previo en superficie de features**. Pero el 25% que tenés cubierto incluye **lo único que ellos NO tienen** (IA + streaming).

### 4.2 Diagnóstico estratégico

**¿Tu propuesta es igual a Previo, una variante o algo distinto?**

Es una **variante con un diferenciador fuerte (IA) y un foco más estrecho**. Hoy estás clonando 25% de Previo. El riesgo es que termines clonando el otro 75% y perdés la diferenciación → quedás como un Previo más nuevo pero peor. **No clones Previo. Construí el producto IA-first y meté solo lo que es bloqueante para vender.**

**Decisiones técnicas que te limitan vs Previo:**

- Sin `establecimientos` → no servís industriales 2+ plantas (low impact PYME, high impact mediana).
- Sin importación CSV → fricción onboarding alta cuando el consultor llega con 5 clientes y 100 empleados.
- Sin ningún módulo ISO 45001 → no podés cobrar plan "ISO 45001" estilo Previo $79k. **No es problema MVP.**
- Sin PWA → competidores tampoco la tienen, pero es tu chance de ganar construcción (Dec 911/96).

**Decisiones técnicas que te dan ventaja vs Previo:**

- Stack moderno + RLS multi-tenant maduro + audit log + tests + CI/CD + observabilidad → escala mejor a 12 meses, soporte productivo más barato.
- IA generativa nativa con streaming → loop UX que ningún competidor AR tiene.
- Telegram + Push Web → diferenciación frente a "email only" de la competencia.
- Pricing en USD 30/mes vs ARS volátil → reduce fricción al alza inflación.
- Code base reviewable + docs vivas → si tomás un developer en Fase 2, lo incorporás en 1 semana.

**% de Previo cubierto**: 25-30%. **Criterio explícito**: cuento como "cubierto" los pilares que Previo destaca en landing y que vos tenés con UX comparable (informes generación + multi-empresa + alertas vencimiento + PDF branding + auth + audit log). NO cuento "schema listo pero sin UI" (empleados) ni "trial schema OK pero gate no end-to-end" (pagos). NO cuento como tu ventaja módulos que Previo no necesita.

**Densidad competitiva argentina**: **MEDIA-BAJA**. 6-7 players activos serios, todos con propuestas similares apuntando a empresas medianas o "ambos perfiles", **solo Previo apunta claramente a higienista freelance con pricing transparente**. GENESIS pricea por user lo cual es caro para freelance. **El hueco para una propuesta "freelance + pricing USD accesible + IA generativa" es real y no está ocupado.**

---

## 5. Plan de MVP en 3 olas (Fase 4)

> Premisa: estás solo o con tu equipo chico, recursos limitados, querés vender en 6-10 semanas. Ola 1 = launch, Ola 2 = retención, Ola 3 = diferenciación premium.

### Ola 1 — Lanzamiento (target 4-6 semanas)

**Objetivo**: tener un producto que no haga ridículo vs Previo, donde un higienista pueda registrarse, cargar un cliente real, generar un informe técnico con IA, y pagar Plan Pro por MP.

| # | Feature | Archivos a tocar | Esfuerzo | Por qué crítica |
|---|---|---|---|---|
| 1 | **Cerrar Pagos MP end-to-end** (checkout + webhook + trial expira + bloqueo + UI /facturacion) | [src/shared/billing/](src/shared/billing/), [src/shared/mercadopago/](src/shared/mercadopago/), [src/app/api/webhooks/mercadopago/route.ts](src/app/api/webhooks/mercadopago/route.ts), [src/app/(app)/settings/billing/](src/app/(app)/settings/billing/), nuevo `src/app/(app)/upgrade/page.tsx` | M (4-6 días) | Bloqueante: sin esto no cobrás nada |
| 2 | **UI Empleados T-054** + CSV import básico | [src/app/(app)/empleados/page.tsx](src/app/(app)/empleados/page.tsx), `nuevo/page.tsx`, `[id]/page.tsx`, `[id]/editar/page.tsx`, `import-csv/page.tsx` | M (5-7 días) | Sin empleados no hay EPP ni planilla 299/11 |
| 3 | **EPP módulo mínimo**: schema + entrega con fecha + vencimiento auto-6m + alerta calendario | nuevas migrations `epp_items`, `epp_deliveries`; nuevo módulo `src/app/(app)/epp/` | **XL (10-14 días)** | Es el pilar #2 de Previo. Sin esto sos "Word con IA" y no "software HyS". Justifico XL en Ola 1: 50% del valor diferenciador queda neutralizado si no está |
| 4 | **Planilla Res 299/11 PDF** (entrega EPP firmada) | nuevo template + route `/api/epp/[id]/pdf/route.ts` | M (3 días) | El consultor lo necesita imprimir cada vez. Es el formulario que la ART pide |
| 5 | **Landing pública con planes + signup** (hoy `src/app/page.tsx` es minimalista — verificar y robustecer) | [src/app/page.tsx](src/app/page.tsx), nuevo `src/app/precios/page.tsx`, nuevo `src/app/features/page.tsx` | M (3-4 días) | Sin landing no convertís tráfico orgánico, no podés mostrar referencia |
| 6 | **Onboarding mínimo primer login** (banner "creá tu primer cliente" → "dá de alta un empleado" → "generá tu primer informe") | nuevo `src/app/(app)/dashboard/OnboardingChecklist.tsx` | S (1-2 días) | Sin esto el churn primera semana se dispara |
| 7 | **Texto legal compliance**: revisar privacidad + términos para Ley 25.326 + retención datos clara | [src/app/privacidad/](src/app/privacidad/), [src/app/terminos/](src/app/terminos/) | S (1 día) | Higienista argentino lee chico antes de subir DNI de empleados |

**Qué NO va en Ola 1 y por qué OK postergarlo**:

- Capacitaciones módulo dedicado → tipo `capacitacion` ya genera informes IA; el tracking de asistencia + renovación 12m va Ola 2.
- Exámenes médicos → el cliente PYME muchas veces los terceriza con ART o clínica; no es bloqueante para vender.
- IPER / matriz riesgos → Previo lo tiene pero pocos higienistas freelance lo usan diariamente, lo hacen 1 vez al año. Va Ola 2.
- Índices SRT 463/09 → cálculo 1 vez al año (febrero-marzo). Si lanzás en julio, tenés 6 meses para hacerlo.
- Cronograma CIIU 53 obligaciones → Could, mucho data entry para curar el catálogo. Ola 3 o nunca.
- Los 7 módulos SGSST ISO 45001 → **prohibido tocarlos antes de tener 10 clientes pagos**. Pesan 4+ semanas cada uno y solo los necesita la mediana empresa que paga $80k+ Pro.

### Ola 2 — Retención primer mes post-lanzamiento (target 3-4 semanas)

**Objetivo**: reducir churn, mejorar onboarding, sumar features de uso recurrente.

| # | Feature | Esfuerzo | Por qué |
|---|---|---|---|
| 1 | Capacitaciones módulo dedicado (padrón asistencia + renovación 12m + constancia PDF) | L (1-2 sem) | Uso recurrente, dispara alertas Res 905/15 |
| 2 | Importación CSV/Excel clientes y empleados (fricción onboarding) | M (3 días) | Si el consultor llega con 200 empleados en Excel y no puede importar, se va |
| 3 | Tabla `incidentes` + libro de accidentes (separado del informe `accidente`) | M (4 días) | Permite trackear siniestros para futuros índices SRT |
| 4 | 8 índices SRT (Res 463/09) calculados sobre tabla `incidentes` + dotación | M (4 días) | Lo destacan Previo + GENESIS, fácil de calcular si tenés datos |
| 5 | IPER / matriz riesgos (template + UI) | L (1 sem) | Cierra el gap visible vs Previo |
| 6 | Firma digital canvas + storage + PDF embed (planilla 299 + capacitaciones) | M (3 días) | UX 10x sobre "imprimir + firmar a mano + escanear" |
| 7 | Onboarding interactivo con tour (no solo checklist) | M (3 días) | Reduce time-to-first-informe para usuarios nuevos |

### Ola 3 — Diferenciación + monetización mes 2-3 (target 4-6 semanas)

**Objetivo**: justificar planes superiores. Sumar lo que diferencia.

| # | Feature | Esfuerzo | Por qué |
|---|---|---|---|
| 1 | **Plan Team** (USD 100): roles finos + asignación de visitas + aprobación de informes | L | Empezás a comer mercado de "estudio" 3-5 técnicos |
| 2 | **Marca blanca real** diferenciada por plan (PDF + email + dashboard) | M | Justifica plan Pro vs plan base |
| 3 | **Exámenes médicos** módulo (preocupacional/periódico/egreso) con alertas + PDF | L | Cierra otro pilar Previo |
| 4 | **Importación PDF/Excel listado ART** (parser + reconciliación con empleados) | L | Hueco real, nadie lo hace bien |
| 5 | **Multi-establecimiento por cliente** (tabla `establecimientos`) | L | Habilita cliente industrial 2-5 plantas |
| 6 | **Cronograma CIIU** (catálogo + 53 obligaciones Dec 351/911/617) | L | Cierra gap "todo lo que tiene Previo" |
| 7 | **Integraciones**: convenio con un colegio provincial o cámara (modelo GENESIS-CPIA Corrientes) | M (negociación) + S (técnico) | Distribución capturada, 10x venta. **Esta es la jugada de palanca alta.** |

---

## 6. Diferenciadores + Riesgos + Recomendación final (Fase 5)

### 6.1 Diferenciadores de palanca alta (5)

Cosas que con esfuerzo BAJO te dan diferenciación ALTA vs Previo y el resto.

1. **IA generativa de informes con streaming SSE en vivo (ya lo tenés)**.
   - Por qué nadie lo tiene: Previo, SIGHyS, GENESIS, SEHIGIENE — ninguno menciona generación con LLM. Previnnova tiene "asistente IA" pero es Q&A, no genera.
   - Archivos: [src/app/api/informes/[id]/generate-stream/route.ts](src/app/api/informes/[id]/generate-stream/route.ts), [src/shared/ai/prompts/](src/shared/ai/prompts/), [src/shared/ai/stream.ts](src/shared/ai/stream.ts).
   - Costo: **0 (ya está)**. Lo que falta: mostrarlo en landing con video de 30s.

2. **Notificaciones multi-canal email + Telegram + Push Web (ya lo tenés)**.
   - Por qué nadie lo tiene: Previo solo email. El resto idem. El consultor argentino vive en WhatsApp/Telegram, no en email corporativo.
   - Archivos: [src/shared/notifications/](src/shared/notifications/), [src/shared/telegram/](src/shared/telegram/), [src/shared/push/](src/shared/push/).
   - Costo: **0**. Pendiente: WhatsApp Business API → next level (esfuerzo M, ver oportunidad #5).

3. **Pricing público en USD + accesibilidad freelance**.
   - Por qué nadie lo tiene: Previo público ARS (volátil), GENESIS público ARS pero por user, resto opaco. USD reduce fricción del higienista al alza inflación y posiciona "premium pero accesible".
   - Costo: **S (decisión + landing)**. 1-2 días.

4. **Audit log inmutable + RLS + JWT custom claim (ya lo tenés)**.
   - Por qué importa: para vender a estudios que se preparan para certificar ISO 45001, mostrá que cumple 7.5.3 y 9.2.1 sin esfuerzo extra. Esto es **silencioso pero diferenciador** vs SaaS argentinos que muy probablemente tienen tenancy en app layer (riesgo de leak cross-tenant).
   - Costo: **S** (página de docs "Cumplimiento técnico: cómo ConsultoraDemo soporta ISO 45001 7.5.3").

5. **Generación de protocolos técnicos específicos con IA + datos del SRT**.
   - Por qué nadie lo tiene: Previo etc. tienen "informes" pero el consultor sigue tipeando el contenido técnico (umbrales SRT por agente). Vos podés cargar las tablas oficiales Res 84/12 + 85/12 + 886/15 + 295/03 dentro del prompt y dejar que Claude sugiera el cumplimiento automático.
   - Archivos: extender [src/shared/templates/relevamiento/schema.ts](src/shared/templates/relevamiento/schema.ts) con AGENTES_HYS ya listo, sumar mediciones + umbrales en el prompt de IA.
   - Costo: **M (4-5 días)**. Diferenciación 10x.

### 6.2 Riesgos y deuda técnica críticos

**Seguridad / Auth**

- ✅ RLS multi-tenant verificado en migrations. Audit log inmutable. No veo problemas inmediatos.
- ⚠️ Verificar **rate limit en webhook MP** ([src/app/api/webhooks/mercadopago/route.ts](src/app/api/webhooks/mercadopago/route.ts)) — Upstash está instalado pero confirmá que la firma del webhook está validada (Mercado Pago `x-signature` header + secret). No revisé el código.
- ⚠️ **Storage buckets** ([supabase/migrations/20260513220318_storage_buckets.sql](supabase/migrations/20260513220318_storage_buckets.sql)): verificá que el bucket de informes/attachments NO sea público y use signed URLs con TTL corto.

**Compliance argentina (Ley 25.326 Habeas Data)**

- ✅ `retencion_datos_hasta` ya está en schema ([20260520000001_t070_pagos_schema.sql](supabase/migrations/20260520000001_t070_pagos_schema.sql)).
- ⚠️ Pero **el cron que efectivamente borra los datos cuando se alcanza esa fecha NO existe todavía**. Esto es deuda compliance: vas a violar Ley 25.326 art. 4 (datos no deben conservarse más de lo necesario) si publicás sin esto.
- ⚠️ **DNI + CUIL de empleados** se guardan en claro en `empleados.dni`, `empleados.cuil`. Para Ley 25.326 idealmente deberían estar **encriptados at-rest** o al menos en columna pgcrypto. Hoy Supabase encripta storage a nivel disco pero no a nivel columna.
- ⚠️ **Exportación de datos del usuario** (derecho al art. 14 Ley 25.326) — no existe endpoint "descargá tus datos". Si un consultor lo pide, hoy no podés cumplir.

**Calidad de datos**

- ✅ Validación con Zod en bordes + CHECK SQL + audit trigger guards. Patrón sólido.
- ⚠️ Falta validación de **fechas razonables** en informes — un consultor que tipea `2099-12-31` o `1990-01-01` en una medición rompe estadísticas downstream.
- ⚠️ Falta **límite de adjuntos** por informe (¿se puede subir 100 fotos de 10 MB?). Verificar bucket policy.

**Escalabilidad obvia**

- ⚠️ [getInformesByClienteId](src/app/(app)/clientes/queries.ts) tiene cap hard de 50. Para Plan Team con 5 técnicos y un cliente con 200 informes año, 50 no alcanza. Hay que paginar.
- ⚠️ Búsqueda de clientes/empleados es **client-side filter sobre pre-fetched** (T-049 / T-054). Funciona hasta 100-200 clientes. Para Plan Team ilimitado, vas a necesitar full-text search PostgREST + indexes GIN. Diferible.
- ⚠️ La generación de PDF con Puppeteer en el VPS de Hostinger consume RAM (~300 MB por instance Chromium). Si 5 usuarios generan PDFs concurrentemente, el container se cae. **Verificá memory limits del EasyPanel y/o moveá PDFs a una cola async** (BullMQ/pg-cron) en Ola 2.

### 6.3 Recomendación final (3 bullets)

- **El movimiento más importante de ESTA SEMANA**: cerrá Pagos MP end-to-end (T-071 pendientes + UI /facturacion + bloqueo trial expirado). Sin esto todo lo demás es académico. **Si toma más de 5 días, parate y preguntá qué se rompió**.
- **La decisión más importante de ESTE MES**: **¿lanzás con EPP básico o sin EPP?** Mi recomendación: **con EPP básico** (entrega + alerta 6m + planilla 299/11 PDF), aunque tarde 2-3 semanas extra. Sin EPP, sos un "Word con IA" — Previo te come en cualquier demo. Con EPP básico + IA + multi-empresa, sos un Previo con IA y un 60% del feature set. Eso se vende.
- **La trampa más obvia a evitar**: **no clones los 7 módulos SGSST ISO 45001 antes de tener 10 usuarios pagos**. Cada módulo (auditorías + revisión dirección + plan emergencias + MOC + comité mixto + requisitos legales + política) pesa 3-4 semanas. Son 6 meses de trabajo. Tu primer cliente quiere generar un informe rápido y no perderse el vencimiento de EPP — no quiere certificar ISO. **Si un cliente te lo pide, vendele Plan Pro de $250 USD y desarrollalo a medida en Fase 2.** No lo construyas spec.

---

## 7. Oportunidades accionables priorizadas (Fase 6)

| # | Hueco | Evidencia | Tipo | Esfuerzo | Monetización |
|---|---|---|---|---|---|
| 1 | **Generación IA de protocolo Res 85/12 (ruido) + Res 84/12 (iluminación) con umbrales SRT cargados** — el consultor mide en planta y la IA escribe el cumplimiento normativo argentino con los valores oficiales | Ningún competidor AR menciona IA generativa con tabla SRT incorporada. Tu [AGENTES_HYS](src/shared/templates/relevamiento/schema.ts) ya está. | Feature dentro Informes | M (4-5d) | **Alto**: el consultor cobra $200-500k ARS por protocolo, está dispuesto a pagar plan Pro completo si le ahorra 3 hs por protocolo |
| 2 | **WhatsApp Business API** para alertas de vencimiento + envío de informe firmado al cliente directo | Previo es email-only. El consultor argentino vive en WhatsApp. Resend instalado, falta provider WhatsApp (360dialog o Meta directo). | Integración | M (1 sem incl onboarding API) | **Alto**: feature premium plan Pro/Team |
| 3 | **PWA mobile-first + offline para inspección en obra (Dec 911/96 construcción)** | Ningún SaaS AR es PWA. El consultor de construcción no tiene WiFi en planta. Tu stack Next 16 + service worker + IndexedDB lo soporta nativo. | Infraestructura + módulo Checklists | XL (3-4 sem) | **Alto**: abre el segmento construcción (gran subset del mercado) |
| 4 | **Convenio con colegio provincial o cámara** (modelo GENESIS-CPIA Corrientes) | [cpiaya.org.ar/convenio-con-genesis-broker/](https://cpiaya.org.ar/convenio-con-genesis-broker/) → GENESIS tiene este canal. Vos no. | Distribución | S técnico + M negociación | **Muy alto**: 1 convenio = 50-200 colegiados que se enteran |
| 5 | **Importador inteligente de listado anual ART (PDF/Excel)** que reconcilia automáticamente con `empleados` existentes usando match por DNI/CUIL | Previo lo destaca como pilar diferenciador. Vos no lo tenés. La IA tuya puede parsear el PDF de la ART (Provincia ART, Galeno, Federación Patronal) | Feature | M (5-7d con LLM parser) | **Alto**: reduce fricción onboarding masivo |
| 6 | **Generador IA del RGRL anual completo** (Res SRT 463/09) basado en datos del cliente + empleados | Es **el informe más doloroso del año** (~40 pp). Previo asiste pero el consultor lo arma. Tu IA lo puede pre-llenar al 80%. | Feature dentro Informes | M (4-5d) | **Alto**: justifica plan Pro de USD 30 con un solo uso anual |
| 7 | **Plantillas IPER por industria + sector** con IA que sugiere riesgos por puesto y CIIU | El consultor empieza desde Excel vacío. Si la IA propone los 15 riesgos típicos de un metalúrgico (CIIU 28...) y el consultor solo edita, gana 2 hs. | Feature | M (4-5d) | **Medio-alto** |
| 8 | **Bot Telegram pasivo** que avisa al higienista cada lunes "tenés 3 entregas EPP vencen esta semana, 1 capacitación renovar" | Ya tenés Telegram bot integrado. Falta el resumen semanal proactivo. | Feature retención | S (2d) | **Bajo direct, alto indirecto**: reduce churn |
| 9 | **Marketplace de plantillas de informe** (otros higienistas publican su template y otros pagan) | Nadie lo hace. Modelo Hotmart pero específico HyS Argentina. | Producto nuevo (Fase 2+) | XL | **Medio** (toma escala primero) |
| 10 | **Generador IA de constancia de capacitación** (Res 905/15) con foto del grupo + temario + firma | Tu tipo `capacitacion` ya existe, falta el outpath específico | Feature | S (1-2d) | **Medio** |

**Prioridad recomendada Ola 1-2-3**:

- **Ya en Ola 1**: oportunidad #1 (extender la IA de relevamiento con umbrales SRT) — es 4-5 días y dispara la diferenciación.
- **Ola 2**: oportunidades #2 (WhatsApp), #5 (parser ART), #6 (generador RGRL), #10 (constancia capacitación).
- **Ola 3**: oportunidades #3 (PWA), #4 (convenio colegio), #7 (IPER por industria).
- **Backlog largo**: oportunidades #8 (bot lunes), #9 (marketplace).

---

## 8. Competidores extranjeros potenciales (opcional)

Los reviso solo si son **amenaza real de entrada** al mercado AR. Máximo 3.

- **SafetyCulture (iAuditor)** — [safetyculture.com/es](https://safetyculture.com/es) — usado en 85 países, +50k inspecciones día, tiene IA integrada, 10k+ templates customizables. **Amenaza real**: si arman partner local AR con conocimiento normativo, pueden comer mucho del segmento construcción y empresa mediana. Sin embargo, pricing no público y orientado enterprise → no compite directo con freelance USD 30.
- **ZYGHT** — Chile, opera LATAM, presencia en Argentina ([docs/discovery/03-competencia.md](docs/discovery/03-competencia.md) ya lo identificaba). Enterprise USD 2k-10k/mes. **No amenaza freelance** pero compite por mediana industria con Previo Pro.
- **Pirani** — Colombia, foco riesgos + cumplimiento. Aparece en comparativas LATAM pero no vi operación AR explícita. **Amenaza media** si arman localizadora.

**Implicancia**: los extranjeros no son tu enemigo Ola 1-3. Tu enemigo es Previo + GENESIS. Pero **el día que SafetyCulture firme convenio con AHRA, te metieron presión real** — preparate.

---

## Fin del análisis

Citas verificadas durante la investigación:

- [previo-ar.vercel.app/landing](https://previo-ar.vercel.app/landing) — Previo, planes y precios ARS confirmados por WebFetch.
- [sighys.com.ar](https://sighys.com.ar/) — SIGHyS Córdoba, sin pricing público.
- [previnnova.com.ar/software-cumplimiento-seguridad-higiene-argentina](https://www.previnnova.com.ar/software-cumplimiento-seguridad-higiene-argentina) — Previnnova AMBA, "pack ART" mencionado textualmente.
- [genesisbroker.com.ar](https://genesisbroker.com.ar/) — GENESIS Broker BA, pricing por user $32.900-$53.300 ARS confirmado.
- [sehigiene.com](https://www.sehigiene.com/) — SEHIGIENE Rosario, foco empresas.
- [smartsafety.com.ar/software](https://smartsafety.com.ar/software/) — Smart Safety AR, foco planta industrial.
- [custombit.com.ar/programas-higiene-seguridad](https://www.custombit.com.ar/programas-higiene-seguridad/index.html) — HST Custombit, USD 250 / $370k licencia única Windows desktop.
- [ahra.org.ar](https://ahra.org.ar/) y [linkedin.com/company/ahraasociacionargentina](https://www.linkedin.com/company/ahraasociacionargentina/) — AHRA comunidad profesional.
- [cpiaya.org.ar/convenio-con-genesis-broker](https://cpiaya.org.ar/convenio-con-genesis-broker/) — convenio GENESIS-Colegio Profesional Corrientes.
- [comparasoftware.com.ar/software-sg-sst](https://www.comparasoftware.com.ar/software-sg-sst) — listado SG-SST AR (curiosamente, los 9 listados son extranjeros).
- [srt.gob.ar/estadisticas](https://www.srt.gob.ar/estadisticas/) — fuente oficial de índices SRT.

**Datos NO verificados** (marcados explícitamente):

- Año fundación de los competidores (la mayoría no lo publica).
- Tamaño de equipo + cantidad de clientes activos de cada competidor (no es público).
- Reviews textuales en español rioplatense — no encontré reviews públicas indexables; lo que reporté como "dolores" es inferencia razonable.
- Existencia de grupos Facebook/WhatsApp grandes específicos AR — probablemente existen pero no son indexables en search público.
- Existencia activa de "Aliad SST", "Cuidate" como SaaS — no se confirmaron como productos reales argentinos activos hoy.
