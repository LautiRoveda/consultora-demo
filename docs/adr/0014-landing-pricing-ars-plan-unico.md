# ADR-0014 · Landing comercial: pricing ARS plan único + trial 14d sin tarjeta

**Fecha:** 2026-05-27
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** discovery decisiones D01-D14 (ver `docs/discovery/00-decisiones.md`), research competitivo interno auditoría 2026-05-25 (Previo / GENESIS / SIGHyS / SEHIGIENE / Previnnova / Smart Safety / HST Custombit — _research interno; cero menciones en copy público_), métricas de fricción de signup observadas en T-071 (trial 7d era insuficiente para que el ICP completara el primer informe + entrega EPP de prueba antes de la decisión de pago)

## Contexto

Hasta T-107 inclusive, ConsultoraDemo no tenía landing comercial: la home (`src/app/page.tsx`) era una placeholder con 4 secciones, pricing **USD 30** mencionado nominalmente y trial **7 días** hardcoded en la función SQL `create_consultora_and_owner()`. Sin `/precios`, sin `/features`, sin OG dynamic, sin canal WhatsApp visible, sin video demo. El stack de signup + billing (T-070..T-074) está operativo pero la cara pública del producto no comunica el diferenciador (IA argentina que cita la SRT) ni baja la fricción de conversión orgánica.

T-108 es el primer ticket commercial post-Sprint 5 EPP + T-107. Bloquea conversión orgánica. Este ADR registra **3 decisiones de producto comercial** que se materializan en T-108 y que son base para la roadmap commercial subsiguiente (T-109+, follow-ups F1-F6 del audit).

## Decisión 1 · Pricing en ARS, plan único

**ARS 30.000/mes** como plan único MVP. **Descuento 15% anual** (equivalente a ARS 25.500/mes pagando 12 meses adelantados). Sin tier "Team", sin tier "Enterprise" en el copy público hasta validación de demanda.

### Razones

- **Moneda local elimina fricción cognitiva.** El ICP (higienista freelance individual AR) factura y mide costos en ARS. Mostrar USD obliga a convertir mentalmente con un FX que varía día a día, agregando incertidumbre al cierre.
- **Plan único reduce decisión a binaria.** Mostrar 3 tiers obliga al usuario a evaluar cuál le sirve antes de tomar la decisión "trial sí / trial no". Menos opciones = más conversión en ICP MVP de 1-10 clientes (D01).
- **15% off anual es el equilibrio AR-friendly.** Inflación crónica ARS hace impopular cualquier compromiso anual sin descuento. Un 15% es perceptible pero no canibaliza el LTV mensual (a churn ~5%/mes el break-even del anual queda en ~7 meses, suficiente margen).
- **Tier Team/Enterprise queda en roadmap interno, NO en copy público.** D09 reserva esos tiers para Fase 2 y Fase 4. Mencionarlos prematuramente disuelve foco y crea ruido en el ICP individual.

### Trade-offs

- Si emergen leads de empresas con 10+ consultores antes de Fase 2, hay que cotizar manualmente. Aceptable a este volumen.
- ARS_PRICE_MONTHLY queda en `src/env.ts` como string-centavos (T-070) y Lautaro lo ajusta manualmente en EasyPanel cuando la inflación lo requiere. NO hay índice automático (futuro T-070-FU1).

## Decisión 2 · Trial 14 días sin tarjeta

Bump del trial post-signup de **7 → 14 días**. Sin tarjeta de crédito requerida durante el trial.

### Razones

