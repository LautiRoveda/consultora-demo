# Synthetic monitoring · setup operativo Better Stack

**Ticket:** T-083 (sándwich seguridad 4/4).
**Cuándo correr el setup:** una vez post-merge, ~30-45 min.
**Test mensual del alerting:** 1er sábado del mes, ~5 min.
**Prerequisitos:** cuenta Better Stack (free) + acceso EasyPanel + acceso Gmail (`lautaroeroveda@gmail.com`) + opcional Telegram para alerts duales.

---

## §1. Cobertura

Qué se monitorea desde fuera del VPS Hostinger:

| Endpoint | Frecuencia | Expect | Alert threshold |
|---|---|---|---|
| `https://consultora-demo.test-ia.cloud/` | 5 min | HTTP 200 | 3 fails consecutivos |
| `https://consultora-demo.test-ia.cloud/api/health` | 5 min | HTTP 200 + body contiene `"ok":true` | 3 fails consecutivos |

El endpoint `/api/health` viene de [T-081](./health-check.md) — chequea Supabase con timeout 3s y devuelve `{ok, version, supabase, uptime_seconds, timestamp}`. Si Supabase está down el endpoint responde 503 con `ok: false`, lo cual dispara la alerta porque el body-match falla.

**Lo que NO se monitorea (cost-aware):** Anthropic API · Resend · Telegram bot · Upstash Redis. Razón: cada check pegaría al provider con costo (tokens / rate-limit / quota) > valor incremental. Si alguno cae, los users que lo gatillan ven el error directo y Sentry captura. T-083 cubre "la app está viva y respondiendo" — degradaciones parciales de providers externos se ven en Sentry / logs.

---

## §2. Setup Better Stack paso a paso

**Free tier confirmado** (mayo 2026): 10 monitors + check interval mínimo 30s + email/Slack/SMS/push/phone alerts + 1 status page. Suficiente para este caso.

1. Crear cuenta en <https://betterstack.com/> (signup con GitHub o email).
2. Dashboard → **Uptime** → **Create monitor**:
   - Type: **HTTP(S)**.
   - Name: `consultora-demo-landing`.
   - URL: `https://consultora-demo.test-ia.cloud/`.
   - Check frequency: **5 minutes**.
   - Request timeout: **30 seconds** (la landing puede tardar en cold start tras restart EasyPanel).
   - Expected status code: **200**.
3. Crear segundo monitor:
   - Name: `consultora-demo-health`.
   - URL: `https://consultora-demo.test-ia.cloud/api/health`.
   - Check frequency: **5 minutes**.
   - Request timeout: **10 seconds**.
   - Expected status code: **200**.
   - **Advanced** → **Response body must contain**: `"ok":true` (string literal, sin espacios — matchea el shape del endpoint T-081).
4. Configurar alert policy para ambos monitors:
   - **Recovery period**: 1 minuto (espera 1 min de checks OK antes de marcar "Recovered").
   - **Confirmation period**: marcar como incident solo tras **3 checks fallidos consecutivos** (~15 min de outage real antes de alertar).
5. Agendar maintenance window mensual: **1er lunes 03:00 ART (06:00 UTC)**, 30 min de duración. Alineado con ventana natural de mantenimiento Supabase (~03:00 UTC) y bajo tráfico productivo.

---

## §3. Alert channels — email

1. Dashboard Better Stack → **Integrations** → **Email**.
2. Add email recipient: `lautaroeroveda@gmail.com`.
3. Verificar email (clickear link de confirmación recibido en Gmail).
4. Asignar el channel a los 2 monitors creados en §2.
5. Test: dashboard → monitor → **Send test alert** → verificar recepción en Gmail (~1 min).

---

## §4. Alert channels — Telegram (opcional)

Mandar a `@consultora_demo_reminders_bot` (T-033) duplica el canal de notificación para incidents — útil si Gmail está caído o no se chequea desde mobile.

1. Better Stack → **Integrations** → **Webhook**.
2. Add custom webhook:
   - Name: `telegram-personal`.
   - URL: `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/sendMessage`.
   - Method: **POST**.
   - Headers: `Content-Type: application/json`.
   - Body template (JSON, usar variables Better Stack):
     ```json
     {
       "chat_id": 1237085212,
       "text": "🚨 *$MONITOR_NAME* — $STATUS\n\n$URL\n\nDesde: $STARTED_AT",
       "parse_mode": "Markdown"
     }
     ```
