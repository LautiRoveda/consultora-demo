# ADR-0008 · Pagos vía Mercado Pago Subscriptions API + precio fijo ARS env var

**Fecha:** 2026-05-21
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** Claude Code (planning + implementation T-070)

## Contexto

Sprint Pagos arranca con T-070 (schema DB) + T-071..T-074 (integración MP + UI + gates + dunning). Decisión D09 del discovery fija pricing **Pro USD 30/mes**, trial 7d sin tarjeta, sin canal comercial. Architecture doc M14 (módulo Pagos) deja el detalle de gateway abierto.

ConsultoraDemo opera 100% en Argentina (target del producto). Mercado Pago es el gateway dominante: 90%+ del e-commerce AR usa MP como rail principal, los consultores de HyS ya lo tienen como medio de cobro habitual. Stripe no opera en Argentina con boleta local + débito de tarjeta argentina (workarounds existen pero rompen flow del usuario).

Hay tres decisiones acopladas que tomamos juntas en este ADR para no quedar fragmentadas en sprint notes:

1. **Qué API de Mercado Pago usar** (Subscriptions vs Checkout Pro repetido).
2. **Cómo manejar el precio** ARS vs USD (FX drift es real en AR — peso devaluándose mensualmente).
3. **Naming del schema**: divergencia entre `consultoras.plan` (denormalized cache) y `suscripciones.plan_codigo` (enum SKU).

## Decisión

### 1. API: Mercado Pago Subscriptions (preapprovals)

Usamos `POST /preapproval` + webhooks `merchant_order` / `payment`. Cada consultora con plan Pro tiene una preapproval activa en MP que cobra mensualmente sin intervención. Cancel via `PUT /preapproval/{id}` con `status: cancelled`.

Schema `public.suscripciones.mp_subscription_id` guarda el `preapproval_id`. `public.facturas.mp_payment_id` guarda el `payment.id` que viene en cada webhook de cobro exitoso/fallido.

**Por qué Subscriptions y no Checkout Pro recurrente manual**:

- Subscriptions API maneja el ciclo de retry de pago fallido nativamente (Mercado Pago retry strategy interna, ~3-4 intentos sobre 7 días antes de marcar la suscripción como `paused`).
- Cancelación queda como un objeto persistente en MP (auditable desde el dashboard del consultor cuando lo necesite).
- Single webhook stream para todos los eventos de cobro de una suscripción. Checkout Pro repetido requiere logic propia para tracking de qué pago corresponde a qué período.
- El UX del checkout es popup MP estándar (los consultores AR ya están familiarizados con esa UI).

### 2. Precio: env var `ARS_PRICE_MONTHLY` (centavos ARS, ajuste manual)

Variable de entorno string regex `^\d+$` representando centavos ARS. Ejemplo `"3000000"` = ARS 30.000 = USD 30 al FX al momento de cargar. Lautaro la ajusta manualmente en EasyPanel cuando hay drift FX significativo.

**Opciones consideradas y descartadas para MVP**:

- **Pricing fijo ARS hardcoded**: rápido pero queda enterrado en código, requiere PR + deploy cada ajuste de precio.
- **BCRA dollar lookup automático** (`api.bcra.gob.ar` cada 24h, store en `consultoras.precio_actual` o tabla `tipos_cambio`): el cleanest desde producto pero suma 1-2 días de dev (cron + cache + fallback si BCRA down + decisión de cuál dólar usar — oficial / blue / MEP) y agrega un fail mode nuevo. **Diferido a T-070-FU1** si emergiera drift agudo.
- **Pricing USD con MP convirtiendo a ARS al cobro**: MP NO soporta preapprovals USD para merchants argentinos. Bloqueado por gateway.

**Cómo ajustamos en práctica**: cuando el USD oficial sube ~10%, Lautaro entra a EasyPanel → consultora-demo → env vars → cambia `ARS_PRICE_MONTHLY` → "Implementar" → en el próximo signup el precio queda en el nuevo valor. Suscripciones activas no se re-precian automáticamente (MP requiere update explícito del preapproval, scope de T-070-FU3 si hace falta).

### 3. Naming schema: `consultoras.plan` (text cache) vs `suscripciones.plan_codigo` (enum SKU)

Dos columnas, dos propósitos:

- **`consultoras.plan`** (`text` con CHECK IN `'trial' | 'pro' | 'team' | 'enterprise'`): **cache denormalizado** para gates de UI. Se lee en cada render del shell (sidebar muestra badge "trial" + days-left counter; gate de features Pro). Cambia poco — solo cuando la suscripción transiciona entre tiers comerciales. Webhook MP (T-071) actualiza este campo cuando recibe confirmación de cobro / cancelación.
- **`suscripciones.plan_codigo`** (`enum` con valores `'pro_mensual'` por ahora): **SKU específico del producto MP**. Futuro-extensible con `pro_anual`, `team_mensual`, `team_anual`, `enterprise_mensual` sin renombrar la columna ni cambiar el CHECK de consultoras. Una suscripción es por SKU; un tier comercial (consultoras.plan) puede mapear a múltiples SKUs (pro mensual y pro anual ambos dejan a la consultora en plan 'pro').

**Por qué denormalizar en vez de join cada render**:

