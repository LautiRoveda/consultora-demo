# Health check · setup operativo

**Ticket:** T-081 (sándwich seguridad 2/4).
**Endpoint:** `GET /api/health` — público, sin auth, sin rate limit.
**Implementación:** [`src/app/api/health/route.ts`](../../src/app/api/health/route.ts).

---

## Shape del response

**Mínimo intencional** (decisión Lautaro YAGNI):

```json
{
  "ok": true,
  "version": "abc1234",
  "supabase": "ok",
  "uptime_seconds": 12345,
  "timestamp": "2026-05-18T13:45:12.345Z"
}
```

| Field | Tipo | Descripción |
|---|---|---|
| `ok` | `boolean` | `true` si TODAS las deps healthy. `false` → status 503. |
| `version` | `string` | `process.env.GIT_SHA` o `'dev'` si no presente. |
| `supabase` | `'ok' \| 'down'` | Query lightweight a `consultoras` con timeout 3s. |
| `uptime_seconds` | `number` | `Math.floor(process.uptime())` del Node process. |
| `timestamp` | `string` | ISO 8601 del momento de la response. |

**Status codes**:
- `200` cuando `ok: true`.
- `503` cuando `ok: false` (alguna dep down).

**Headers**:
- `Content-Type: application/json`
- `Cache-Control: no-store, max-age=0` (synthetic monitor debe ver el estado actual).
- `X-Robots-Tag: noindex` (no indexar en Google).

---

## Qué chequea hoy

**SOLO Supabase** — query `SELECT id FROM consultoras LIMIT 1` con `head:true`
(devuelve metadata sin payload). Timeout 3s vía `AbortSignal.timeout()`.

**Por qué NO chequea otros providers**:
- **Anthropic**: cada call cuesta tokens. Si Anthropic está down, los users que
  generan informes ven el error directo + Sentry captura. Inflar costo en synthetic
  monitoring (T-083 va a pegar cada 5 min = 288 req/día) no aporta.
- **Resend / Telegram / Web Push**: cada call cuesta cuota del provider. Mismo
  argumento.
- **Upstash Redis**: rate limit es fail-open. Si Upstash cae, signupAction
  sigue funcionando (con `logger.warn` a Sentry). Health check no necesita
  exponerlo separadamente.

**Si algún provider degrada recurrente**, abrir **T-081-FU3** para sumar el check
específico.

---

## Consumo desde monitoring (T-083)

```bash
# Synthetic monitor (T-083 va a usar Better Stack / UptimeRobot / Cron-Job.org)
# debería pegar cada 5 min con:
curl -fsS https://consultora-demo.test-ia.cloud/api/health | jq '.ok'
# Alertar si:
#   - status != 200
#   - body.ok != true
#   - response time > 5s
```

**Para T-083** (synthetic monitoring): este endpoint es el target principal. Si
el monitor necesita más info (latencia Supabase por ejemplo), sumar el field
en T-083 directamente.

---

## Configurar `GIT_SHA` para version visibility (opcional)

Hoy `version` reporta `'dev'` si no hay env var. Para exponer el SHA real del
deploy:

**Opción A: EasyPanel env var**
1. Setear `GIT_SHA` en EasyPanel env vars del service consultora-demo con un
   valor manual (ej. `abc1234`). El operador lo actualiza con cada deploy.
2. Redeploy.

**Opción B: GitHub Action auto-inject** (futuro, T-081-FU* si lo querés)
1. Workflow GHA que tras merge a `main` lea el SHA del commit + lo pase al
   webhook EasyPanel via build args.
2. Requiere EasyPanel auto-deploy webhook (ya configurado post-T-022.5-FU3).

Para MVP, **Opción A** alcanza. Lautaro actualiza manualmente cuando le
interesa precision (release notes, debug de incidente).

---

## Smoke test productivo

```bash
# 1. Endpoint UP + supabase OK
curl https://consultora-demo.test-ia.cloud/api/health | jq
# Esperado:
# {
#   "ok": true,
#   "version": "dev",  ← o el SHA si seteaste GIT_SHA
#   "supabase": "ok",
#   "uptime_seconds": <int>,
#   "timestamp": "..."
# }

# 2. Headers correctos
curl -I https://consultora-demo.test-ia.cloud/api/health
# Esperado:
# HTTP/1.1 200 OK
# Cache-Control: no-store, max-age=0
# X-Robots-Tag: noindex
# Content-Type: application/json

# 3. Robots-tag noindex visible
curl -s https://consultora-demo.test-ia.cloud/api/health -o /dev/null -w "%{http_code}\n"
# Esperado: 200
```

**Simular Supabase down** (NO hacer en prod):
- Revocar temporalmente el `SUPABASE_SERVICE_ROLE_KEY` en EasyPanel + redeploy
  hace que el endpoint falle al crear el client → 503.
- Más simple: testear con vitest integration que cubre 4 escenarios
  (incluye AbortError + supabase error).

---

## Extender forward (futuro)

Si necesitamos exponer más info, **agregar fields al body es backward-compat**
(consumers ignoran extras), **removerlos es break change**:

```typescript
// Sumar field en route.ts:
const body = {
  ok,
  version: process.env.GIT_SHA ?? 'dev',
  supabase: supabaseStatus,
  supabase_latency_ms: supabaseLatencyMs,  // ← NUEVO field
  uptime_seconds: Math.floor(process.uptime()),
  timestamp: new Date().toISOString(),
};

// Actualizar anti-test de shape en health-endpoint.test.ts:
expect(Object.keys(body).sort()).toEqual([
  'ok', 'supabase', 'supabase_latency_ms',  // ← suma acá
  'timestamp', 'uptime_seconds', 'version',
]);
```

**No remover fields existentes** sin coordinar con T-083 monitor config (consumers
externos pueden depender).

---

## Follow-ups abiertos

- **T-081-FU3**: agregar checks Anthropic/Resend/Telegram si Sentry reporta
  degradación recurrente de algún provider.
- **T-083**: synthetic monitoring que consuma este endpoint cada 5 min.