- **7 días eran insuficientes para el journey ICP.** El loop crítico de validación es: signup → cargar clientes (1-3) → cargar empleados (5-10) → generar primer informe técnico → generar primera entrega EPP firmada → ver primera alerta de vencimiento en calendario. Ese loop tarda 3-5 días calendario en un consultor que dedica 1-2 hs/día a evaluar la herramienta (no es full-time). Quedan ~2-4 días útiles para evaluar valor, marginal para una decisión de pago.
- **14 días duplica la ventana sin canibalizar ingresos.** Cualquier abuse window mayor a 14 días no agrega usuarios genuinos — solo extiende el costo de IA para tire-kickers. 14d es el sweet-spot observado en la mayor parte del SaaS B2B vertical AR.
- **Sin tarjeta = fricción mínima de inicio.** Pedir tarjeta upfront es la fricción #1 documentada en métricas de signup orgánico SaaS LatAm. La conversión post-trial cae si pedimos tarjeta upfront aunque sea "no se cobra hasta día 15". Mantenemos la promesa: trial real, sin pre-autorización.
- **Trial gate ya existente (T-073) sigue siendo la red de seguridad.** El billing gate (`src/shared/billing/access.ts`) bloquea features pagas a `plan='trial' + trial_hasta < now()`. Bumpear el trial de 7 a 14 días solo cambia el momento del lockout, no el mecanismo.

### Forward-only, sin backfill

Trials activos pre-T-108 (creados con 7d) **NO se backfillan a 14d**. Resucitar trials caducados de cuentas que ya migraron a plan pago o expiraron sería confuso y haría regression de pagos validados. Solo future signups arrancan con 14d.

Migration `20260527000001_t108_trial_duration_14d.sql` re-emite `create_consultora_and_owner()` cambiando únicamente el `interval` literal (`7 days` → `14 days`). Patrón verbatim de T-070 (re-emisión idempotente). El integration test `signup.test.ts:94` bumpea su assertion de `~7d` a `~14d` con la misma tolerancia ±5 min.

### Constante app-layer

`TRIAL_DAYS = 14` exportada desde `src/shared/lib/trial-days.ts`. Source of truth real sigue siendo la función SQL — la constante TS existe para que copy de páginas/metadata lea el número sin re-hardcodear. JSDoc explícito: si bumpés acá, bumpá también la migration.

## Decisión 3 · Landing comercial 3 páginas + cero comparativa explícita con competencia

Implementar 3 páginas públicas indexables:

- `/` — landing principal de 12 secciones (hero, pain/gain, pilares, documentos, timeline semana, timeline onboarding, segmentación ICP, normativa SRT cubierta, transparencia, pricing teaser, FAQ, CTA final).
- `/precios` — hero pricing con `PricingCard` full + tabla "Lo que cambia en tu día a día" + FAQ pricing + CTA.
- `/features` — hero con video Loom demo + 5 secciones split (IA SRT, EPP 299/11, calendario, audit log, protocolos AR) + roadmap futuro + CTA.

### Foco 100% en ConsultoraDemo, cero comparativa explícita

El research competitivo interno (audit 2026-05-25) mapeó al detalle las debilidades de Previo, GENESIS, SIGHyS, SEHIGIENE, Previnnova, Smart Safety y HST Custombit. **Ese research informa estructura y copy pero NO aparece nominalmente en ningún punto del sitio público.** Razones:

- **Pelear con nombre = legitimar competencia.** Mencionar competidores en copy comercial los promueve indirectamente (curiosidad del lead) y hace al producto verse defensivo en lugar de líder.
- **Riesgo legal innecesario.** Comparativas explícitas con afirmaciones evaluativas son terreno fértil para cease-and-desist. Argentina no tiene tradición fuerte de comparative advertising — riesgo > beneficio.
- **El diferenciador real es positivo, no relativo.** "IA argentina que cita la Res SRT con número exacto" se sostiene solo. No necesita "a diferencia de X que no lo hace".

Lo que sí entra al copy: **estructura tipo "Sin/Con"** (variant landing) y **"Hoy/Con"** (variant precios) en `PainGainTable.tsx`. Esa tabla habla del *dolor* del higienista (Excel, planillas papel, multas) — no del competidor. El lead reconoce su propio status quo, no a la marca rival.

### Componentes shared en `src/shared/landing/`

