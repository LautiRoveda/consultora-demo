# VPS reboot recovery (Hostinger + Docker swarm)

Runbook copy-paste para recuperar el VPS productivo cuando Hostinger reinicia el host y el Docker swarm queda con VIP allocation inconsistente.

**Cuándo aplicar**: cuando TODOS los dominios productivos del VPS devuelven `502 Bad Gateway` o timeout después de un mantenimiento Hostinger.

**Tiempo de recovery esperado**: ~30 segundos copy-paste + ~1-2 min de convergencia. Si el fix no resuelve en 5 min, ir a [Escalation](#escalation).

**Historial de incidents**:
- 19/05/2026 mañana (T-052 mid-merge).
- 19/05/2026 tarde (con edge case chatwoot-sidekiq OOM).

Pattern recurrente confirmado — abrir este runbook directo en la próxima ocurrencia, sin diagnosticar de cero.

---

## Síntomas detectables

Aplicá este runbook si **todos** estos síntomas aplican:

- ❌ TODOS los dominios productivos del VPS responden `502 Bad Gateway` o timeout (no solo uno).
- ❌ Pasa típicamente después de un mantenimiento Hostinger (reboot del host físico).
- ❌ `docker service ls` muestra services con réplicas en `N/N` running (los containers están vivos) pero los dominios siguen caídos.
- ❌ `curl -I https://<dominio>` desde el VPS mismo da `Host is unreachable` o `502`.
- ❌ Traefik dashboard (si accesible) muestra backends marked unhealthy.

Si **al menos uno** de estos síntomas falla → es OTRA causa, NO este runbook. Ver [Cuándo NO aplicar](#cuándo-no-aplicar-este-fix).

---

## Root cause

El swarm de Docker mantiene un VIP (Virtual IP) por service para load balancing interno. Post-reboot Hostinger, el VIP allocation queda inconsistente: el DNS interno del swarm resuelve al VIP viejo (range `10.11.0.X`) pero los containers reales arrancan en IPs nuevas (range `10.11.2.X`). Traefik intenta conectar al VIP fantasma y falla con `Host is unreachable`. El fix `--endpoint-mode dnsrr` (DNS Round Robin) bypasea el VIP — Traefik resuelve directo al IP del task vía DNS, evitando el VIP corrupto.

---

## Fix copy-paste

```bash
# SSH al VPS
ssh root@<TU_IP_VPS>

# 1. Snapshot estado pre-fix (debug futuro)
docker service ls > /tmp/services-pre-fix-$(date +%s).log

# 2. Aplicar dnsrr a TODOS los services productivos
docker service ls --format '{{.Name}}' | while read svc; do
  echo "Updating $svc..."
  docker service update --endpoint-mode dnsrr "$svc" --detach=false
done

# 3. Verificar que todos los services convergieron
docker service ls
# Esperás: todos en N/N replicas running.
# Excepción esperable: services con 0/0 réplicas (apagados a propósito).

# 4. Probar dominio crítico
curl -I https://consultora-demo.test-ia.cloud
# Esperás: HTTP/2 200 o 307. NO 502 Bad Gateway.
```

---

## Verificación post-fix

1. ✅ `docker service ls` muestra todos los services en `N/N` (replicas esperadas).
2. ✅ `curl -I https://<dominio>` retorna 2XX o 3XX (no 502).
3. ✅ Browser test: cargar dashboard productivo, hacer 1 click action, confirmar respuesta normal.
4. ⚠️ Si algún service quedó en `0/N`:
   ```bash
   docker service logs <name> --tail 50
   docker service update --force <name>
   ```

---

## Cuándo NO aplicar este fix

| Síntoma | Causa probable | Acción |
|---|---|---|
| `404` en lugar de `502` | Config de Traefik labels | Revisar labels del service afectado, NO este runbook |
| Solo UN dominio caído | Problema del service específico | `docker service logs <name> --tail 100`, NO swarm-wide |
| Docker daemon caído (`docker ps` no responde) | Daemon crash / OOM kernel | `systemctl restart docker`, después aplicar runbook |
| Hostinger reporta outage de red activa | Outage del proveedor | Esperar resolución, NO tocar |

---

## Edge cases observados

### chatwoot-sidekiq OOM (incident 2, 19/05/2026 tarde)

El worker `aruba_chatwoot-sidekiq` bajó a `0/1` después del update masivo.

```bash
docker service update --force aruba_chatwoot-sidekiq
```

Causa probable: OOM al rearrancar contra memoria fragmentada post-reboot. Comportamiento intermitente — si vuelve a pasar, considerar aumentar el memory limit del service.

### Services con 0/0 réplicas (`grvt-bot_*` en incident 2)

Apagados a propósito, ignorables. El loop del fix los toca pero el `docker service update` es no-op en services con 0 réplicas (no hay tasks que rearrancar).

### Comandos auxiliares de debug

Si necesitás más contexto antes/después del fix:

```bash
# Ver tasks de un service específico (para confirmar IPs nuevas vs viejas)
docker service ps <name> --format 'table {{.ID}}\t{{.Name}}\t{{.Node}}\t{{.CurrentState}}'

# Inspeccionar la network del swarm (ver VIPs asignados)
docker network inspect <network_name> --format '{{json .Containers}}' | jq

# Logs de Traefik (filtra errores de DNS / connection refused)
docker service logs easypanel-traefik --tail 200 2>&1 | grep -E "ERROR|connection refused|Host is unreachable"
```

---

## Escalation

Si el fix masivo NO resuelve después de 5 minutos:

### Paso 1: Restart Traefik específico

```bash
docker service update --endpoint-mode dnsrr easypanel-traefik
docker service update --force easypanel-traefik
```

Esperar ~60s y re-verificar con `curl -I https://<dominio>`.

### Paso 2: Restart Docker daemon (NUCLEAR)

⚠️ Corta TODOS los containers ~30 segundos. Solo si Paso 1 no resuelve.

```bash
systemctl restart docker
# Esperar 60s
docker service ls
# Re-aplicar el fix masivo del runbook desde el Paso 2
```

### Paso 3: Ticket Hostinger soporte

Si sigue caído después del daemon restart, abrir ticket con:

```bash
journalctl -u docker --since "1 hour ago" > /tmp/docker-incident-$(date +%s).log
```

Adjuntar el log + `/tmp/services-pre-fix-*.log` del snapshot inicial al ticket. Mencionar el pattern recurrente y la URL de este runbook.

---

## Por qué NO automatizamos este fix

Decisión cerrada (T-052-FU1):

- Pasa 1x cada varias semanas.
- El costo de mantener cron / healthcheck monitor con auto-fix supera el beneficio.
- Riesgo de auto-fix mal disparado en escenarios falsos-positivos (un solo dominio caído por otra causa).
- Runbook copy-paste de 30s es suficientemente rápido para el patrón observado.

Si la frecuencia aumenta a >1 vez por semana o el tiempo de recovery se vuelve crítico para clientes pagantes, reabrir la decisión con un ADR específico.

---

## Referencias

- Lesson learned: [`docs/lessons-learned.md`](../lessons-learned.md) → sección "Operativo / VPS" → "VPS reboot recovery (Hostinger + Docker swarm)".
- VPS context: [`docs/technical/06-deployment.md`](../technical/06-deployment.md).
- Ticket origen del primer incident: T-052 (mid-merge).
- Ticket origen de este runbook: T-052-FU1.
