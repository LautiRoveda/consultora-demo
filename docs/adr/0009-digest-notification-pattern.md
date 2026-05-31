# ADR-0009 · Patron "digest notification" (idempotencia por periodo + email-only)

- Estado: Aceptada
- Fecha: 2026-05-31
- Contexto del ticket: T-109 (resumen semanal EPP)

## Contexto

T-109 agrega un cron semanal (lunes 09:00 ART) que manda al owner de cada
consultora un resumen EPP por email (entregas firmadas en 7d + proximos
vencimientos). Necesitabamos resolver dos cosas sin romper el patron de
notificaciones existente:

1. **Idempotencia de un digest periodico.** El dispatcher de reminders
   (`dispatchReminderToChannels`) deduplica via `notification_log`, pero su
   indice de idempotencia exige `reminder_id NOT NULL` y la tabla no tiene una
   columna de "tipo" ni de "periodo". Un digest semanal no tiene `reminder_id`
   y se repite cada semana, asi que `notification_log` no lo puede deduplicar
   limpiamente.

2. **Seleccion de canal.** Hoy el dispatcher fanea a TODOS los canales
   habilitados (`notification_channel_prefs`); no existe el concepto de "canal
   preferido". Generalizar el dispatcher (reminder-shaped) para un digest seria
   scope creep.

## Decision

Introducir un **patron "digest notification"** con dos piezas, replicando el
precedente probado de dunning (T-074, `billing_notifications_log`):

1. **Tabla dedicada `notification_digest_log`** con UNIQUE
   `(consultora_id, tipo, periodo_iso, channel)`. `periodo_iso` es la semana
   ISO 8601 (`'2026-W22'`). Claim-then-send: el INSERT gana o devuelve 23505
   (`already_sent`). Append-only infra log, **sin audit trigger** (igual que
   `notification_log` / `billing_notifications_log`).

2. **Email-only respetando preferencia.** El digest se manda solo por email al
   owner (precedente dunning), saltando si el canal email esta `enabled=false`
   o `muted`. NO se generaliza el dispatcher ni se inventa "canal preferido".
   Telegram/push del digest = follow-up **T-109-FU** si emerge demanda.

Idempotencia en dos capas (lesson "Idempotency cascade" T-031): el UNIQUE de la
tabla + el `idempotencyKey` de Resend (`consultora:tipo:periodo`, dedup 24h
server-side).

## Por que NO `notification_log`

Es reminder-centric (indice por `reminder_id`, sin discriminador de tipo/periodo).
Forzar un digest ahi requeriria un indice parcial nuevo + columnas sinteticas:
mas invasivo y fragil que una tabla dedicada de 8 columnas. La separacion
mantiene cada log con una responsabilidad clara.

## Consecuencias

- **+** Idempotencia semanal robusta y legible; reusa el flujo claim-then-send
  ya probado en dunning.
- **+** Superficie minima: sin tocar el dispatcher de reminders ni su schema.
- **+** La tabla es generica (`tipo` extensible) para futuros digests.
- **-** Una tabla mas de infra de notificaciones (aceptable: no es dominio, sin
  audit trigger). El constraint "sin schema nuevo" de T-109 aplicaba al dominio
  EPP, no a infra de idempotencia.
- **Forward**: si T-109-FU agrega Telegram/push al digest, ampliar el CHECK de
  `channel` (1 linea) y el sender; el UNIQUE ya incluye `channel`.

## Alternativas descartadas

- **Reusar `notification_log`** con `reminder_id=null` + columna de semana: pelea
  con el diseno reminder-centric, requiere indice parcial nuevo igual.
- **Extender `billing_notifications_log`** con `tipo='epp_weekly_summary'`: mete
  digests EPP en una tabla "billing" (acopla dominios distintos).
- **Generalizar el dispatcher a multi-canal generico**: scope creep para un
  unico feature; el digest por email cubre la necesidad real hoy (YAGNI).