10 componentes reutilizables construidos en CP1 (este ticket) para que CP2-CP4 ensamblen las 3 páginas sin duplicación: `LandingHeader`, `LandingFooter`, `PricingCard` (variants full/mini), `PainGainTable` (variants landing/precios), `FAQAccordion`, `WhatsAppFloat`, `CTASection`, `Timeline` (variants semana/onboarding), `PillarCard`, + el helper `whatsapp.ts` que centraliza el número placeholder.

Además: `src/app/api/og/route.tsx` edge runtime para Open Graph image dinámica por página (T-108 reemplaza la OG estática del root layout — cada page genera la suya pasando `title` al endpoint).

### Canal WhatsApp prominente, no mailto

El ICP responde por WhatsApp instantáneamente y abre emails con latencia de días. La conversión por WhatsApp en SaaS B2B vertical AR supera al email por orden de magnitud. El botón flotante `WhatsAppFloat` queda fijo bottom-right en mobile + desktop, el header lo expone como acción primaria en md+, el footer y `CTASection` ofrecen secundaria.

Por ahora el número es un **placeholder hardcoded** en `src/shared/landing/whatsapp.ts` con TODO explícito — Lautaro lo reemplaza pre-CP5 smoke productivo. Centralizar en un solo archivo (no duplicar por componente) hace que el swap sea una sola línea de edit.

## Alternativas consideradas y descartadas

### A1 · Mostrar USD junto a ARS para legibilidad internacional

Descartado. El ICP es 100% AR; mostrar USD genera ambigüedad y la conversión cambia diaria. Si emergen leads internacionales en Fase 2, se evalúa landing localizada por geo-IP.

### A2 · Trial 30 días para "darle más espacio al lead"

Descartado. Doblar de 14 a 30 días no agrega usuarios genuinos según métricas SaaS comparables — solo extiende el costo IA para tire-kickers (50 informes generados por una cuenta que nunca convirtió = USD 8-12 perdidos por trial). 14d es el sweet-spot validado.

### A3 · Plan freemium (1 informe gratis/mes forever)

Descartado. Freemium en SaaS B2B vertical AR atrae usuarios que NUNCA convierten (50%+ del CAC orgánico se va a free riders). El trial pagado es la palanca correcta para validar willingness-to-pay.

### A4 · Tabla comparativa explícita "ConsultoraDemo vs X vs Y"

Descartado por las 3 razones de la sección "cero comparativa explícita" arriba. El research competitivo queda interno (audit + lessons learned) y se materializa en estructura/copy, no en menciones nominales.

## Consecuencias

### Positivas

- Reducción de fricción de signup (ARS + plan único + sin tarjeta + trial 14d) debería levantar conversion rate desde la home.
- Diferenciador competitivo (IA SRT) comunicado en hero de las 3 páginas sin caer en comparativas riesgosas.
- WhatsApp como canal de soporte reduce el ciclo de respuesta a leads en horas (vs días de email).
- Landing modular (10 componentes shared) baja el costo de iterar copy/secciones — cambios A/B futuros tocan un solo lugar.
- OG dynamic per-page mejora CTR en redes (link previews dejan de ser todos iguales).

### Negativas

- **El número de WhatsApp queda placeholder hasta CP5 smoke.** Riesgo: si Lautaro olvida el swap pre-merge, el botón abre chat con número inválido. Mitigación: TODO explícito en `whatsapp.ts` + verificación obligatoria en smoke productivo CP5 paso 2.
- **El precio en pesos requiere bump manual cuando hay inflación.** Sin BCRA/IPC automático, queda como responsabilidad de Lautaro chequear periódicamente. Futuro T-070-FU1 si emerge necesidad.
- **El descuento anual no está implementado en el flujo de pago todavía.** El landing lo anuncia (ARS 25.500/mes pagando anual), pero el preapproval MP del T-071 solo soporta mensual MVP. T-108-FU1 implementa el preapproval anual real. Por ahora el copy lo menciona como "Pagando anual" sin CTA específico que dispare anual — el lead que lo pida se gestiona manualmente vía WhatsApp.
- **El trial 14d duplica el costo de IA por tire-kickers vs 7d.** Aceptable a este volumen (decenas de signups/mes pre-launch comercial). Si la métrica de % de informes generados por trials que NO convierten supera ~30% del costo total IA, evaluar bump a 7d o gate de "primer informe gratis, segundo requiere tarjeta".

