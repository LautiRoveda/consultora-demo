# Rate limiting · setup operativo

**Ticket:** T-081 (sándwich seguridad 2/4).
**Stack:** Upstash Redis (free tier 10k req/day) + `@upstash/ratelimit` sliding window.
**Helper compartido:** [`src/shared/security/rate-limit.ts`](../../src/shared/security/rate-limit.ts).

---

## Qué protege

| Target | Límite por IP | Límite por email/userId | Identifier |
|---|---|---|---|
| `signupAction` | 5 / 1h | — | `signup-ip` |
| `loginAction` | 10 / 15min | 5 / 15min | `login-ip` + `login-email` |
| `magicLinkAction` | 3 / 15min | 1 / 15min | `magic-link-ip` + `magic-link-email` |
| `recoverPasswordAction` | 3 / 1h | 1 / 1h | `recover-password-ip` + `recover-password-email` |
| `POST /api/informes/[id]/generate-stream` | — | 20 / 1h | `ai-generation-user` |

**Justificación de cada límite** (en código, comentarios inline al lado del `getRateLimiter` factory).

**Endpoints NO rate-limited** (auth ya filtra abuse implícito + tráfico bajo):
- `/api/informes/[id]/pdf`
- `/api/informes/[id]/attachments`
- `/api/settings/consultora/logo`
- `/api/telegram/status`
- `/api/push/*`
- `/api/calendar/dispatch-reminder` (secret-protected — cron interno)
- `/api/webhooks/telegram` (secret-protected — Telegram bot)
- `/api/health` (público intencional, T-083 lo pegará cada 5 min)

---

## Setup en EasyPanel (UNA VEZ post-merge)

1. **Crear cuenta Upstash** en <https://upstash.com/> (free tier, sin tarjeta).
2. **Crear Redis database** en la consola Upstash:
   - Type: **Regional**.
   - Region: **`us-east-1`** (más cerca de tu Supabase `sa-east-1`).
   - Eviction: **enabled** (LRU — defensivo si llegamos al limit de keys).
3. **Copiar** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` del dashboard
   (sección "REST API" → tab "Node.js" o "ENV").
4. **Setear en EasyPanel** env vars del service `consultora-demo`:
   - `UPSTASH_REDIS_REST_URL=https://...upstash.io`
   - `UPSTASH_REDIS_REST_TOKEN=...` (token completo, copiar y pegar inmediato — sin intermediarios, lesson T-031 typo placeholder)
5. **Redeploy** desde EasyPanel UI (botón "Implementar").
6. **Verificar smoke** (ver sección siguiente).

**Importante**: regenerar el token Upstash NO invalida nada (el storage en Redis sigue intacto). Pero si rotás, actualizá EN AMBOS lados (Upstash dashboard + EasyPanel) en el mismo deploy para evitar ventana de fail-open silent.

---

## Smoke test productivo

### Test 1: signup rate limit (6 intentos)

```bash
# Desde tu navegador: hacer 6 signups consecutivos desde la UI de
# https://consultora-demo.test-ia.cloud/signup con emails únicos
# (test1@..., test2@..., ..., test6@...). El 6º debe mostrar:
#   "Demasiados registros desde esta red. Reintentá en XXXXs."
# en lugar de proceder al check-email page.
```

Verificar en Upstash dashboard que la key `rl:signup-ip:<tu-ip>` existe con count = 6.

### Test 2: rate limit no aplica en dev local

```bash
# Local con .env.local que NO tiene UPSTASH_REDIS_REST_URL/TOKEN:
pnpm dev
# Hacer 10 signups consecutivos desde http://localhost:3000/signup.
# TODOS deben proceder (el helper retorna noop stub).
```

### Test 3: AI generation rate limit (21 generaciones del mismo user)

```bash
# Generar 21 informes consecutivos desde el mismo user en producción.
# El 21º debe devolver 429 + toast "Demasiadas generaciones. Reintentá en XXXXs."
# Más práctico para testing: setear temporalmente `limit: 2` en
# `ai-generation-user`, hacer 3 generaciones rápidas, verificar 429 en el 3º,
# revertir el cambio post-test.
```

### Test 4: fail-open en Upstash outage simulado

```bash
# Apagar Upstash temporalmente: deshabilitar las 2 env vars en EasyPanel +
# redeploy. signupAction DEBE seguir funcionando (allows). Verificar
# logger.warn `rate_limit_check_failed_failing_open` en Sentry. Re-habilitar
# las env vars + redeploy.
```

---

## Decisiones operativas

### Por qué fail-open en Upstash outage

Si Redis Upstash cae, el helper retorna `success: true` + `logger.warn` a
Sentry. Razón: rate limit es **defense in depth** — Supabase Auth tiene
throttle interno (30 emails/h free tier) que limita el blast durante outage.
Fail-closed rompería login a TODOS los users legítimos durante el outage.

