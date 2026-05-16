# Sprint 3 · Performance benchmarks

Baselines productivos del módulo Calendario + Notificaciones multi-canal (Email + Telegram). Mediciones reproducibles vía SQL contra el remote Supabase + Studio.

## Contexto

Sprint 3 (T-027..T-036) entregó cron pg_cron + endpoint dispatcher + 2 canales (Email Resend, Telegram bot). Este doc define **targets de performance** + **scripts reproducibles** para medir latencias contra el productivo en `https://consultora-demo.test-ia.cloud`. NO incluye benchmarks de UI (calendar render, agenda buckets) — esos quedan cubiertos por Lighthouse smoke + tests E2E.

**Cuándo correr estos benchmarks**:
- Post-deploy mayor que toque el módulo Calendario / Notificaciones (T-038+).
- Si Lautaro observa quejas de usuarios sobre "reminders tardan mucho en llegar".
- Antes de habilitar planes pagos para validar SLA implícito.

**Cuándo NO correr**:
- Diariamente / en CI. Los benchmarks consumen quota de Resend (free tier 100/día) y mensajes reales a Telegram (sin cap pero ruidoso para Lautaro).

---

## Targets de performance

| Métrica | p50 | p95 | p99 | Notas |
|---|---|---|---|---|
| Latencia `scheduled_at` → email/telegram en bandeja **server-side** (`sent_at` del notification_log) | < 60s | < 3 min | < 6 min | Server-side, NO incluye cola interna del provider |
| Endpoint `POST /api/calendar/dispatch-reminder` RT | < 200ms | < 1s | < 2s | Medido en `net._http_response.created - net._http_request.created` |
| `process_pending_reminders()` con 100 reminders due | < 500ms | < 1s | n/a | Tiempo SQL puro de la función (sin pg_net async) |
| Resend API roundtrip (single email) | < 300ms | < 800ms | < 2s | **No medido productivo**: requiere instrumentación inline (follow-up) |
| Telegram Bot API roundtrip (single message) | < 200ms | < 600ms | < 1.5s | **No medido productivo**: requiere instrumentación inline (follow-up) |

**Proxy server-side vs end-to-end**: las latencias 1-3 son medibles server-side desde la DB (`notification_log.sent_at - calendar_event_reminders.scheduled_at`). La fila 4-5 (provider roundtrip) requeriría agregar `performance.now()` en `senders/email.ts` y `senders/telegram.ts` con `logger.debug` — invasivo a feature code, dejado como aspiracional hasta que Lautaro lo pida.

**Caveats**:
- `sent_at` es el momento en que el provider acusó recibo OK, NO el momento de delivery al inbox/chat del user. Resend/Telegram tienen cola interna no medible.
- El cron corre cada 5 min (`*/5 * * * *`). La latencia "scheduled_at → procesado" tiene piso de 0s y techo natural de 5 min por el período del cron.

---

## Setup pre-benchmark

1. **Sesión Studio** abierta contra el remote Supabase (project `consultora-demo`).
2. **Cuenta productiva** con telegram linked + email enabled (idem smoke productivo).
3. **Logueado en** `https://consultora-demo.test-ia.cloud` con la cuenta target.
4. **Quota de Resend disponible** (free tier 100/día; un benchmark consume hasta 100 emails).
5. **Telegram bot disponible** (`@consultora_demo_reminders_bot` o el que tengas configurado).

---

## Benchmark 1 — Latencia `scheduled_at` → procesado server-side

### Setup

Crear 10 reminders due en 30s. Studio → SQL Editor:

```sql
-- Pre: identificar un event pending del que vas a colgar los reminders.
-- Crear evento custom hoy + 30 días via UI (/calendario), tipo custom,
-- titulo "BENCHMARK 1 latency", recordatorios [30] (1 reminder por default).
-- Despues:

with target_event as (
  select id, consultora_id
  from public.calendar_events
  where titulo = 'BENCHMARK 1 latency'
  order by created_at desc
  limit 1
)
insert into public.calendar_event_reminders (event_id, consultora_id, offset_days, scheduled_at, status)
select
  te.id,
  te.consultora_id,
  30,
  now() + interval '30 seconds',
  'pending'
from target_event te
cross join generate_series(1, 10);
```