3. Reemplazar `<TELEGRAM_BOT_TOKEN>` con el valor real del bot (mismo que `TELEGRAM_BOT_TOKEN` en EasyPanel env vars del service `consultora-demo`). **NO commitear el token a este doc** — usar siempre el placeholder.
4. Asignar el webhook a los 2 monitors.
5. Test: dashboard → monitor → **Send test alert** → verificar mensaje en chat del bot Telegram (~1 min).

**Alternativa más simple** si no querés duplicar el canal: dejar solo email (§3) y agregar Telegram cuando entren clientes pagos y la respuesta rápida se vuelva crítica.

---

## §5. SLO target

**99.5% uptime mensual** = ~3.6h downtime aceptable por mes.

| Cálculo | Valor |
|---|---|
| Minutos en un mes (30 días) | 43.200 |
| 99.5% uptime budget | 42.984 min |
| Downtime budget | 216 min (~3.6h) |

Better Stack auto-trackea el uptime % en el dashboard de cada monitor (vista mensual / trimestral / anual).

**Por qué 99.5% y no 99.9%/99.99%:** el stack es single-VPS (Hostinger 31.97.165.160) + Supabase free tier sin redundancia geográfica. Llegar a 99.9% requiere multi-AZ + load balancer + DB replicas, overkill MVP. 99.5% deja margen para deploys, mantenimiento Supabase, blips Hostinger.

**Si bajamos consistentemente del SLO** (2 meses seguidos < 99.5%) → investigar root cause con post-mortems del mes (§6) + considerar upgrades (Supabase Pro con PITR, segundo VPS para HA, Cloudflare como CDN/edge cache).

---

## §6. Procedimiento respuesta incidente

Cuando llega alerta:

### 1. Verificación manual rápida (1 min)

```bash
curl -i https://consultora-demo.test-ia.cloud/api/health
```

- Si responde `200` con `"ok":true` en el body → false positive (transient blip). Ignorar pero anotar en log mental — si pasa > 2/mes, ajustar threshold (§7).
- Si responde 5xx, timeout, o `"ok":false` → es real, seguir al paso 2.

### 2. Diagnosis (5-10 min)

- **EasyPanel UI** → service `consultora-demo` → **Logs** → buscar errores recientes (mid-request crashes, OOM, Puppeteer hangs).
- **Supabase Status** → <https://status.supabase.com/> → verificar si hay incident upstream en `sa-east-1`.
- **Hostinger Status** → panel del VPS → verificar CPU/RAM/red del host.

### 3. Resolución según root cause

| Root cause | Acción |
|---|---|
| App crashed / OOM / process hung | EasyPanel UI → **Implementar** (re-start del container) |
| Supabase `sa-east-1` down | Esperar resolución upstream (Supabase suele resolver en < 1h) + avisar a clientes que generación de informes está temporalmente afectada |
| VPS Hostinger down | Contactar soporte Hostinger via panel |
| Cloudflare / DNS issue | Esperar (es global outage) + verificar <https://www.cloudflarestatus.com/> |
| Build deploy fallido | Revertir último commit + redeploy desde commit anterior |

### 4. Comunicación a clientes

Si downtime > 30 min Y hay clientes pagos activos: mensaje a clientes (email o WhatsApp directo) con tiempo estimado de resolución + workaround si lo hay (ej: "podés guardar el informe en draft, no perdés el trabajo").

### 5. Post-mortem

Si incidente > 1h: escribir post-mortem en `docs/operations/incidents/YYYY-MM-DD-<short-name>.md` con timeline (alerta → detección → mitigación → resolución) + root cause + fix aplicado + prevention forward. Ejemplo de naming: `2026-06-03-supabase-sa-east-1-outage.md`.

---

## §7. False positives — cómo evitar

**Configuración defensiva** (ya seteada en §2):

- **Threshold 3 fails consecutivos** (no 1) — descarta blips de red de < 15 min.
- **Check interval 5 min** (no 30s ni 1 min) — 30s genera 17.280 req/día = ruido + posible rate-limit del propio Better Stack contra el endpoint; 5 min son 288 req/día, costo despreciable.
- **Maintenance windows** scheduled (1er lunes 03:00 ART) — alerts silenciadas durante ventana planificada.

**Si llegan > 2 false positives al mes consistente:**

- Subir threshold a 5 fails consecutivos (~25 min de outage antes de alertar) — trade-off entre detection latency y noise.
- O cambiar interval a 10 min — reduce req/día a 144 pero aumenta detection time peor caso a ~50 min con threshold 5.

Documentar el ajuste inline en este doc con la fecha y razón del cambio.

---

## §8. Test mensual del alerting

