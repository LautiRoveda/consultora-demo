# Discovery 07 · Calendario de vencimientos + Notificaciones multi-canal

Discovery del módulo más grande de Fase 1 después de Informes. Es el segundo pilar del producto (decisión D08): el calendario es lo que diferencia a ConsultoraDemo de un generador de informes con IA — sin alertas proactivas no hay "te avisa antes de la multa, no después".

Este documento NO produce código. El output son los inputs claros para los tickets T-027 a T-037+ que vienen después. La sección 10 contiene las 7 preguntas que Lautaro tiene que responder antes de arrancar a codear.

---

## 1. Problema y oportunidad

### Pain point

El consultor HyS argentino (Marina, Persona A — `02-personas.md`) atiende 10-15 clientes en paralelo. Cada cliente tiene **decenas de vencimientos legales recurrentes** que se solapan en el calendario:

- Entregas de EPP cada 6 meses por empleado (Resolución SRT 299/11).
- Protocolos de medición anuales (ruido Res 85/12, iluminación Res 84/12, puesta a tierra, RGRL, carga de fuego).
- Calibraciones de instrumental: sonómetro, luxómetro, telurómetro, anemómetro, multigás (típicamente anuales).
- Capacitaciones obligatorias periódicas (manejo de cargas, EPP, trabajo en altura, primeros auxilios).
- Exámenes médicos periódicos de los empleados (anuales).
- Renovación anual del RGRL ante la ART.

Una consultora con 12 clientes y un promedio de 20 empleados por cliente maneja **>240 vencimientos de EPP simultáneos**, más 60-100 vencimientos de protocolos y calibraciones. Excel + Google Calendar + WhatsApp no escala: se olvidan, se postergan, se pierden.

### Por qué hoy se les pasa