### Ejecución

Esperar el próximo tick del cron (max 5 min). Verificar con:

```sql
-- Pasados ~5 min:
select count(*) filter (where status = 'sent') as sent,
       count(*) filter (where status = 'pending') as pending
from public.calendar_event_reminders cer
join public.calendar_events ce on ce.id = cer.event_id
where ce.titulo = 'BENCHMARK 1 latency';
```

Esperá hasta `sent = 10`.

### Medición

```sql
with deltas as (
  select extract(epoch from (nl.sent_at - cer.scheduled_at)) as latency_seconds
  from public.notification_log nl
  join public.calendar_event_reminders cer on cer.id = nl.reminder_id
  join public.calendar_events ce on ce.id = cer.event_id
  where ce.titulo = 'BENCHMARK 1 latency'
    and nl.status = 'sent'
)
select
  count(*) as n,
  round(percentile_cont(0.5) within group (order by latency_seconds)::numeric, 2) as p50_seconds,
  round(percentile_cont(0.95) within group (order by latency_seconds)::numeric, 2) as p95_seconds,
  round(percentile_cont(0.99) within group (order by latency_seconds)::numeric, 2) as p99_seconds,
  round(max(latency_seconds)::numeric, 2) as max_seconds
from deltas;
```

Comparar contra targets: p50 < 60s, p95 < 3 min (180s), p99 < 6 min (360s).

### Cleanup

```sql
delete from public.calendar_event_reminders
where event_id = (
  select id from public.calendar_events where titulo = 'BENCHMARK 1 latency'
);
delete from public.calendar_events where titulo = 'BENCHMARK 1 latency';
-- notification_log queda inmutable (audit pattern T-031), no se borra.
```

---

## Benchmark 2 — Endpoint `/api/calendar/dispatch-reminder` RT

### Setup

Re-correr Benchmark 1 (los reminders pasan por el endpoint).

### Medición

`pg_net` registra request + response por cada `net.http_post` async. JOIN por `id` (mismo entre request y response):

```sql
select
  req.id,
  req.created as req_created,
  resp.created as resp_created,
  extract(milliseconds from (resp.created - req.created)) as latency_ms,
  resp.status_code
from net._http_request req
left join net._http_response resp on resp.id = req.id
where req.url like '%/api/calendar/dispatch-reminder%'
  and req.created > now() - interval '15 minutes'
  and resp.id is not null
order by req.created desc
limit 100;
```

Exportar CSV o pegar a una tool externa para calcular percentiles. Alternativa SQL:

```sql
with rt as (
  select extract(milliseconds from (resp.created - req.created)) as latency_ms
  from net._http_request req
  join net._http_response resp on resp.id = req.id
  where req.url like '%/api/calendar/dispatch-reminder%'
    and req.created > now() - interval '15 minutes'
)
select
  count(*) as n,
  round(percentile_cont(0.5) within group (order by latency_ms)::numeric, 1) as p50_ms,
  round(percentile_cont(0.95) within group (order by latency_ms)::numeric, 1) as p95_ms,
  round(percentile_cont(0.99) within group (order by latency_ms)::numeric, 1) as p99_ms
from rt;
```

Comparar contra targets: p50 < 200ms, p95 < 1s, p99 < 2s.

**Caveat**: si el endpoint llama a Resend Y a Telegram para cada reminder (caso multi-canal con user linked), el RT incluye ambos provider roundtrips. Si el RT excede 2s consistente, candidates de optimización: paralelizar senders dentro del dispatcher (hoy en serie por elección de design, ver `dispatch.ts:31`).

---

## Benchmark 3 — Throughput `process_pending_reminders()`

### Setup

Crear 100 reminders due:

```sql
with target_event as (
  select id, consultora_id
  from public.calendar_events
  where titulo = 'BENCHMARK 3 throughput'
  order by created_at desc
  limit 1
)
insert into public.calendar_event_reminders (event_id, consultora_id, offset_days, scheduled_at, status)
select
  te.id,
  te.consultora_id,
  30,
  now() - interval '10 seconds',  -- ya due
  'pending'
from target_event te
cross join generate_series(1, 100);
```

### Ejecución

Invocar la función manualmente + medir tiempo:

```sql
\timing on
select count(*) from public.process_pending_reminders();
\timing off
```

`\timing on` es comando psql; si usás Studio UI mirá el "Took N ms" del resultado.

### Verificación

```sql
-- Todos los 100 deberian estar sent.
select count(*) filter (where status = 'sent') as sent
from public.calendar_event_reminders
where event_id = (select id from public.calendar_events where titulo = 'BENCHMARK 3 throughput');
```

Comparar contra targets: tiempo total < 1s (la función usa `SELECT FOR UPDATE SKIP LOCKED` con `limit 100`; el SQL puro debería ser < 500ms p50, los pg_net.http_post son async — no se esperan adentro de la función).

### Cleanup

```sql
delete from public.calendar_event_reminders
where event_id = (select id from public.calendar_events where titulo = 'BENCHMARK 3 throughput');
delete from public.calendar_events where titulo = 'BENCHMARK 3 throughput';
```

---

## Benchmark 4 + 5 — Resend / Telegram roundtrip (NO MEDIDO)

**Target aspiracional**. Requiere agregar instrumentación inline en `senders/email.ts` y `senders/telegram.ts`:

```ts
// En email.ts, line ~33:
const start = performance.now();
const result = await resend.emails.send(...);
const elapsed = performance.now() - start;
logger.debug({ reminder_id: args.reminder.id, resend_rt_ms: elapsed }, 'Resend RT');
```

Después correr Benchmark 1 + parsear `resend_rt_ms` / `telegram_rt_ms` desde los logs de EasyPanel.

**Decisión cerrada** (T-037): no agregar este logging por default (invasivo a feature code para una métrica que no condiciona ninguna decisión de producto). Activar si:
1. p95 del endpoint dispatch-reminder (Benchmark 2) excede targets consistente.
2. Lautaro pide investigar latencia productiva específica.

Follow-up `T-037-FU2` (`feature`, opcional): suma timing wrappers en senders + dashboard Sentry custom metric.

---

## Cómo correr el benchmark completo

1. **Pre**: sesión Studio + cuenta productiva con telegram linked.
2. Crear 3 events placeholder via UI (`BENCHMARK 1 latency`, `BENCHMARK 2 rt`, `BENCHMARK 3 throughput`).
3. Correr Benchmark 1 setup → esperar 5 min → medición.
4. Benchmark 2 reusa los datos de Benchmark 1 (mismo set de reminders procesados).
5. Correr Benchmark 3 setup → ejecución → verificación.
6. Cleanup de los 3 events + reminders.
7. **Resultados** → pegar a la tabla de "Resultados productivos medidos" abajo + fecha de medición.

Tiempo total estimado: **20-25 min** (incluyendo esperas del cron).

---

## Resultados productivos medidos

Tabla a llenar post-medición. Formato sugerido:

| Fecha | Métrica | p50 | p95 | p99 | Pass/Fail vs target | Notas |
|---|---|---|---|---|---|---|
| YYYY-MM-DD | Latencia scheduled_at → sent | _seconds_ | _seconds_ | _seconds_ | ✅/❌ | _e.g. "cron tick cayó a +2:30 del scheduled_at"_ |
| YYYY-MM-DD | Endpoint dispatch-reminder RT | _ms_ | _ms_ | _ms_ | ✅/❌ | _e.g. "Telegram + Email serial = ~600ms baseline"_ |
| YYYY-MM-DD | process_pending_reminders 100 reminders | _ms_ | n/a | n/a | ✅/❌ | _e.g. "incluyó 100 pg_net.http_post async — no espera"_ |

**Pendiente de primera medición**: post-merge T-037 (Lautaro corre el benchmark + pega resultados acá).
