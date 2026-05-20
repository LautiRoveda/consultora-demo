# Uptime monitoring · Better Stack free monitor + alerta Telegram (T-052-FU2)

> **Audiencia:** Lautaro. Procedimiento operativo para detectar caídas 502
> del productivo (escenario 2 de `vps-reboot-recovery.md` — EasyPanel
> resetea `endpoint-mode` en cada deploy) sin auto-fix.

T-052-FU2 cerró con decisión NO automatizar el fix del trigger "post-deploy
EasyPanel" por baja frecuencia esperada. Mitigación intermedia: monitor
externo HTTPS cada 3 min + alerta Telegram tras 5 min de 502 sostenido.
Fix sigue siendo manual con `docker service update --endpoint-mode dnsrr`
del runbook (ver [`vps-reboot-recovery.md`](vps-reboot-recovery.md) escenario 2).

Reactivar T-052-FU2 full (investigación empírica + stopgap automatizado)
si: 3+ incidents/sprint, o 1 incident con 502 > 30 min, o llegan users
productivos reales con SLA implícito.

---

## Por qué Better Stack

| Provider | Free tier | Interval | Telegram nativo | Notas |
|---|---|---|---|---|
| **Better Stack** ✅ | 10 monitors, alertas ilimitadas | 3 min | Sí (canal directo) | UI clara, status page incluida free |
| Uptime Robot | 50 monitors | 5 min | Vía webhook | OK pero UI más vieja, Telegram requiere bot intermediario |
| StatusCake | 10 monitors | 5 min | Vía webhook | Free tier OK, pero focalizado en infra grande |
| Cron + script casero | ∞ | configurable | Sí (con bot custom) | Requiere mantener cron en otro host fuera del VPS |

Elegido **Better Stack** por: (1) interval más corto (3 min vs 5 min →
detección más rápida), (2) integración Telegram sin webhook intermediario,
(3) status page free pública sin upgrade, (4) UI moderna y zero-config
para HTTPS basic checks.

---

## Pre-requisitos

1. Cuenta Better Stack — registrarse en <https://betterstack.com/uptime>
   con email (no requiere tarjeta para el tier free).
2. Bot Telegram con token — crear con `@BotFather` siguiendo
   [`telegram-setup.md`](telegram-setup.md) Paso 1. Podés reusar el
   bot `consultora_demo_bot` ya creado en T-033, NO crear uno nuevo.
3. Chat ID Telegram personal de Lautaro — obtener con `@userinfobot`:
   - Abrí Telegram → buscá `@userinfobot` → "Start".
   - El bot responde con tu `id` (número entero, ej `1234567890`). Guardalo.

> **Nota seguridad**: el bot token vive en EasyPanel env vars + ahora en
> Better Stack config. El chat ID personal NO es secreto crítico
> (cualquiera con el bot token puede mandarte mensajes — la mitigación
> es rotar el token si se filtra, no esconder el chat ID).

---

## Paso 1 · Crear monitor HTTPS en Better Stack

1. Login Better Stack → **Monitors** → **Create monitor**.
2. **Monitor type**: HTTPS.
3. **URL**: `https://consultora-demo.test-ia.cloud`.
4. **Check frequency**: 3 minutes (default free tier).
5. **Regions**: seleccionar 3 — recomendado: `Frankfurt` + `Virginia (US East)` +
   `São Paulo` (proximidad geográfica + redundancia regional).
6. **HTTP request settings** (expand):
   - Method: `GET`.
   - Expected status codes: `200, 307, 308` (redirects válidos en Next.js middleware).
   - Follow redirects: **ON**.
   - Request timeout: `30 seconds`.
7. **Save monitor**.

---

## Paso 2 · Configurar failure condition

Default Better Stack: 1 failed check → incident.
Cambiar a 2 consecutive failures para evitar ruido de glitches puntuales
o de los 2-3 min que dura el rebuild EasyPanel.

1. Monitor recién creado → tab **Settings**.
2. **Confirmation period** (o "Recovery period"): `2 consecutive failed checks`.
3. **Alert delay**: `5 minutes` (5 min de 502 sostenido antes de notificar).
4. **Save**.

Resultado: monitor reporta incident solo si 2 checks consecutivos fallan
Y han pasado 5 min desde el primer fallo → ~6-8 min de 502 real antes de
spammearte. Deploys cortos de 2-3 min NO generan ruido.

---

## Paso 3 · Notification channel Telegram