**1er sábado del mes, ~5 min**. Validar que el sistema completo (monitor → alert policy → channel → receiver humano) sigue funcionando — no solo que Better Stack dispare, sino que el email/Telegram llegue al receiver y Lautaro lo vea.

1. EasyPanel → service `consultora-demo` → **Detener** (stop del container).
2. Esperar ~15-20 min (3 fails consecutivos × interval 5 min = 15 min mínimo).
3. Verificar que llega alert al email (Gmail inbox `lautaroeroveda@gmail.com`) y opcionalmente al chat Telegram del bot.
4. EasyPanel → **Implementar** (re-start del container).
5. Verificar que llega alert de "Recovery" a los mismos canales (~5 min tras restart).
6. Documentar fecha del test inline acá + cualquier issue encontrado (alert tardía, channel roto, false positives nuevos).

**Última ejecución del test mensual:** _(completar manualmente — formato `YYYY-MM-DD · OK / issues encontrados`)._

---

## §9. Cuándo upgradear a Pro tier

Free tier (10 monitors / 30s interval / email-Slack-SMS-push-phone / 1 status page) cubre el MVP. Triggers para upgrade a Pro (~$20/mes):

- **+5 clientes pagos productivos** → SLA contractual / regulatory compliance pide on-call rotation y SMS dedicados.
- **Necesidad de on-call escalation** → Diego con técnicos que reciben alerts forward (Pro tier tiene escalation policies con timeouts).
- **+10 monitors** → modulares nuevos (Telegram webhook receiver, cron dispatcher endpoint, etc) saturan los 10 del free tier.
- **Quiero private status page** → free tier solo tiene status page público.

---

## §10. Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| Alert llega pero `curl /api/health` manual responde OK | False positive (transient blip de red Hostinger ↔ Better Stack) | Revisar uptime histórico Better Stack — si pasa < 2/mes, ignorar. Si > 2/mes, subir threshold a 5 fails (§7) |
| Sitio caído pero NO llega alert | Monitor pausado, alert channel roto, o threshold no alcanzado todavía | Dashboard Better Stack → ver últimos checks del monitor (estado real) + verificar que el channel asignado siga activo (no fue removed) |
| Telegram alert no llega pero email sí | Webhook URL mal armado, bot token rotado, o chat_id incorrecto | Test webhook con `curl -X POST 'https://api.telegram.org/bot<TOKEN>/sendMessage' -d 'chat_id=1237085212&text=test'` manual desde shell. Si responde 200 OK, el problema está en el body template de Better Stack |
| Alerts llegan cada 5 min sin parar tras incident real resuelto | Falta hacer **Acknowledge** del incident en el dashboard | Better Stack dashboard → incident activo → **Acknowledge** pausa alerts repetidas hasta que el monitor pase a "Up" + Recovery |
| Maintenance window programada pero alerts llegaron igual | Maintenance window mal seteada (timezone, fecha) o no se asignó al monitor correcto | Dashboard → Maintenance windows → editar → verificar que el monitor afectado esté en la lista + timezone sea ART (`America/Argentina/Buenos_Aires`) |

---

## §11. Integraciones futuras (sketch, NO en T-083)

- **Sentry alerting rules** (follow-up T-083-FU1): complementario al synthetic monitoring — alertas de error rate spike > 5%/hora, latency p95 > 2s consistente, nuevo error type sin instances previos. Requiere métricas custom instrumentadas que hoy no existen.
- **Status page público** (follow-up T-083-FU2): Better Stack incluye 1 status page free. Útil cuando entren clientes pagos y quieran ver uptime histórico sin contactar soporte. Disparador: +5 clientes pagos.
- **n8n auto-remediation** (follow-up T-083-FU3): n8n ya instalado en EasyPanel → workflow que recibe webhook de Better Stack y dispara restart automático del container via API EasyPanel si la app crashed > 5min. Disparador: 3+ incidents que requirieron restart manual.

---

## Cierre — sándwich seguridad operacional

T-083 cierra el sándwich seguridad 4/4:

1. ✅ **T-080** — Dependabot + `pnpm audit` en CI.
2. ✅ **T-081** — Rate limiting (Upstash) + endpoint [`/api/health`](./health-check.md).
3. ✅ **T-082** — [Disaster recovery](./disaster-recovery.md): backups + restore runbook.
4. ✅ **T-083** — Synthetic monitoring (este doc).

Siguiente: arranca Sprint 4 Empleados (T-052+) con patrones seguros heredados (rate-limit en actions sensibles, health-check verificable desde monitoring externo, backup automático Supabase + storage mensual, monitor configurado desde día 1).