- Sidebar + middleware leen el plan en cada navegación dentro del shell. Hacer JOIN a `suscripciones` cada vez sería overhead innecesario para un dato que cambia ~1 vez por consultora por año.
- Multi-tenant RLS sobre suscripciones complica el lookup (helper `is_member_of_consultora` necesario). El JWT trae consultora_id, y la sesión ya tiene `CurrentConsultora.plan` en memoria — gate es un comparator de string.

**Riesgo asumido**: divergencia entre `consultoras.plan` y la suscripción real (ej. webhook MP no se procesa). Mitigación en T-073: el job de reconciliación periódico (cada 6h) compara `suscripciones.estado` vs `consultoras.plan` y reporta inconsistencias a Sentry.

## Trial 7d sin counter de informes

Decidimos NO contar informes durante el trial. Trial = 7 días calendario solos, contados desde `consultoras.trial_hasta = signup + 7d`. Esta decisión tiene tradeoff:

- **Pro**: signup → primera generación de informe en <60s sin friction. Onboarding fluido. Mide intención real (el que prueba lo hace porque quiere ver el output).
- **Contra**: usuario abusivo puede crear N consultoras con N emails distintos durante 7d cada una. Mitigación parcial: signup requiere email único + Resend bounce filter; abuse a escala requiere fraud detection que es overkill para MVP.

Si emerge abuse real en producción, T-070-FU2 sumaría counter `consultoras.informes_count` + cap `5` durante trial. No es el problema de hoy.

## Trial expirado → retención datos 30d → deletion

Ley 25.326 (AR) exige consentimiento explícito para retener datos personales. Cuando una suscripción cancela o el trial expira sin migrar a pago:

1. `consultoras.retencion_datos_hasta = now() + 30d` (set por T-071 webhook handler).
2. Estado read-only durante esos 30d — el consultor puede recuperar sus PDFs / exportar sus datos.
3. Cron job futuro (post-MVP, T-XXX) deletea cuando `retencion_datos_hasta < now()`.

El campo está en el schema desde T-070; el cron lo implementamos cuando tengamos primer caso real (no antes — YAGNI).

## Estado machine de `suscripciones.estado`

```
                  signup
                    │
                    ▼
              ┌──────────┐
              │  trial   │── (7d sin pago) ─►  expirada (terminal)
              └────┬─────┘
                   │ (preapproval activo + primer cobro OK)
                   ▼
              ┌──────────┐
              │  activa  │── (user pidió cancel + MP confirma) ─►  cancelada (terminal)
              └────┬─────┘
                   │ (cobro falla → MP reintentando)
                   ▼
              ┌──────────┐
              │  morosa  │── (cobro retry OK) ─► activa
              └────┬─────┘
                   │ (4 intentos fallidos)
                   ▼
              cancelada (terminal, gracia 30d via retencion_datos_hasta)
```

`cancelar_en`: timestamp futuro. Set cuando user pide cancelación; la suscripción sigue activa hasta esa fecha (el período pago). `cancelada_en`: set cuando MP confirma cancelación via webhook.

## Consecuencias

- **Vendor lock-in con MP**: aceptable porque el target del producto es 100% AR. Migración a otro gateway requiere replicar todo el módulo Pagos (T-071..T-074) pero los datos del consultor (informes, calendario, clientes) NO dependen de MP — solo el billing.
- **Pricing manual**: requiere disciplina operativa (Lautaro chequea FX cada 2-3 semanas). Si Lautaro no está disponible y el peso se devalúa 30%, MP cobra a tarifa vieja hasta que alguien actualice — pérdida temporal de margen.
- **Schema overhead**: `consultoras.plan` + `suscripciones.plan_codigo` introduce ligera duplicación. Justificable por el read-heavy del campo y el desacople tiers-vs-SKUs.
- **Sin escalado USD/internacional**: si el producto se internacionaliza, este módulo se rehace entero. No es problema de fase actual (MVP AR-only por D02/D12).

## Rename legacy plan_tier/trial_ends_at a español

T-070 sumó el rename atómico:

- `consultoras.plan_tier` → `consultoras.plan`
- `consultoras.trial_ends_at` → `consultoras.trial_hasta`
- (nuevo) `consultoras.retencion_datos_hasta`

**Por qué ahora y en este ticket**: módulo Pagos introduce tablas en español (`suscripciones`, `facturas`) con enums en español (`plan_codigo`, `estado_suscripcion`, `estado_factura`). Dejar `plan_tier`/`trial_ends_at` en inglés en `consultoras` rompe consistencia del schema y obliga al consumer (sidebar, gates) a hacer code-switching mental entre nombres en dos idiomas. Costo del rename: bajo (2 columnas + 1 índice + RPC create_consultora_and_owner re-emitida + 7 consumers TS refactorizados). Costo de NO renombrar ahora: cada nuevo lector del schema enfrenta la inconsistencia.

Rename atómico en la misma migration que crea las tablas nuevas → la app sigue compilando entre push y deploy sin runtime errors transient.

## Referencias

- D09 (decisión discovery): pricing Pro USD 30 / Team USD 100 / Enterprise USD 250.
- M14 (architecture doc): módulo Pagos.
- Schema concreto: `supabase/migrations/20260520000001_t070_pagos_schema.sql`.
- Plan T-070: `~/.claude/plans/t-070-schema-lively-plum.md` (workspace local).
- MP Subscriptions docs: <https://www.mercadopago.com.ar/developers/es/docs/subscriptions>.