1. Better Stack → **Integrations** → **Telegram** → **Add**.
2. **Bot token**: pegar el `TELEGRAM_BOT_TOKEN` del bot
   `consultora_demo_bot` (el mismo que está en EasyPanel env vars). Placeholder:
   `TOKEN_AQUI`.
3. **Chat ID**: pegar tu chat ID personal obtenido con `@userinfobot`.
   Placeholder: `CHAT_ID_AQUI`.
4. **Test integration** → click → debe llegar mensaje "Test alert from
   Better Stack" al bot en tu Telegram. Si no llega:
   - Verificá que iniciaste conversación con el bot al menos 1 vez
     (Telegram bots no pueden iniciar conversaciones unsolicited).
     Si no: abrí Telegram → `t.me/consultora_demo_bot` → click **Start**.
   - Re-test.
5. **Save** integration con nombre `Telegram personal Lautaro`.

---

## Paso 4 · Asociar el channel al monitor

1. Monitor `consultora-demo.test-ia.cloud` → tab **Notifications**.
2. **Add channel** → seleccionar `Telegram personal Lautaro`.
3. **Notify on**: Incident start + Incident recovery.
4. **Save**.

---

## Paso 5 · Smoke test inicial

Forzar un fallo controlado para validar que la alerta llega:

1. En EasyPanel UI: parar temporalmente el service `agendalo_consultora-demo`
   (Service → Stop). **Avisa antes** si hay alguien usando el dominio.
2. Esperar ~8-10 min (2 checks + 5 min alert delay).
3. Debe llegar mensaje al bot Telegram con título tipo
   "consultora-demo.test-ia.cloud is down".
4. Re-arrancar el service desde EasyPanel UI.
5. Better Stack detecta recovery en el próximo check → llega mensaje
   "consultora-demo.test-ia.cloud is back up".

Si el smoke pasa OK, dejá el monitor activo. Si falla → revisar
configuración del channel + verificar test integration del Paso 3.

---

## Qué hacer cuando llega una alerta

1. Confirmar en browser que el dominio da 502 (no que es false positive
   por DNS local o por glitch del provider del monitor).
2. SSH al VPS:
   ```bash
   docker service update --endpoint-mode dnsrr agendalo_consultora-demo --detach=false
   ```
3. Verificar fix:
   ```bash
   curl -I https://consultora-demo.test-ia.cloud
   # Esperás HTTP 200 (o 307/308 redirect).
   ```
4. Si el fix NO resuelve → escalar al runbook completo
   [`vps-reboot-recovery.md`](vps-reboot-recovery.md) sección Escalation.
5. Esperar la alerta "back up" de Better Stack (~3-5 min post-fix).
6. Anotar el incident en el historial del runbook si fue causa nueva
   (no escenario 1 ni 2 ya documentados).

---

## Mantenimiento

- **Sumar monitors por dominio nuevo**: cuando lance subdominio productivo
  (ej `app.consultora-demo.com`, `api.consultora-demo.com`), repetir
  Pasos 1-4 para cada uno. Free tier alcanza para 10 monitors total.
- **Review mensual**: Better Stack dashboard → uptime histórico.
  - Si < 99.5% en el mes → revisar incident log + considerar escalar a
    T-052-FU2 full (stopgap automatizado).
  - Si > 99.9% → status quo OK, no tocar.
- **Pausa durante mantenimiento planeado**: si vas a hacer migration
  grande o downtime esperado > 10 min, pausar el monitor desde UI antes
  para no spamear alertas (Monitor → Settings → Pause).

---

## Costo

- **Tier free**: $0/mes. Incluye 10 HTTPS monitors, alertas ilimitadas,
  3-min interval, status page pública, integraciones nativas Telegram +
  email + Slack + webhook + más.
- **Upgrade Pro ($25/mes)**: solo si necesitás SMS alertas, custom
  domain en status page, on-call rotation, o intervals < 1 min. Para
  Consultora-demo en fase pre-revenue NO es necesario.

---

## Referencias

- Runbook: [`docs/operations/vps-reboot-recovery.md`](vps-reboot-recovery.md) escenario 2.
- Bot Telegram setup: [`docs/operations/telegram-setup.md`](telegram-setup.md).
- Lesson learned: [`docs/lessons-learned.md`](../lessons-learned.md) → sección "Operativo / VPS" → "EasyPanel resetea endpoint-mode en cada deploy productivo".
- Ticket origen: T-052-FU2.