**Reevaluar split per-endpoint cuando userbase crezca > 1000** (auth fail-closed,
AI generation fail-open). Tracking: **T-081-FU5**.

### Por qué sliding window vs fixed window

Más smooth — menos vulnerable a burst en los boundaries del window. Costo
similar en Upstash (1 Redis call por check).

### Por qué identificación por IP + email para auth

Multi-dim **LOR** (limit-or): si IP excedida O email excedida → block.
- IP only fail: atacante con botnet (muchas IPs) bypassea login brute force
  contra una cuenta específica.
- Email only fail: atacante puede emails random distintos para signup spam.

### Por qué identificación por user_id (NO IP) para AI

Users legítimos en red corporativa NATted comparten IP → IP-based bloquearía
false positives masivos. user_id es la identidad real del costo Claude API.

---

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| Rate limit no aplica en prod | Env vars no seteadas en EasyPanel | Verificar `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` en EasyPanel + redeploy |
| Sentry warns recurrentes `rate_limit_check_failed_failing_open` | Upstash outage o token rotado sin sync | Verificar Upstash status page + match del token en ambos lados |
| Usuario legítimo bloqueado | Rate limit configurado muy bajo o uso compartido de IP | Considerar override per-tenant (T-081-FU2, post-MVP) |
| Spike de `signup-ip` keys en Upstash dashboard | Bot bombing attack en curso | Revisar logs Sentry para patrones de IPs, considerar block en Cloudflare/WAF |
| Rate limit no dispara + logs `NOPERM evalsha` | User "default" Upstash Free Tier sin permisos `@scripting` (bloquea EVALSHA del Lua slidingWindow) | Crear user ACL custom con `+@all` (ver sub-sección abajo) |

### Rate limit no dispara en producción + logs muestran "NOPERM evalsha"

**Síntoma**: rate limit nunca bloquea aunque se hagan muchos intentos. EasyPanel logs muestran error:

```
UpstashError: Command failed: NOPERM this user has no permissions to run the 'evalsha' command
```

**Causa**: el user "default" de Upstash Free Tier viene con permisos restringidos que NO incluyen `@scripting` (necesario para los Lua scripts de `@upstash/ratelimit` slidingWindow).

**Fix**:

1. Upstash dashboard → tu DB → tab **"ACL"**.
2. Click **"Add User"**:
   - Username: `app-default` (o similar).
   - Status: **On**.
   - Keys: `~*` (todas).
   - Categories: `+@all` (full permissions — es DB del rate limit, no hay nada sensible).
3. Click **Create** → copiar el password autogenerado.
4. Dashboard del DB → tab **"Connect"** → switchear al nuevo user → copiar el nuevo token.
5. EasyPanel → reemplazar `UPSTASH_REDIS_REST_TOKEN` con el nuevo valor del paso 4.
6. Save → redeploy → verificar con 11 logins productivos consecutivos en `/login` (el 6º debe disparar `RATE_LIMITED` por email límite 5/15min).

**Validación visual**: Upstash dashboard → tab **"Metrics"** debe mostrar `Writes > 0` después del smoke (antes mostraba `Writes=0` aunque hubiera Reads).

---

## Override per-tenant (futuro — NO MVP)

Hoy todos los tenants comparten los mismos defaults. Si en el futuro necesitamos
clientes enterprise con burst legítimo (ej. consultora con 50 técnicos haciendo
generaciones simultáneas), abrir **T-081-FU2**:

- Agregar tabla `consultora_rate_limit_overrides` con `{consultora_id, identifier, limit, window}`.
- Modificar `getRateLimiter` para aceptar `overrideKey` opcional que consulta la tabla.
- UI en Settings → Configuración para owner.

---

## Costos Upstash

- **Free tier**: 10k requests/day. Suficiente para MVP (~333 req/hr promedio
  asumiendo 6 server actions × 1 check + 4 multi-dim × 2 checks = 14 checks
  por flow de auth + 1 check por AI gen).
- **Pro tier** ($10/mo): 100k req/day. Considerarlo si Upstash dashboard
  reporta > 50% del free tier consumido sostenido.

Monitor primera semana post-merge en <https://console.upstash.com>.

---

## Follow-ups abiertos

- **T-081-FU1**: documentar pattern como `docs/technical/08-rate-limiting-pattern.md` cuando T-052+ Empleados/EPP herede el helper.
- **T-081-FU2**: override per-tenant.
- **T-081-FU3**: agregar `/api/health` checks de Anthropic/Resend/Telegram si Sentry reporta degradación recurrente.
- **T-081-FU4**: webhook Upstash → Sentry alert cuando rate limit threshold se crossea (visibility de attack patterns).
- **T-081-FU5**: split fail-open/fail-closed per-endpoint cuando userbase > 1000.