De `02-personas.md` (Marina, frustración #2):

> *"Le pasó dos veces el año pasado: se le venció un protocolo anual de ruido y el cliente renovó con otro consultor antes de que ella se diera cuenta. Pérdida estimada: USD 600/año por incidente."*

Las herramientas que usa hoy:

- **Calendar de Google** — entrada manual cada vez, sin contexto del cliente/empleado/norma, sin escalado de recordatorios.
- **Excel maestro** — fórmulas con `=B2+180` para calcular próxima entrega EPP. Frágil, no avisa.
- **Libreta papel** — se pierde, no se busca.
- **WhatsApp con el cliente** — se mezcla con consultas operativas, se pierde el aviso entre 200 mensajes.

Ninguna herramienta cruza "este empleado tiene EPP vencido + este cliente tiene RGRL en 30 días + este sonómetro vence la calibración en 15 días" en una sola vista accionable.

### El costo económico de olvidar

| Vencimiento olvidado | Multa típica / costo | Fuente |
|---|---|---|
| EPP no renovado a 6 meses por empleado (Res SRT 299/11) | 1-3 SMVM por empleado afectado, escalable si reincidencia. SMVM jul-2025 ≈ ARS 322k → ARS 322k-966k por empleado (USD 250-750) | Res SRT 299/11 + tabla de sanciones SRT |
| Protocolo anual de ruido/iluminación vencido | Multa similar + observación en auditoría ART. **Riesgo real: el cliente cambia de consultor.** Pérdida directa: USD 250-800/mes de abono | `01-mercado.md` "lo que cobra la consultora" |
| RGRL no presentado en plazo | Observación formal de la ART + posible exclusión de bonificación de alícuota | Res SRT 463/09 |
| Capacitación obligatoria no dictada → accidente | Responsabilidad civil del empleador + del profesional firmante. Juicio laboral con cargo de "negligencia". Litigiosidad alta (132,8 juicios cada 10.000 trabajadores en 2025). | `01-mercado.md` |

**Conclusión económica para el consultor:** un solo cliente perdido por olvido cubre 20 meses de Plan Pro (USD 30 × 20 = USD 600 ≈ una entrega EPP olvidada con multa mínima o un cliente que se va).

### Por qué Calendario + Notificaciones son UN módulo

Conceptualmente Calendario es "la fuente de verdad de los vencimientos" y Notificaciones es "el canal por donde avisamos". Pero **separarlos es overengineering para Fase 1**:

- Cada `calendar_event` necesita configuración de recordatorios desde su creación. Crear un evento sin schedule de notificación es inútil.
- El cron que dispara recordatorios necesita acceso atómico a los dos schemas (selectear eventos próximos + emitir notificación + marcar como enviado).
- Un módulo Notificaciones genérico desacoplado tiene sentido en Fase 4 cuando se sumen alertas no-calendario (ej: usage IA cerca del límite, factura impaga, nuevo accidente reportado por un técnico del equipo). Por ahora 95% de las notificaciones son recordatorios de calendario.

El módulo se llama internamente **Calendario** y absorbe la responsabilidad de orquestar canales. Cuando aparezca el primer caso de uso fuera del calendario, refactorizamos a Notificaciones standalone (trigger documentado en sección 10).

---

## 2. Casos de uso priorizados

| # | Caso de uso | Prioridad | Notas |
|---|---|---|---|
| UC-01 | Como consultor quiero crear un vencimiento de protocolo anual con 3 recordatorios escalados (30d/7d/día-de) | MUST | Caso más común. Defaults por tipo. |
| UC-02 | Como consultor quiero recibir email cuando un EPP de un cliente está por vencer | MUST | Pain point principal. Default: email a 14d/3d/día-de. |
| UC-03 | Como consultor quiero ver una vista calendario mensual de todos los vencimientos de todos mis clientes | MUST | Pantalla home del módulo. Filtros por cliente, tipo, status. |
| UC-04 | Como consultor quiero ver una vista lista/agenda priorizada por urgencia (vence-hoy, vence-7d, vence-30d) | MUST | Vista alternativa para mobile. Más accionable que calendario mensual. |
| UC-05 | Como consultor quiero recibir notificación en Telegram (canal preferido, no email) | MUST | Canal nativo argentino. WhatsApp se descartó por costo (Cloud API), Telegram es gratis. |
| UC-06 | Como consultor quiero crear un vencimiento recurrente (cada 12 meses, cada 6 meses) que se auto-regenera al completar | MUST | EPP a 6m, protocolo a 12m, calibración a 12m. Sin esto es inútil. |
| UC-07 | Como consultor quiero crear un vencimiento one-off (no recurrente) | MUST | Caso "el cliente me pidió que en 45 días le entregue un documento puntual". |
| UC-08 | Como consultor quiero marcar un vencimiento como completado y que se programe automáticamente el próximo (si recurrente) | MUST | Loop normal del consultor. Completar = dispara generación del siguiente. |
| UC-09 | Como consultor quiero snoozear un vencimiento puntual (correr la fecha sin completarlo) | MUST | Cliente postergó la visita. Recalcula reminders. |
| UC-10 | Como consultor quiero editar/cancelar un vencimiento ya creado | MUST | Errores se cometen. |
| UC-11 | Como consultor quiero mutear notificaciones de un canal específico (ej: pausar emails 7d porque me voy de vacaciones) | SHOULD | UX para vacaciones/feriados. Per-canal mute con expiración opcional. |
| UC-12 | Como consultor quiero recibir push web cuando estoy con el navegador abierto | SHOULD | Inmediatez. Soporte browsers modernos (Chrome/Firefox/Edge). Safari requiere PWA → Fase 3. |
| UC-13 | Como consultor quiero ver en el dashboard del home un panel "próximos vencimientos (7d)" sin entrar a la sección calendario | MUST | Visible al hacer login. Fricción cero. |
| UC-14 | Como consultor quiero que cuando genere un RGRL o un protocolo anual, el sistema me sugiera crear automáticamente el vencimiento de renovación a 12 meses | SHOULD | Integración con módulo Informes. Cierra el loop "genero → me acuerda". |
| UC-15 | Como consultor quiero exportar mis vencimientos a Google Calendar / iCal (archivo `.ics`) | COULD | Read-only export. Útil si el consultor quiere ver vencimientos en su calendario personal. Decisión abierta en sección 10. |
| UC-16 | Como consultor quiero configurar overrides de defaults por consultora (ej: yo prefiero 60d/14d/día-de para protocolos en lugar del default 30d/7d/día-de) | SHOULD | Settings por consultora, no por evento. Power-user feature. |
| UC-17 | Como consultor quiero que si bloqueo el bot de Telegram, el sistema haga fallback automático a email + me muestre un warning en UI | MUST | Resilience. Sin fallback, perderíamos recordatorios silenciosamente. |
| UC-18 | Como consultor quiero ver el historial de notificaciones enviadas por cada evento (¿se mandó el email de 30d? ¿el de 7d?) | SHOULD | Trust/auditoría. El consultor necesita ver que el sistema realmente avisó. |

---

## 3. Entidades y modelo de datos

Convención forward de naming en inglés (heredada de T-011, ver `03-data-model.md` nota T-011). Todas las tablas con `consultora_id NOT NULL` + RLS habilitado día uno + policies usando helpers T-015 (`is_member_of_consultora`, `is_owner_of_consultora`) — patrón canónico de T-019.

### 3.1 Relaciones (ASCII)

```
consultoras (T-011)
  └── calendar_events                         ──→ informes (opcional, FK nullable: vencimientos auto-creados desde informes)
        │
        ├── calendar_event_reminders          (1:N — los reminders programados de cada evento)
        │
        └── notification_log                  (N:1 — log inmutable: 1 row por envío)

consultora_members (T-011)
  └── notification_channel_prefs              (1:N — preferencias de canales por user)
        │
        ├── telegram_subscriptions            (1:1 user ↔ chat_id, único activo)
        │
        └── push_subscriptions                (1:N user ↔ N devices/browsers)
```

### 3.2 `calendar_events`

El vencimiento en sí.

```sql
create table public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  consultora_id     uuid not null references public.consultoras(id) on delete cascade,
  tipo              text not null
                    check (tipo in (
                      'protocolo_anual', 'epp_entrega', 'capacitacion',
                      'calibracion', 'examen_medico', 'rgrl_anual', 'custom'
                    )),
  titulo            text not null check (length(trim(titulo)) between 3 and 200),
  descripcion       text,                            -- markdown corto opcional
  cliente_id        uuid references public.clientes(id) on delete set null,  -- nullable: eventos no asociados a cliente
  empleado_id       uuid references public.empleados(id) on delete set null, -- nullable: solo aplica a epp/examen
  informe_id        uuid references public.informes(id) on delete set null,  -- nullable: link al informe que originó el evento
  fecha_vencimiento date not null,
  recurrence_months int check (recurrence_months is null or recurrence_months between 1 and 60),
                                                     -- NULL = one-off, 6 = cada 6 meses, 12 = anual
  status            text not null default 'pending'
                    check (status in ('pending', 'completed', 'snoozed', 'cancelled')),
  completed_at      timestamptz,
  completed_by      uuid references auth.users(id) on delete set null,
  snoozed_until     date,                            -- nullable, sólo si status='snoozed'
  reminder_offsets_days int[] not null default '{30,7,0}',
                                                     -- override per evento sobre el default del tipo
  metadata          jsonb,                           -- extensible (ej: instrumento_id para calibracion)
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_calevents_consultora_fecha
  on public.calendar_events(consultora_id, fecha_vencimiento)
  where status = 'pending';

create index idx_calevents_cliente
  on public.calendar_events(cliente_id) where cliente_id is not null;

create index idx_calevents_empleado
  on public.calendar_events(empleado_id) where empleado_id is not null;

create index idx_calevents_informe
  on public.calendar_events(informe_id) where informe_id is not null;
```

**Reglas RLS (T-015 helpers):**

| Operación | Policy | Quién puede |
|---|---|---|
| SELECT | `is_member_of_consultora(consultora_id)` | Cualquier member ve los eventos de su consultora |
| INSERT | `is_member_of_consultora(consultora_id)` + `created_by = auth.uid()` | Cualquier member crea, auto-atribuido |
| UPDATE | `is_member_of_consultora(consultora_id)` + (`created_by = auth.uid()` OR `is_owner_of_consultora(consultora_id)`) | Creator del evento o owner |
| DELETE | (sin policy → default-deny) | Hard-delete sólo via service-role. UI usa `status='cancelled'` |

Audit trigger AFTER INSERT/UPDATE/DELETE escribe a `audit_log` (`action: 'calendar_event_created' | 'calendar_event_updated' | 'calendar_event_completed' | 'calendar_event_cancelled'`).

### 3.3 `calendar_event_reminders`

Los recordatorios programados por evento. Una fila por (evento, offset) — pre-calculados al crear/editar el evento.

```sql
create table public.calendar_event_reminders (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.calendar_events(id) on delete cascade,
  consultora_id     uuid not null references public.consultoras(id) on delete cascade,
                    -- denormalizado para RLS fast-path sin join
  offset_days       int not null,                    -- 30, 7, 0 (día-de)
  scheduled_at      timestamptz not null,            -- timestamp absoluto en el cual disparar
  status            text not null default 'pending'
                    check (status in ('pending', 'sent', 'skipped', 'failed')),
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  unique (event_id, offset_days)
);

create index idx_reminders_due
  on public.calendar_event_reminders(scheduled_at)
  where status = 'pending';

create index idx_reminders_event
  on public.calendar_event_reminders(event_id);
```

**RLS:** `is_member_of_consultora(consultora_id)` para SELECT. INSERT/UPDATE sólo via service-role (sistema, no usuario). Sin DELETE policy.

**Importante:** `scheduled_at` se computa como `fecha_vencimiento - offset_days` al crear el reminder. El cron compara `scheduled_at <= now()` no `fecha_vencimiento`. Si `offset_days=30` y `fecha_vencimiento` es 2026-06-15, `scheduled_at = 2026-05-16 09:00 ART` (hora de envío configurable, sección 5).

### 3.4 `notification_channel_prefs`

Preferencias por user. Single-tenant per user en MVP — futuro multi-tenant via `consultora_id` opcional para overrides per-consultora.

```sql
create table public.notification_channel_prefs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  channel           text not null check (channel in ('email', 'telegram', 'push')),
  enabled           bool not null default true,
  muted_until       timestamptz,                     -- nullable, fecha de fin del mute
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, channel)
);

alter table public.notification_channel_prefs enable row level security;

create policy notif_prefs_own on public.notification_channel_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 3.5 `notification_log`

Log inmutable de envíos. Idempotencia + auditoría + UI de historial.

```sql
create table public.notification_log (
  id                uuid primary key default gen_random_uuid(),
  consultora_id     uuid not null references public.consultoras(id) on delete cascade,
  user_id           uuid not null references auth.users(id) on delete cascade,
  event_id          uuid references public.calendar_events(id) on delete set null,
  reminder_id       uuid references public.calendar_event_reminders(id) on delete set null,
  channel           text not null check (channel in ('email', 'telegram', 'push')),
  status            text not null check (status in ('sent', 'failed', 'bounced', 'rejected')),
  provider_message_id text,                          -- Resend message id, Telegram message_id, etc.
  error_code        text,
  error_detail      text,
  sent_at           timestamptz not null default now()
);

create index idx_notiflog_consultora
  on public.notification_log(consultora_id, sent_at desc);

create index idx_notiflog_event
  on public.notification_log(event_id) where event_id is not null;
```

**RLS:** SELECT via `is_member_of_consultora`. INSERT sólo via service-role (sistema). Sin UPDATE/DELETE — log inmutable (mismo patrón que `audit_log` T-011).

### 3.6 `telegram_subscriptions`

**Estado**: ✅ implementado en T-033, schema final (`20260515213829_telegram_subscriptions.sql`).
Difiere del schema original del discovery en 2 puntos: `telegram_chat_id` ahora
nullable (la fila se crea al generar el link_code, antes del `/start`); y se
suma `link_code_expires_at` para TTL declarativo sin cron de cleanup.
Adicionalmente, las RLS policies son granulares (SELECT/INSERT/UPDATE
separadas, DELETE default-deny) en lugar de `FOR ALL`, y se suma audit trigger
con diff guard. Schema implementado:

```sql
create table public.telegram_subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null unique references auth.users(id) on delete cascade,
  telegram_chat_id     bigint unique,                  -- nullable hasta /start
  telegram_username    text,
  link_code            text unique,                    -- 8 chars sin chars ambiguos
  link_code_expires_at timestamptz,                    -- TTL 15 min vía columna (sin cron cleanup)
  linked_at            timestamptz,
  unlinked_at          timestamptz,
  blocked_count        int not null default 0,         -- incrementa en 403, auto-unlink a los 3
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index idx_telegram_subs_pending_link on public.telegram_subscriptions(link_code)
  where link_code is not null and linked_at is null;

alter table public.telegram_subscriptions enable row level security;

create policy tg_subs_select_own on public.telegram_subscriptions
  for select using (user_id = auth.uid());

create policy tg_subs_insert_own on public.telegram_subscriptions
  for insert with check (user_id = auth.uid());

create policy tg_subs_update_own on public.telegram_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DELETE: sin policy authenticated (default-deny). Cleanup admin via service-role.
-- Audit trigger con diff guard sobre (linked_at, unlinked_at, blocked_count,
--   telegram_chat_id). link_code NUNCA en payload (security: código consumible).
--   chat_id reducido a boolean chat_id_is_set (PII protection).
```

**Nota de schema ajuste T-011 (forzado por T-033)**:
`audit_log.consultora_id` pasó a nullable (`alter table ... drop not null`)
en la migration de T-033 — el audit row de una subscription per-user no tiene
contexto consultora. FK `on delete restrict` queda intacta cuando
`consultora_id IS NOT NULL`.

### 3.7 `push_subscriptions`

```sql
create table public.push_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  endpoint        text not null,                     -- URL del Push Service del browser
  p256dh_key      text not null,                     -- pubkey ECDH client
  auth_key        text not null,                     -- shared secret cliente
  user_agent      text,                              -- diagnóstico (cuál browser/device)
  last_seen_at    timestamptz default now(),
  created_at      timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

create policy push_subs_own on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 3.8 Campos críticos detallados

| Campo | Tipo | Constraint | Por qué |
|---|---|---|---|
| `calendar_events.recurrence_months` | int | NULL or 1-60 | NULL = one-off explícito. Cap a 60 (5 años) para evitar valores absurdos. |
| `calendar_events.reminder_offsets_days` | int[] | Default `{30,7,0}` | Array de offsets en días. `0` = día-de. Override per evento. |
| `calendar_event_reminders.scheduled_at` | timestamptz | NOT NULL | Calculado server-side, indexado para cron. UTC en DB, render local en UI. |
| `calendar_events.snoozed_until` | date | nullable | Sólo coherente con `status='snoozed'`. Validación de coherencia en server action, no en DB (evita check constraint complejo). |
| `notification_log.provider_message_id` | text | nullable | Resend ID para tracking bounces/complaints. Telegram message_id para reply tracking. Push: no aplica. |
| `telegram_subscriptions.blocked_count` | int | default 0 | Si llega a 3 consecutivas → marca subscription como inactiva + fallback a email. |

---

## 4. Tipos de eventos / vencimientos

Enum `calendar_events.tipo` con check constraint. Defaults de recordatorio por tipo viven en código (`src/shared/calendar/defaults.ts`) — no en DB para que sean editables sin migración.

| Tipo (enum) | Ejemplo | Recurrente | Frecuencia default | Reminders default (días antes) |
|---|---|---|---|---|
| `protocolo_anual` | Ruido (Res 85/12), iluminación (Res 84/12), puesta a tierra, carga de fuego | Sí | 12 meses | 30 / 7 / 0 |
| `epp_entrega` | Renovación EPP por empleado (Res SRT 299/11) | Sí | 6 meses | 14 / 3 / 0 |
| `capacitacion` | Capacitación EPP / trabajo en altura / primeros auxilios | Sí (configurable) | 12 meses default | 30 / 7 / 0 |
| `calibracion` | Calibración de sonómetro, luxómetro, telurómetro, anemómetro | Sí | 12 meses | 60 / 14 / 0 |
| `examen_medico` | Examen periódico ART por empleado | Sí | 12 meses | 30 / 7 / 0 |
| `rgrl_anual` | Presentación anual de RGRL ante la ART | Sí | 12 meses | 60 / 30 / 7 / 0 |
| `custom` | Vencimiento custom del consultor (puede ser one-off o recurrente) | One-off por default | N/A | 7 / 0 |

**Reasoning de defaults:**

- **EPP a 14/3/0:** la entrega obligatoria es a 6 meses; aviso a 14 días es tiempo razonable para que el consultor compre stock y agende la visita.
- **Calibración a 60/14/0:** las calibraciones requieren mandar el equipo a laboratorio externo (turnos largos). 60 días es prudente.
- **RGRL a 60/30/7/0:** muy crítico legalmente y el consultor necesita coordinar fecha con la ART.
- **Protocolo anual a 30/7/0:** estándar de la industria.

---

## 5. Sistema de recordatorios escalados

### 5.1 Cómo se computa el schedule

Al crear o editar un `calendar_event`, el sistema:

1. Lee `reminder_offsets_days` del evento (override) o del default del tipo.
2. Calcula `scheduled_at = fecha_vencimiento - offset_days` para cada offset.
3. Aplica la **hora preferida de envío** (default 09:00 ART, override per consultora — sección 6/10).
4. Si el offset cae en sábado/domingo → opcional shift al lunes próximo (decisión abierta, sección 10).
5. Inserta o upserta rows en `calendar_event_reminders` (UNIQUE en `(event_id, offset_days)`).
6. Si el `scheduled_at` calculado es **< now()**, marca el reminder como `status='skipped'` (evento creado tarde, no spam de recordatorios del pasado) — UI muestra warning "este recordatorio ya pasó cuando creaste el evento".

### 5.2 Defaults por tipo

Definidos en `src/shared/calendar/defaults.ts`:

```typescript
export const DEFAULT_REMINDER_OFFSETS_DAYS: Record<EventTipo, number[]> = {
  protocolo_anual: [30, 7, 0],
  epp_entrega: [14, 3, 0],
  capacitacion: [30, 7, 0],
  calibracion: [60, 14, 0],
  examen_medico: [30, 7, 0],
  rgrl_anual: [60, 30, 7, 0],
  custom: [7, 0],
};
```

### 5.3 Override por evento

El form de crear/editar evento expone un campo "Recordatorios" con multi-input numérico (ej: `[45, 14, 0]`). Validación Zod: array no vacío, máx 6 elementos, cada int entre 0 y 365, sin duplicados, ordenado descendente al persistir.

### 5.4 Override por consultora

Una tabla simple (`consultora_calendar_defaults`) con `consultora_id + tipo + reminder_offsets_days` permite que el power-user defina "para protocolos anuales mi consultora siempre quiere 60/14/0 en vez del default 30/7/0". Override jerárquico: evento > consultora > tipo global. Esta tabla puede sumarse en un sub-ticket follow-up sin bloquear el MVP del calendario (T-035-ish).

### 5.5 Edge case: reminder en el pasado

Si el consultor crea un evento un domingo para un vencimiento el martes próximo y el default tiene un offset de 30 días → el reminder de 30d cae en el pasado. Comportamiento esperado:

- El sistema **NO envía** el reminder retroactivo (no spam de "esto te lo tendría que haber avisado hace 28 días").
- Marca el reminder como `status='skipped'`.
- UI del form muestra warning **antes de submit**: *"El recordatorio de 30 días no se va a enviar porque la fecha de vencimiento es en menos de 30 días."*
- Los reminders futuros (7d, 0d en este ejemplo) sí se programan normalmente.

---

## 6. Canales de notificación

### 6.1 Email (Resend)

**Setup operativo:**

- Cuenta Resend (free tier: 100 emails/día, 3000/mes — suficiente para los primeros ~5 consultores con ~10 reminders/día c/u). Plan Pro de Resend (USD 20/mes) si crecemos: 50k/mes.
- API key en `RESEND_API_KEY` (server-only env var, validada en `src/env.ts`).
- Dominio sender: `notificaciones@consultora-demo.test-ia.cloud`. Hay que **verificar dominio en Resend** + configurar registros DNS:
  - SPF: `v=spf1 include:amazonses.com ~all` (Resend usa AWS SES backend).
  - DKIM: registro CNAME que Resend genera al verificar.
  - DMARC opcional inicial: `v=DMARC1; p=none; rua=mailto:lautaroeroveda@gmail.com`.
- Sender Name: "ConsultoraDemo".
- Reply-To: `lautaroeroveda@gmail.com` durante MVP (cuando crezca, soporte@).

**Templates:**

Patrón heredado de T-079 (HTML inline + table-based layout). 1 template por tipo de reminder (o 1 template genérico parametrizado — decisión abierta sección 10). Ejemplo:

```
Asunto: [ConsultoraDemo] EPP de Juan Pérez vence en 14 días — Constructora del Sur

Body:
- Hola {nombre_consultor},
- El EPP que entregaste a Juan Pérez (DNI 30.111.222) en Constructora del Sur vence el 2026-06-15.
- Faltan 14 días.
- [Ver vencimiento en ConsultoraDemo →]
- Si no querés más estos avisos: configurá tus canales acá.
```

**Manejo de bounces y spam complaints:**

Resend webhook → endpoint `/api/webhooks/resend` valida firma → marca subscription como inactiva o el `notification_log` row como `status='bounced'`. Hard bounce permanente → flag email del user como inválido + UI muestra warning "tu email rebotó, configurá otro canal".

**Rate limits:**

Resend free tier: 100/día. Si superamos esto antes de tener Plan Pro de Resend, el cron prioriza por urgencia (offset menor primero) y deja los menos urgentes para el próximo tick.

**Costos:**

USD 0 hasta ~5 consultoras activas. USD 20/mes Plan Pro de Resend cuando crezcamos.

### 6.2 Telegram (Bot API)

**Setup operativo:**

- Bot creado vía BotFather: nombre `ConsultoraDemoBot` (o similar disponible). Token guardado en `TELEGRAM_BOT_TOKEN`.
- Webhook configurado: `POST https://consultora-demo.test-ia.cloud/api/webhooks/telegram` (registro vía one-off `curl` a la API Telegram).
- En EasyPanel: asegurar que el endpoint `/api/webhooks/telegram` es público (no requiere auth Supabase).

**Flow de subscripción:**

1. User va a Settings → Canales → "Conectá Telegram".
2. Backend genera `link_code` único de 8 chars, persiste en `telegram_subscriptions` con `user_id` y `link_code`.
3. UI muestra deep-link: `https://t.me/ConsultoraDemoBot?start=<link_code>`.
4. User clickea, abre Telegram, ve botón "Iniciar".
5. Telegram envía `/start <link_code>` al bot. El webhook handler busca el `link_code` en DB, asocia el `chat_id` del update, marca `linked_at = now()`.
6. Bot responde: *"Listo, te aviso por acá cuando algo esté por vencer."*
7. UI poll-ea (o usa Supabase Realtime) y muestra "Telegram conectado ✓".

**Templates de mensaje:**

Markdown V2 con escape de caracteres reservados. Ejemplo:

```
*EPP de Juan Pérez vence en 14 días*

Constructora del Sur · Vence el 15\\-06\\-2026

[Ver en ConsultoraDemo](https://consultora-demo.test-ia.cloud/calendario/...)
```

**Manejo de bot bloqueado:**

- Telegram devuelve HTTP 403 "Forbidden: bot was blocked by the user".
- El sender incrementa `blocked_count`. A los 3 fallos consecutivos marca `unlinked_at = now()` + cae a fallback email + notif UI in-app: *"Tu bot de Telegram está bloqueado. Reconectá o se va a enviar todo por email."*
- Si el user desbloquea y vuelve a hacer `/start`, el `link_code` viejo se invalida (ya está consumido) y se le pide generar uno nuevo desde la UI.

**Costos:** USD 0. Telegram Bot API es gratis sin límites realistas para nuestro volumen (Telegram permite ~30 msg/seg por bot, muy por arriba de nuestras necesidades).

### 6.3 Web Push

**Setup operativo:**

- Generar par VAPID (public + private) una sola vez. Server: `VAPID_PRIVATE_KEY` env var. Cliente: `VAPID_PUBLIC_KEY` env var public (exposable).
- Service Worker en `public/sw.js` registrado por el cliente al primer login post-permiso.
- Tabla `push_subscriptions` (sección 3.7) guarda endpoint + keys del browser.

**Flow de permisos en browser:**

1. Settings → Canales → "Activar notificaciones del navegador".
2. JS llama `Notification.requestPermission()`.
3. Si granted → `serviceWorker.pushManager.subscribe({ applicationServerKey: VAPID_PUBLIC_KEY })`.
4. Persiste subscription en DB via Server Action.

**Compatibilidad:**

| Browser | Soporte Web Push | Notas |
|---|---|---|
| Chrome desktop | ✓ Full | Pista canónica |
| Firefox desktop | ✓ Full | Idem |
| Edge desktop | ✓ Full | Usa el mismo backend que Chrome |
| Safari desktop (16.4+) | ✓ Requiere PWA installed | **Out-of-scope MVP** — se posterga a Fase 3 (PWA). Decisión abierta sección 10. |
| Chrome Android | ✓ Full | |
| iOS Safari (16.4+) | ✓ Requiere PWA installed + Add to Home Screen | Idem. Fase 3. |

**Payload:**

JSON corto, max 4KB (limit Push API):

```json
{
  "title": "EPP de Juan Pérez vence en 14 días",
  "body": "Constructora del Sur · 15-06-2026",
  "url": "/calendario/eventos/...",
  "tag": "epp_entrega_..."
}
```

**Service Worker** muestra la notificación, abre la URL al click (`event.waitUntil(clients.openWindow(url))`).

**Limitaciones:**

- Browser tiene que haber estado abierto en los últimos días (los Push Services del browser hacen aging).
- El usuario puede revocar permisos desde el browser → próximo send falla con HTTP 410 Gone → cleanup automático del row en `push_subscriptions`.
- No funciona en modo incógnito.

**Costos:** USD 0. Push Service de Chrome/Firefox/Edge es gratuito, depende solo de los browsers.

---

## 7. Cron / scheduling

### 7.1 Decisión técnica

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| **pg_cron + pg_net (Supabase)** | Atómico con la DB, ya habilitado en T-005, sin dep externa, mismo runtime de RLS, ya pago en Supabase Pro | Requiere habilitar `pg_net` (no está en T-005) + DB hace HTTP outbound (anti-pattern para algunos pero soportado oficialmente por Supabase) |
| EasyPanel cron + endpoint Next.js | Server-side puro, fácil de testear | Otro proceso a monitorear, single-point-of-failure si EasyPanel cron falla, hay que autorizar el endpoint con secret |
| Servicio externo (cron-job.org, EasyCron) | Sin infraestructura | Dependencia externa pago, latencia de red, autenticación |
| Job queue dedicado (BullMQ, Inngest) | Robusto, retries, dead-letter queue | Overhead enorme para Fase 1 |

**Recomendación: pg_cron + pg_net.**

- Ya tenemos `pg_cron` habilitado en T-005 — sumar `pg_net` es 1 línea de migration.
- Atómico: la función SQL puede `SELECT FOR UPDATE SKIP LOCKED` los reminders due, marcarlos `status='sent'` ANTES de hacer el HTTP request → si el HTTP falla, segundo intento del cron los reintenta.
- Sin servidor adicional, sin secret rotation, sin red latency entre cron y DB.
- Tradeoff aceptado: el HTTP outbound desde Postgres no es lo más sexy pero es el patrón canónico que Supabase recomienda explícitamente para este caso de uso.

### 7.2 Frecuencia del job

**Decisión: cada 5 minutos.**

Tradeoff:

- Cada 1 min → más carga (sin razón), más eventos de cron, más logs.
- Cada 5 min → latencia worst-case 5 minutos entre `scheduled_at` y el envío. Para reminders de "14d antes" o "30d antes", 5 minutos de jitter es irrelevante. Para "día-de" enviado a las 09:00 ART, también irrelevante (5 min de jitter en una notificación diaria).
- Cada 15-30 min → empieza a importar para reminders del "día-de" si el user esperaba notificación a las 09:00 puntuales.

5 min es el sweet spot.

### 7.3 Función SQL `process_pending_reminders()`

Pseudocódigo SQL:

```sql
create or replace function public.process_pending_reminders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  payload jsonb;
begin
  -- Lock + claim reminders due. SKIP LOCKED evita contención si dos crons corren simultáneo.
  for r in
    select cer.id as reminder_id, cer.event_id, cer.consultora_id, cer.offset_days,
           ce.tipo, ce.titulo, ce.fecha_vencimiento, ce.created_by, ce.cliente_id, ce.empleado_id
    from public.calendar_event_reminders cer
    join public.calendar_events ce on ce.id = cer.event_id
    where cer.status = 'pending'
      and cer.scheduled_at <= now()
      and ce.status = 'pending'  -- skipea si el evento fue completed/cancelled
    order by cer.scheduled_at
    limit 100
    for update of cer skip locked
  loop
    -- Marca como 'sent' EN LA MISMA TX que dispara el HTTP. Si el HTTP falla, igual queda marcado:
    -- el sender (Next.js endpoint) es responsable de loggear failure en notification_log.
    -- Tradeoff: at-most-once delivery. Idempotencia compensa.
    update public.calendar_event_reminders
       set status = 'sent', sent_at = now()
     where id = r.reminder_id;

    -- POST a endpoint interno con auth header (shared secret env).
    perform net.http_post(
      url := 'https://consultora-demo.test-ia.cloud/api/calendar/dispatch-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Internal-Cron-Secret', current_setting('app.cron_secret', true)
      ),
      body := jsonb_build_object('reminder_id', r.reminder_id)
    );
  end loop;
end;
$$;

-- Cron entry
select cron.schedule(
  'process-pending-reminders',
  '*/5 * * * *',
  'select public.process_pending_reminders()'
);
```

**El endpoint Next.js** (`/api/calendar/dispatch-reminder`) hace el trabajo pesado:

1. Valida header `X-Internal-Cron-Secret` contra env (cron_secret).
2. Lee el reminder + event con service-role.
3. Lee preferencias de canales del user.
4. Para cada canal habilitado y no muteado: emite la notificación (Resend, Telegram, Push).
5. Loggea en `notification_log` cada attempt con status.

### 7.4 Idempotencia

Mecanismos en cascada:

1. **DB layer:** `UNIQUE (event_id, offset_days)` en `calendar_event_reminders` previene duplicados al crear.
2. **Claim layer:** `UPDATE ... SET status='sent'` en la misma TX que el cron dispara → si el cron corre 2 veces (raro pero posible si la función se ejecuta más lento que el intervalo), el segundo no encuentra rows con `status='pending'`.
3. **Sender layer:** el endpoint `/dispatch-reminder` chequea `notification_log` por `(reminder_id, channel, status='sent')` antes de emitir → si ya se envió, skipea (defense in depth).
4. **Provider layer:** Resend tiene idempotency keys nativos; los usamos passando `reminder_id` como key.

---

## 8. UI / UX wireframes (ASCII)

### 8.1 Vista calendario mensual (`/calendario`)

```
┌──────────────────────────────────────────────────────────────────┐
│ ConsultoraDemo                          Lautaro ▼ · Cerrar sesión│
├──────────────────────────────────────────────────────────────────┤
│ [Dashboard] [Informes] [▼ Calendario] [Empleados] [EPP] [Settings]│
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  Calendario · Junio 2026                  [+ Nuevo vencimiento]  │
│  [Mensual ▾]  [Agenda]  Filtros: [Cliente ▼] [Tipo ▼] [Estado ▼] │
│                                                                   │
│  ◀ Mayo   Junio 2026   Julio ▶                                   │
│                                                                   │
│  L     M     M     J     V     S     D                            │
│  ┌────┬────┬────┬────┬────┬────┬────┐                            │
│  │ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │ 7  │                            │
│  │    │ ●  │    │    │    │    │    │                            │
│  ├────┼────┼────┼────┼────┼────┼────┤                            │
│  │ 8  │ 9  │ 10 │ 11 │ 12 │ 13 │ 14 │                            │
│  │    │    │ ●● │    │ ●  │    │    │                            │
│  ├────┼────┼────┼────┼────┼────┼────┤                            │
│  │ 15 │ 16 │ 17 │ 18 │ 19 │ 20 │ 21 │                            │
│  │ ●  │    │    │ ●  │    │    │ ●  │                            │
│  └────┴────┴────┴────┴────┴────┴────┘                            │
│                                                                   │
│  ● Pendiente   ●● 2+ eventos   ✓ Completado   ⚠ Vencido          │
└──────────────────────────────────────────────────────────────────┘
```

Click en un día → drawer lateral con los eventos del día.

### 8.2 Vista agenda lista (`/calendario/agenda`)

```
┌──────────────────────────────────────────────────────────────────┐
│  Calendario · Agenda                       [+ Nuevo vencimiento] │
│  [Mensual]  [Agenda ▾]  Filtros: [...]                           │
│                                                                   │
│  Vencen HOY (3)                                                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ ⚠ Protocolo de ruido · Metalúrgica Norte                 │   │
│  │   2026-06-13 · Última visita: 2025-06-14                 │   │
│  │   [Marcar completado] [Snooze] [Editar]                  │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Vencen en 7 días (5)                                            │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │ ● EPP · Juan Pérez (DNI 30111222) · Constructora del Sur │   │
│  │   2026-06-20                                              │   │
│  └───────────────────────────────────────────────────────────┘   │
│                                                                   │
│  Vencen en 30 días (12)                                          │
│  [Ver todos ▾]                                                   │
└──────────────────────────────────────────────────────────────────┘
```

### 8.3 Form crear/editar evento (modal)

```
┌────────────────────────────────────────────────┐
│  Nuevo vencimiento                         [X] │
├────────────────────────────────────────────────┤
│  Tipo *                                        │
│  [protocolo_anual ▼]                           │
│                                                │
│  Título *                                      │
│  [Protocolo de ruido — Metalúrgica Norte    ]  │
│                                                │
│  Cliente                                       │
│  [Metalúrgica Norte ▼]                         │
│                                                │
│  Empleado (solo EPP / examen médico)           │
│  [— ▼]                                         │
│                                                │
│  Fecha de vencimiento *                        │
│  [2026-06-20]                                  │
│                                                │
│  ☑ Recurrente                                  │
│  Cada [12] meses                               │
│                                                │
│  Recordatorios (días antes)                    │
│  [30] [7] [0]   [+ Agregar]                    │
│  Default del tipo: 30 / 7 / 0                  │
│                                                │
│  Descripción (opcional)                        │
│  [Markdown corto...]                           │
│                                                │
│             [Cancelar]  [Crear vencimiento]    │
└────────────────────────────────────────────────┘
```

### 8.4 Panel "Próximos vencimientos" en `/dashboard`

```
┌───────────────────────────────────────────────┐
│  Próximos vencimientos                        │
│  ──────────────────────────────────────────   │
│  ⚠ Hoy: 3                                     │
│  ● 7 días: 5                                  │
│  ● 30 días: 12                                │
│                                               │
│  Más urgente:                                 │
│  Protocolo ruido · Metalúrgica Norte · HOY    │
│                                               │
│  [Ver todos →]                                │
└───────────────────────────────────────────────┘
```

### 8.5 Settings de canales (`/settings/notificaciones`)

```
┌──────────────────────────────────────────────────────────────────┐
│  Settings · Notificaciones                                       │
│                                                                   │
│  Canales habilitados                                             │
│  ──────────────────────────────────────────                      │
│  ☑ Email          lautaroeroveda@gmail.com                       │
│  ☑ Telegram       @lautaroeroveda (conectado ✓)                  │
│                   [Desconectar]                                  │
│  ☐ Push web       [Activar notificaciones del navegador]         │
│                                                                   │
│  Mute temporal                                                   │
│  ──────────────────────────────────────────                      │
│  Estoy de vacaciones: [No mutear ▾]                              │
│   ↳ Opciones: No mutear / 7 días / 14 días / Hasta fecha custom  │
│                                                                   │
│  Defaults de recordatorios por tipo                              │
│  ──────────────────────────────────────────                      │
│  protocolo_anual:   [30, 7, 0]    [Editar]                       │
│  epp_entrega:       [14, 3, 0]    [Editar]                       │
│  ...                                                              │
│                                                                   │
│                                              [Guardar cambios]   │
└──────────────────────────────────────────────────────────────────┘
```

### 8.6 Email template preview (Resend)

Patrón heredado de T-079 (`docs/operations/email-templates.md`): HTML inline, table-based 600px, paleta indigo, system font stack, preheader hidden text, `<meta name="color-scheme" content="light">`.

### 8.7 Telegram message preview

```
ConsultoraDemoBot:

*Protocolo de ruido vence en 7 días*

Cliente: Metalúrgica Norte
Vence: 20\-06\-2026

[Ver en ConsultoraDemo](https://consultora-demo.test-ia.cloud/calendario/eventos/abc-123)

[Cambiar canales de notificación]
```

### 8.8 Push notification preview

```
┌──────────────────────────────────────┐
│ 🔔 ConsultoraDemo                    │
│                                      │
│ EPP de Juan Pérez vence en 14 días   │
│ Constructora del Sur · 15-06-2026    │
└──────────────────────────────────────┘
```

---

## 9. Edge cases

| # | Caso | Resolución |
|---|---|---|
| EC-01 | Consultor cambia `fecha_vencimiento` de un evento ya con reminders programados | Server action recalcula `scheduled_at` de cada reminder pending. Reminders ya `sent` quedan inmutables en `notification_log`. |
| EC-02 | Consultor cambia `reminder_offsets_days` de un evento | UPSERT por `(event_id, offset_days)`. Offsets eliminados → reminders con `status='pending'` y offset removido se DELETE (cascada `ON DELETE`). |
| EC-03 | Evento llega a fecha de vencimiento sin completarse | `status` queda `pending` pero UI lo muestra en sección "Vencidos" con badge ⚠. No se mandan más reminders (el último `offset_days=0` ya disparó). Hasta que el consultor lo marque `completed` o `cancelled`. |
| EC-04 | Consultor marca evento como `completed` | Si `recurrence_months IS NOT NULL`: el sistema **crea automáticamente el siguiente evento** con `fecha_vencimiento = old.fecha_vencimiento + recurrence_months`. El nuevo evento hereda `reminder_offsets_days` y metadata. UI muestra toast: *"Listo. Próximo vencimiento programado para 2027-06-20."* Reminders pending del evento completado se DELETE en cascada. |
| EC-05 | Consultor `cancelled` evento | Reminders pending se DELETE. Audit log captura `action: 'calendar_event_cancelled'`. UI lo oculta de la vista default (filtro "Activos") pero accesible en "Cancelados". |
| EC-06 | Consultor cambia `cliente_id` del evento (ej: traspaso a otro cliente) | UPDATE simple. Audit log captura el cambio. Reminders pending mantienen el mismo `scheduled_at`. |
| EC-07 | User no tiene Telegram configurado pero canal Telegram tildado en defaults | El dispatcher detecta que `telegram_subscriptions.unlinked_at IS NOT NULL` o no existe row → cae a email automático + loggea `channel: 'telegram', status: 'rejected', error_code: 'NO_SUBSCRIPTION'`. |
| EC-08 | User pone mute global (todos los canales) | Todos los canales como `enabled=false` en `notification_channel_prefs` → dispatcher no emite nada → log `status: 'rejected', error_code: 'ALL_MUTED'` por canal. Evento sigue vivo, reminders se marcan `status='skipped'` con razón. |
| EC-09 | User mutea sólo Telegram con `muted_until = 2026-07-01` | Hasta esa fecha, dispatch a Telegram skipea; email + push siguen normales. A partir del 2026-07-01, vuelve a usar Telegram. |
| EC-10 | Dos consultoras tienen un cliente con mismo CUIT | RLS aísla: cada consultora ve sólo sus eventos. Cliente A en Consultora1 ≠ Cliente A en Consultora2 (FK independientes a sus respectivos rows). |
| EC-11 | Bot Telegram bloqueado por user | Sender recibe HTTP 403 → incrementa `blocked_count`. 3 fallos consecutivos → `unlinked_at = now()` + fallback automático a email + warning UI in-app "tu Telegram está bloqueado". |
| EC-12 | Browser revoca Web Push permission | Next send retorna HTTP 410 Gone del Push Service → cleanup automático del row en `push_subscriptions`. UI muestra warning "perdiste push, reactivá si querés". |
| EC-13 | Resend bounce permanente (email inválido) | Webhook Resend → marca `notification_log.status='bounced'`. Si 3 bounces consecutivos del mismo email → flag user `email_invalid=true` + notif fallback a Telegram + warning UI "tu email rebota, corregilo en Settings". |
| EC-14 | Reminder `scheduled_at` cae en horario nocturno o feriado | **Decisión abierta sección 10.** Propuesta: si `09:00 ART` cae en sábado/domingo, shift al lunes 09:00. Feriados no se manejan en MVP (futuro: integración con calendario de feriados argentinos). |
| EC-15 | Cron corre 2 veces simultáneo (race condition) | `SELECT ... FOR UPDATE SKIP LOCKED` en `process_pending_reminders()` previene contention. Cada cron toma un subset disjunto de reminders. |
| EC-16 | Eliminar un cliente con eventos activos | FK `cliente_id` tiene `ON DELETE SET NULL`. Los eventos quedan huérfanos (cliente_id=null) pero vivos. Audit log preserva el nombre del cliente en el momento del cambio. UI muestra "Cliente eliminado" en la card del evento. |
| EC-17 | Eliminar un empleado con eventos EPP/examen activos | Idem EC-16 (FK `empleado_id ON DELETE SET NULL`). Eventos quedan visibles pero sin referencia. **Decisión abierta sección 10:** ¿deberíamos cancelar automáticamente los eventos de un empleado eliminado? |
| EC-18 | Eliminar consultora (cascade) | `ON DELETE CASCADE` desde `calendar_events` y `calendar_event_reminders`. `notification_log` también cascadea. `audit_log` queda (FK `RESTRICT` o `SET NULL` según `tenancy.sql:147`). |
| EC-19 | Reminder en el pasado al crear evento | Marca `status='skipped'` con razón. UI muestra warning antes de submit. |
| EC-20 | Consultor regenera link Telegram (perdió el chat) | Genera nuevo `link_code`, mantiene `telegram_subscriptions` viejo como histórico (`unlinked_at`) o sobrescribe el row según política. **Propuesta:** sobrescribir; conservar el `chat_id` nuevo. |

---

## 10. Tradeoffs y decisiones abiertas

Las 7 decisiones críticas — **resueltas el 2026-05-14 por Lautaro**. Las opciones evaluadas quedan como registro histórico; la línea `Resuelto` indica la decisión final que toma cada ticket de implementación.

### DA-01 · Templates email: ¿Resend HTML inline (patrón T-079) o React Email?

- **Opción A — HTML inline + tablas** (patrón T-079): consistencia con templates de Auth, sin dep nueva, fácil de revisar en `docs/operations/`. Pago: mantenimiento manual de HTML, menos componibilidad.
- **Opción B — `react-email`** (Resend's preferred): components React, preview en dev server, fácil dark mode. Pago: dep nueva (~1.5 MB), build step adicional, divergencia con templates de Auth.
- **Resuelto (2026-05-14):** Opción A — HTML inline patrón T-079. Sin `react-email`: consistencia con templates de Auth, sin dep nueva. Si el catálogo crece > 10 templates, reabrir como follow-up.

### DA-02 · Web Push: ¿requiere PWA install?

- **Opción A — Web Push sin PWA** (Chrome/Firefox/Edge desktop + Chrome Android): cubre 70% de los browsers de Marina, fricción cero, MVP-ready.
- **Opción B — Web Push con PWA install** (cubre Safari desktop + iOS Safari también): requiere manifest + service worker + UI "instalá la app". Más fricción de onboarding.
- **Resuelto (2026-05-14):** Opción A — Web Push sin PWA en MVP. Cobertura Chrome/Firefox/Edge desktop + Chrome Android. Safari desktop e iOS Safari **salen automáticamente cuando entre Fase 3 PWA** (ya en el roadmap), no requiere ticket separado.

### DA-03 · Settings de canales: ¿per-user o per-consultora?

- **Opción A — per-user:** cada miembro de la consultora elige sus canales. En MVP single-tenant per user no hay diferencia. Cuando llegue Plan Team (Fase 2) cada técnico configura el suyo.
- **Opción B — per-consultora:** el owner define para todos. Pierde personalización pero simplifica admin.
- **Resuelto (2026-05-14):** Opción A — settings de canales per-user (schema ya diseñado para esto vía `notification_channel_prefs.user_id`). Defaults de recordatorios sí son per-consultora (la consultora setea defaults, cada user elige canales). En MVP single-tenant per user la distinción no se nota, pero deja el path libre para Plan Team.

### DA-04 · Snooze: ¿límite o ilimitado?

- **Opción A — ilimitado:** el consultor snoozea las veces que quiera. Riesgo: evento snoozeado eternamente, multa por olvido real.
- **Opción B — máximo 3 snoozes:** después del 3°, no se puede snoozear, sólo completar o cancelar.
- **Opción C — sin snooze, sólo edit fecha de vencimiento:** más simple, fuerza al consultor a decidir nueva fecha real.
- **Resuelto (2026-05-14):** Opción C — sin snooze en MVP. Si el user quiere posponer, edita la fecha real del evento (UPDATE de `fecha_vencimiento`, recálculo de reminders). Snooze como state machine separado agrega complejidad UX que no vale en MVP. Reabrir si feedback de 3+ consultores lo pide.

### DA-05 · Integración con Informes: ¿auto-crear evento al generar informe?

- **Opción A — auto-creación silenciosa:** al firmar un RGRL o protocolo, se inserta automáticamente un `calendar_event` con `tipo='rgrl_anual'` o `tipo='protocolo_anual'` + `fecha_vencimiento = today + 12m`.
- **Opción B — modal de confirmación post-firma:** "¿Querés agendar la renovación a 12 meses?" con botón [Sí, agendar] / [No].
- **Opción C — sin integración en MVP** (el consultor lo crea manual).
- **Resuelto (2026-05-14):** Opción B **híbrida con opt-in a Opción A**. Modal post-firma por default: "¿Querés agendar la renovación a 12 meses?". Settings suma toggle "Auto-crear vencimiento al firmar informes" (default OFF). Si el user activa el toggle → silent auto-creation sin modal (Opción A). Esto combina pit-of-success en el primer uso (modal descubre la feature) + power-user opt-in (toggle silent para quien ya entendió el flow). Impacto en plan de tickets: T-035 suma el toggle a Settings; T-036 implementa ambas paths (modal default + silent si toggle ON).

### DA-06 · Export `.ics` (Google Calendar / iCal): ¿MVP o follow-up?

- **Opción A — MVP:** endpoint `/api/calendar/export.ics?token=...` con todos los eventos pending del user. Útil si el consultor quiere ver en su Google Calendar personal.
- **Opción B — follow-up post-MVP:** dejar para cuando un usuario lo pida explícitamente.
- **Resuelto (2026-05-14):** Opción B — export `.ics` follow-up post-MVP. Esperar demanda real de un usuario antes de invertir 2-3 días. Queda en backlog como F3 (sección 11).

### DA-07 · Compartir vencimiento con cliente final (empleador HyS): ¿MVP o Fase 2 (Plan Team)?

- **Opción A — MVP:** el consultor puede compartir un vencimiento con el cliente vía link público read-only (sin login). El cliente recibe email "tu consultor te recuerda que X vence el Y".
- **Opción B — Fase 2 (Plan Team):** parte del feature "cliente ve su dashboard" del Plan Team. Más infra, más auth.
- **Opción C — fuera de scope total:** el cliente NO es nuestro usuario (decisión D01 — `00-decisiones.md`).
- **Resuelto (2026-05-14):** Opción C — fuera de scope. Coherente con D01 (`00-decisiones.md`): nuestro user es el consultor, no el empleador HyS. Si el consultor quiere mostrar el vencimiento al cliente, exporta PDF / hace screenshot. Si en feedback aparece "los clientes nos piden el aviso", reabrir como ticket de Plan Team (Fase 2).

### Decisiones técnicas secundarias (no bloqueantes — propuesta default)

- **Hora preferida de envío:** default 09:00 ART, override per consultora en sección 6.4 (esto sí se implementa en MVP, no es bloqueante).
- **Shift de reminders a lunes si caen sábado/domingo:** **propuesta default: SÍ** (los reminders de fin de semana no se accionan, llegan al lunes "viejos"). Sumar setting per consultora en follow-up si genera fricción.
- **Manejo de feriados argentinos:** **fuera de scope MVP**, integrar con tabla de feriados en Fase 2.
- **Calendar app interna vs ICS interactivo:** **interna en MVP** (full custom UI). `.ics` es export read-only (decisión DA-06).
- **¿Auto-cancelar eventos de empleado eliminado (EC-17)?:** **propuesta default: NO** (mantener huérfano con `empleado_id=null`). Permite que el consultor decida case-by-case.

---

## 11. Plan de tickets propuesto

**Total estimado: 3-4 semanas con foco** (puede ser más si entre tickets aparecen sub-decisiones). NO comprometer fechas — solo planning rough.

| Ticket | Nombre | Scope corto | Dependencias | Estimación |
|---|---|---|---|---|
| **T-026** | Discovery (este) | Doc + 7 decisiones abiertas | — | 1-2 días ✅ |
| **T-027** | Migration `calendar_events` + `calendar_event_reminders` + RLS + audit trigger + types | SQL + tipos generados, sin UI ni actions | Decisiones DA-01..DA-07 cerradas | 1 día |
| **T-028** | Server actions CRUD eventos (create/update/cancel/complete) + tests integration | Lógica de cálculo de reminders + recurrencia + validación Zod | T-027 | 2 días |
| **T-029** | UI calendario mensual + form crear/editar evento (modal) + queries | Vista `(app)/calendario/page.tsx` + form RHF + tests E2E | T-028 | 3 días |
| **T-030** | UI vista agenda (lista priorizada por urgencia) + panel dashboard "próximos vencimientos" | Reuse del query, vista alternativa | T-029 | 1 día |
| **T-031** | Migration `pg_net` + `process_pending_reminders()` + cron entry + endpoint `/api/calendar/dispatch-reminder` con auth shared secret | Job programado + dispatcher esqueleto sin canales aún | T-028 | 2 días |
| **T-032** | Canal Email (Resend): setup cuenta + DNS + templates + sender + tests | Sender HTTP con error handling + webhook bounces (sub-ticket) | T-031 | 2 días |
| **T-033** | Canal Telegram: bot creation + webhook handler + flow subscripción + sender | BotFather + `/api/webhooks/telegram` + `telegram_subscriptions` + link UX | T-031 | 2-3 días |
| **T-034** | Canal Web Push: VAPID keys + service worker + endpoint subscribe + sender | Push API + Service Worker `public/sw.js` + cleanup de subscriptions inválidas | T-031 | 3 días |
| **T-035** | UI Settings canales (`/settings/notificaciones`) + mute temporal + defaults per consultora | `notification_channel_prefs` UI + form RHF + tests | T-032/T-033/T-034 | 1 día |
| **T-036** | Integración con módulo Informes: modal post-firma sugiere agendar vencimiento (DA-05 Opción B) | Hook en `signInformeAction` + UI confirmación | T-029 + módulo Informes existente | 1 día |
| **T-037** | Tests E2E end-to-end + smoke productivo (crear evento → cron → email + telegram + push reciben) | Playwright suite + manual smoke en `consultora-demo.test-ia.cloud` | T-032..T-036 | 2 días |

**Follow-ups identificados** (pueden empujarse a T-038+ o follow-up issues):

- F1 — `consultora_calendar_defaults` table + UI override per consultora (sección 5.4).
- F2 — Webhook Resend bounces handler (`/api/webhooks/resend`) — opcional T-032 sub-ticket.
- F3 — Export `.ics` si DA-06 = Opción A (no en MVP por default).
- F4 — Shift de reminders fin de semana / feriados argentinos.
- F5 — Mute global con UI dedicada (vs. mute por canal).
- F6 — Métricas Sentry: reminders disparados por hora, deliverability por canal.

---

## Cierre del discovery

Este documento cierra el discovery de Calendario + Notificaciones. Los inputs para Sprint 3 quedan:

- 11 secciones definidas.
- 7 decisiones críticas **resueltas el 2026-05-14 por Lautaro** (DA-01..DA-07 en sección 10).
- 12 tickets propuestos (T-026..T-037).
- ~3-4 semanas de trabajo estimadas.

**DA-01..DA-07 ✅ resueltas el 2026-05-14.** Discovery cerrado. Próximo paso operacional: arrancar **T-027** (migration `calendar_events` + `calendar_event_reminders` + RLS + audit trigger). El ticket T-036 incorpora la decisión híbrida de DA-05 (modal post-firma + toggle Settings "auto-crear silencioso" default OFF).