### Inciertas

- El video Loom demo (referenciado en `/features` hero) lo graba Lautaro fuera de CP1. Si no está listo pre-merge, queda placeholder con CTA "Video coming soon" + thumbnail estático. Riesgo bajo (el resto de la página vende sin él).
- La tasa de conversión real post-T-108 es desconocida — no hay baseline pre-existente. CP5 incluye smoke productivo manual; primer dato real a las ~2-4 semanas de tráfico orgánico.

## Notas de implementación

- Ticket: **T-108**. Checkpoints: CP1 (infra), CP2 (`/precios`), CP3 (`/features`), CP4 (`/`), CP5 (PR + smoke productivo).
- Branch: `feat/T-108-landing-comercial`. 1 PR único al final con 4 commits atómicos (uno por checkpoint).
- Migration: `supabase/migrations/20260527000001_t108_trial_duration_14d.sql` (forward-only, re-emisión idempotente).
- Componentes shared: `src/shared/landing/` (10 archivos + `whatsapp.ts` helper).
- OG dynamic: `src/app/api/og/route.tsx` (edge runtime).
- ADR vinculados: [ADR-0006](./0006-multi-tenant-rls-strategy.md) (RLS), [ADR-0008](./0008-pagos-mercadopago-subscriptions.md) (pagos MP).
- Discovery vinculado: D01, D08, D09, D14 (`docs/discovery/00-decisiones.md`).
- Lesson cross-sprint: el research competitivo se documenta interno; copy público es 100% positivo y centrado en el dolor del ICP, no en el competidor.

## Política forward (no negociable)

1. **Cualquier modificación de pricing público** requiere update simultáneo de: copy de `/` + `/precios` (vía `PricingCard`), `.env.example` comment, `ARS_PRICE_MONTHLY` valor, `CLAUDE.md` TL;DR, y ADR addendum o nuevo ADR si el cambio es estructural (de plan único a tiers, por ejemplo).
2. **Cualquier modificación de trial duration** requiere: nueva migration SQL re-emitiendo `create_consultora_and_owner()` + bump de `TRIAL_DAYS` constante en `src/shared/lib/trial-days.ts` + bump del integration test `signup.test.ts` + grep verification de que no quedó hardcode residual.
3. **Cero menciones nominales de competencia en copy público**, ni en landing, ni en docs onboarding, ni en email transaccionales. El research competitivo vive en audit interno + lessons learned.
4. **Mención de tiers futuros (Team / Enterprise)** queda exclusivamente en banners "próximamente Fase 2/4" — nunca como opciones seleccionables en el flujo de pricing actual.

## Referencias

- [Discovery decisiones D01-D14](../discovery/00-decisiones.md)
- [ADR-0006 multi-tenant RLS strategy](./0006-multi-tenant-rls-strategy.md)
- [ADR-0008 pagos MP subscriptions](./0008-pagos-mercadopago-subscriptions.md)
- [`src/shared/lib/trial-days.ts`](../../src/shared/lib/trial-days.ts) — `TRIAL_DAYS` constante + helper `trialDaysLeft`
- [`supabase/migrations/20260527000001_t108_trial_duration_14d.sql`](../../supabase/migrations/20260527000001_t108_trial_duration_14d.sql) — bump trial 7→14d
- [`src/shared/landing/`](../../src/shared/landing/) — 10 componentes shared CP1
- Research competitivo interno: auditoría 2026-05-25 (`docs/auditoria-2026-05-25.md` + `auditoria-2026-05-25-detallada.md`). **NO referenciado desde copy público.**
