# Auditoría comprehensive · 2026-05-25

> Pasada exhaustiva post-CHORE-D / pre-launch. Output = backlog priorizado de
> mejoras NO presentes hoy en `docs/technical/10-roadmap.md` ni en sprints
> abiertos. Yo (orquestador) propongo, Lautaro decide qué entra a sprint.
>
> Fuentes leídas: `CLAUDE.md`, `docs/discovery/*`, `docs/technical/*`,
> `docs/adr/*`, `docs/sprints/*`, `docs/operations/*`, `docs/lessons-learned.md`,
> `docs/feedback/2026-05-23-cliente-higienista-interna-construccion.md`,
> `docs/analisis-completo.md`, `package.json`, `next.config.ts`, `Dockerfile`,
> `.github/workflows/*`, lectura por sondeo de `src/app/(app)`, `src/shared/`,
> `supabase/migrations/`.
>
> Convención: cada hallazgo lleva ID `<CAT><N>` (A1, B3…). Impacto: Alto /
> Medio / Bajo. Esfuerzo: S (<1d) · M (1-3d) · L (1+sem) · XL (sprint
> dedicado). Riesgo: Alto / Medio / Bajo. NO uso emojis.

---

## Resumen ejecutivo

ConsultoraDemo llega al cierre del hardening pre-launch (CHORE-A..D + T-085)
con una base técnica madura y diferenciada (IA streaming + multi-canal +
audit inmutable + RLS con custom claim + rate-limit + monitor uptime).
Cobertura funcional vs Previo sigue en ~30%, con EPP en curso (Sprint 5
T-100..T-106) que cierra el pilar bloqueante #2 del producto.

La auditoría detecta 67 hallazgos. Los gaps de mayor palanca son producto
(features pedidas explícitamente por el cliente real higienista
construcción 2026-05-23), no técnica. La técnica tiene 12 hallazgos
operacionales tipo "defensa contra el próximo cron silencioso" alineados
con las lessons AUD-001 / Vault placeholder / T-031 idempotency cascade.
Marketing/GTM, observability custom IA y compliance Ley 25.326 son los 3
huecos que más comprometen una venta real cuando el primer cliente
auditoria lo pregunte.

Capacidad asumida: 1 dev + CC, ~5-10 días por ítem antes de fatiga, sin
deadline duro. Recomendación: cerrar EPP (Sprint 5 ya planificado), después
atacar Top 5 abajo en orden, NO mezclar.

### Top 5 hallazgos con mayor impacto

1. **A1 · Recordatorio EPP per-empleado 6m + trazabilidad individual**:
   pedido textual del cliente real (turnos 13, 14, 17, 19, 21 del feedback
   2026-05-23). Schema T-100 lo prepara, falta cerrar UI + cron + notificación
   por canal preferido del higienista. Cubierto parcialmente por Sprint 5 (T-105),
   pero la trazabilidad granular ("a Rodríguez se le entregó camisa hace
   X meses") NO está hoy. **Impacto: Alto. Esfuerzo: M post-Sprint 5.**

2. **C1 · Health endpoint para crons + Sentry alert por silencio**: el
   incidente AUD-001 (T-074) que rompió `notification_log.resend_email_id`
   silencioso desde 2026-05-24 fue descubierto accidentalmente por CHORE-C.
   Sin un health check explícito que mire "último cron exitoso < X min",
   el próximo incident silencioso entra a producción. Lesson learned ya
   tagueada en handoff, falta implementar. **Impacto: Alto. Esfuerzo: M.**

3. **I1 · Cron retención_datos_hasta + endpoint export GDPR**: el schema
   T-070 tiene la columna `retencion_datos_hasta` pero el cron que
   efectivamente borra data al alcanzar la fecha NO existe. Sin esto se
   viola Ley 25.326 art. 4 (datos no deben conservarse más de lo necesario)
   y art. 14 (derecho de acceso/export). Higienista argentino lee chico
   antes de subir DNI de empleados. **Impacto: Alto. Esfuerzo: M.**

4. **F1 · Landing pública robustecida + página /precios + features**: la
   landing `src/app/page.tsx` existe y es decente, pero falta página
   `/precios` independiente, página `/features` con demo IA + video 30s,
   landing optimizada para SEO orgánico (long-tail "informe ruido SRT"),
   blog técnico (foro de captación HyS). Pricing público es ventaja
   competitiva real vs Previnnova/SIGHyS/Smart Safety (todos opacos) — hay
   que exprimirla. **Impacto: Alto. Esfuerzo: M-L.**

5. **A6 · Generación IA con tabla SRT 84/12 + 85/12 + 886/15 + 295/03
   incorporada al prompt** (ruido / iluminación / carga térmica /
   ergonomía): cargar umbrales oficiales SRT dentro del prompt del tipo
   `relevamiento` para que Claude sugiera cumplimiento normativo con los
   valores reales. Ningún competidor AR lo tiene; el consultor cobra
   $200-500k ARS por protocolo y paga el plan Pro completo si ahorra 3hs.
   Diferenciación 10x con esfuerzo M. **Impacto: Alto. Esfuerzo: M (4-5d).**

---

## A. Producto · features de negocio

### A1 · Trazabilidad EPP per-empleado + alerta 6m por canal preferido
**Impacto: Alto · Esfuerzo: M (post-Sprint 5) · Riesgo: Bajo**

Descripción: feedback cliente higienista (turnos 14, 17, 19, 21 del audio
2026-05-23) pidió textual: "un sistema que te avise, a esta persona no
tenés que agarrar ropa, está dentro de 6 meses". Sprint 5 T-100..T-106
arma schema (`epp_entregas` + `epp_planificaciones`) + entrega con firma
canvas + planilla 299/11 PDF, pero falta cerrar:

- Vista detail empleado `/clientes/[id]/empleados/[id]` con historial
  cronológico de entregas (lista invertida por fecha + filtro por item).
- Alerta granular vía canal preferido (email/Telegram/push) con texto
  "Mañana entregar borcegos a Rodríguez (vencen el 12/06)".
- Resumen semanal lunes "tenés N entregas en los próximos 7 días" por
  Telegram bot (ya tenés infra, falta el dispatcher).

Evidencia: `docs/feedback/2026-05-23-cliente-higienista-interna-construccion.md`
turnos 13-21 + `docs/sprints/sprint-5.md` T-105 con scope limitado a
"validar que tipo='epp_entrega' se renderiza en /calendario". El feature
queda incompleto si no se cubre la UX explícita del higienista.

Recomendación: agregar **T-107** post-Sprint 5 con scope "trazabilidad
empleado-centric + canal preferido + resumen Telegram semanal". 4-5 días.

### A2 · Chat IA contextual sobre data del tenant
**Impacto: Alto · Esfuerzo: L (1-2 sem) · Riesgo: Medio**

Descripción: pedido textual cliente (turnos 32, 34): "el chat este de poder
darle, preguntado y que me hubiese dicho 'no, mirá, sí tenés registrado
que se le dio'". El consultor perdió media hora buscando en planillas
físicas si había entregado un EPP — un chat con scope tenant que responda
en 5min era el diferenciador.

Implementación: endpoint `/api/chat` con tool-use Claude
(`getEmpleados`/`getEPPDeliveries`/`searchInformes`) constrained al
`consultora_id` del JWT. Pre-warm vectorización opcional con embeddings
`text-embedding-3-small` sobre nombres+DNI+puestos para semantic search
inicial. Costo extra: ~$0.01 por consulta promedio (10K tokens cache hit).

Evidencia: feedback turnos 32-34 + tu landscape: ningún competidor AR
tiene esto. Previnnova menciona "asistente IA" pero es Q&A genérico sobre
docs, no sobre la data real del cliente.

Recomendación: **T-110** después de cerrar EPP completo. NO antes — sin
EPP no hay data interesante para preguntar.

### A3 · Casi-accidente vs accidente real (2 flujos)
**Impacto: Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: feedback turnos 22, 24: "Hay dos planillas, una de
casi-accidente, otra de accidente real con ART". Hoy el tipo `accidente`
del módulo Informes es uno solo. Discriminar afecta el contenido del
informe (casi-accidente NO va a ART, accidente real sí), el calendario
(casi-accidente NO dispara seguimiento ART), y la estadística futura
(índices SRT).

Implementación: agregar campo `tipo_accidente: 'casi_accidente' |
'accidente_real'` al schema del tipo `accidente` + prompt diferenciado por
caso + UI tab/radio en wizard. Schema `relevamiento/schema.ts` puede
servir de patrón.

Evidencia: feedback turnos 22, 24.

Recomendación: **T-111** dentro del módulo Informes. 2-3 días.

### A4 · Checklists personalizables por sector/rubro
**Impacto: Medio-Alto · Esfuerzo: L · Riesgo: Bajo**

Descripción: feedback turnos 8, 12: "los checklists deben ser adaptables
por sector/rubro, cada empresa tiene su sistema". Hoy NO existe módulo
Checklists implementado (M8 del docs/technical/02-architecture.md está
listado pero diferido). El roadmap T-057..T-061 (Sprint 6 original) lo
tenía pero quedó renumerado.

Recomendación: pre-launch NO crítico. Mantener en Fase 2 Plan Team.
Post-launch si emerge demanda real >3 clientes pidiéndolo. M9 Catálogo de
Tareas + M8 Checklists se construyen juntos.

Evidencia: feedback turnos 8, 12 + análisis-completo.md sección 5 (Could,
no Must).

### A5 · Carga por foto + OCR
**Impacto: Medio · Esfuerzo: L · Riesgo: Medio**

Descripción: feedback turno 29: "carga por foto + OCR IA" validado por
el cliente. Use case: foto de planilla papel Res 299/11 firmada → OCR
extrae DNI + firma + items + fecha → pre-popula entrega EPP. Bridge entre
papel legacy y digital.

Implementación: endpoint `/api/epp/entregas/from-photo` con
`Claude vision` (sonnet-4-6 maneja imágenes nativo) + Sharp pipeline pre
para escala/contraste. Costo IA por foto ~$0.05-0.10 con vision tokens.

Recomendación: **T-112** post-Sprint 5 + post-EPP UI. M.

Evidencia: feedback turno 29.

### A6 · Generación IA con umbrales SRT cargados al prompt
**Impacto: Alto · Esfuerzo: M (4-5d) · Riesgo: Bajo**

Descripción: extender los prompts de los tipos `relevamiento` y
`capacitacion` con las tablas SRT oficiales:

- **Res 85/12 ruido**: TLV 85 dB(A) jornada 8h, escala dosimetría, criterio
  pico 140 dB(C).
- **Res 84/12 iluminación**: lux por tipo de tarea (oficina 500 lx, taller
  300 lx, etc).
- **Res 886/15 ergonomía**: IFR (índice de frecuencia/repetitividad), MET
  (manipulación esfuerzo de tareas).
- **Res 295/03 sustancias químicas**: TWA/STEL/IDLH para 600+ sustancias.
- **Carga térmica IRAM**: WBGT por actividad metabólica.

Hoy `src/shared/templates/relevamiento/schema.ts` tiene `AGENTES_HYS`
listo pero no se cruza con tabla SRT en el prompt. La IA produce informes
estructurados decentes pero el consultor sigue verificando los valores en
PDF SRT.

Implementación: archivo `src/shared/ai/srt-tables/` con las tablas
versionadas + injection automática al prompt según `agente` seleccionado +
disclaimer en informe "valores referencial Res XX/YY del SRT versión
ZZ/MM/AAAA". Caching ephemeral (prefix > 2048 tokens → cache hit ~90%).

Evidencia: `docs/analisis-completo.md` oportunidad #1 + #6 + diferenciador
#5 (palanca alta). Ningún competidor AR tiene esto.

Recomendación: **T-113** prioritario post-EPP. Diferenciación competitiva
de palanca alta.

### A7 · Generador IA del RGRL anual pre-llenado al 80%
**Impacto: Alto · Esfuerzo: M (4-5d) · Riesgo: Bajo**

Descripción: el tipo `rgrl` ya existe en el wizard pero la generación
arranca desde cero. El RGRL anual (Res SRT 463/09) tiene secciones fijas
+ datos del cliente + empleados + accidentes históricos. Si la IA
pre-llena el 80% con data ya cargada en el sistema, el consultor edita el
20% restante en 30 min vs 4-8hs hoy.

Implementación: query agregado `getRGRLContext(clienteId, periodo)` que
trae empleados + entregas EPP del año + accidentes + capacitaciones, y
pasarlo al prompt RGRL. Patrón similar a A2 chat contextual pero
specialized para 1 tipo.

Evidencia: `docs/analisis-completo.md` oportunidad #6. Es "el informe más
doloroso del año" (~40pp). Justifica plan Pro USD 30 con un solo uso
anual.

Recomendación: **T-114** post-Sprint 5 + post-A6 (necesita SRT tables
para autocompletar índices Res 463/09 dentro del RGRL).

### A8 · Importación CSV empleados/clientes
**Impacto: Medio-Alto · Esfuerzo: M (3d) · Riesgo: Bajo**

Descripción: el consultor llega con cartera de 5-20 clientes y 50-200
empleados en Excel. Sin import masivo, signup → ingreso manual = 3hs de
fricción → churn primera sesión.

Implementación: endpoint `/api/clientes/import-csv` + `/api/empleados/import-csv`
con preview + dedup por CUIT/DNI + report de errores por fila. UI con
file upload + tabla preview + commit. Patrón similar al magic-bytes
T-024.

Evidencia: `docs/analisis-completo.md` sección 5 Ola 2 #2 + sección 6.2
escalabilidad obvia.

Recomendación: **T-115** post-Empleados UI cerrada. M.

### A9 · WhatsApp Business API canal de notificación
**Impacto: Alto · Esfuerzo: M (1 sem incl onboarding API) · Riesgo: Medio**

Descripción: feedback + análisis convergen: el consultor argentino vive
en WhatsApp, NO en email. Hoy tenés email + Telegram + Push pero NO
WhatsApp. Telegram penetra técnicos jóvenes; WhatsApp es universal.

Implementación: provider `360dialog` o `Meta Cloud API` direct. Adapter
nuevo en `src/shared/notifications/senders/whatsapp.ts` siguiendo patrón
de los 3 senders existentes. UI Settings → activar WhatsApp con número +
opt-in template approval (Meta exige aprobación previa de cada template
de notificación, ~24-48h proceso).

Costos: ~USD 0.005-0.05 por mensaje según país/categoría (vs Telegram
gratis, email Resend $0.0004). Plan Pro USD 30 cubre ~600 notif/mes
WhatsApp sin problema.

Evidencia: `docs/analisis-completo.md` oportunidad #2 + diferenciador #2
+ feedback turno 32 (cliente menciona Telegram pero pidió "que me llegue
al WhatsApp").

Recomendación: **T-120** post-launch comercial. NO antes de tener 5
clientes pagos — costo de Meta template approval no se justifica.

### A10 · 8 índices SRT (Res 463/09) automáticos
**Impacto: Medio · Esfuerzo: M (4d con tabla `incidentes`) · Riesgo: Bajo**

Descripción: Res SRT 463/09 obliga calcular y reportar 8 índices anuales:
IF (frecuencia), IG (gravedad), ID (duración media), Incidencia, PESE
(pérdida económica), etc. El consultor lo hace a mano en Excel cada
febrero-marzo. Previo/GENESIS lo tienen.

Implementación: tabla `incidentes` (distinta del tipo `accidente` informe)
+ query agregado + dashboard con 8 cards + export PDF/Excel. Dependencia:
`empleados` con `fecha_ingreso` (ya está T-052) + tabla `incidentes`
(falta) + dotación promedio (campo `consultoras.dotacion_promedio`
NEW).

Recomendación: **T-130** Fase 2 (no MVP). Trigger: 1er cliente con >20
empleados activos. Cálculo es 1 vez/año febrero → si lanzás julio, tenés
6 meses.

Evidencia: `docs/analisis-completo.md` sección 4.1 matriz feature.

### A11 · Matriz de riesgos IPER por puesto
**Impacto: Medio · Esfuerzo: L · Riesgo: Bajo**

Descripción: IPER (Identificación de Peligros + Evaluación de Riesgos)
todos los competidores lo tienen, vos no. Plantillas por CIIU + IA que
sugiere 15 riesgos típicos por industria + heatmap probabilidad×severidad
+ medidas de control jerárquicas (eliminación → sustitución → ingeniería
→ administrativo → EPP).

Recomendación: **T-140** Fase 2. NO MVP — pocos higienistas freelance lo
usan diariamente (1 vez al año), pero es feature visible en demo de venta.

Evidencia: `docs/analisis-completo.md` sección 4.1 + sección 7 op #7.

### A12 · Módulo Capacitaciones dedicado con padrón asistencia
**Impacto: Medio · Esfuerzo: L (1-2 sem) · Riesgo: Bajo**

Descripción: hoy `capacitacion` es un tipo de informe. Falta padrón de
asistentes con DNI/firma, renovación 12m (Res 905/15), constancia
individual firmada por matriculado.

Recomendación: **T-150** Fase 2.

Evidencia: `docs/analisis-completo.md` sección 4.1 + 5 Ola 2 #1.

### A13 · Exámenes médicos (preocupacional/periódico/egreso)
**Impacto: Medio · Esfuerzo: L · Riesgo: Bajo**

Descripción: Res SRT 37/10 obliga 3 exámenes médicos por trabajador
(ingreso + periódico anual >40 años + egreso). Hoy NO existe módulo.
Tercerizan a ART/clínica generalmente, pero el seguimiento de "quién
falta" y "quién vence" es del higienista.

Recomendación: **T-160** Fase 2 post Plan Team. Trigger: cliente PYME
pequeña que NO terceriza.

### A14 · Cronograma CIIU 53 obligaciones Dec 351/911/617
**Impacto: Bajo-Medio · Esfuerzo: L · Riesgo: Bajo**

Descripción: por CIIU (código de actividad económica AR) hay 53
obligaciones HyS anuales (auditoría eléctrica anual, recarga matafuegos
trimestral, etc). Catálogo + ticking + alertas. Mucho data entry para
curar.

Recomendación: **T-170** Could. Backlog largo. NO priorizar — pocos
higienistas freelance reportan que falta.

### A15 · Tabla `establecimientos` (multi-sede por cliente)
**Impacto: Medio · Esfuerzo: L · Riesgo: Bajo**

Descripción: hoy `empleados` tiene `cliente_id` directo. Cliente
industrial con 2-5 plantas no encaja: empleados pertenecen a planta X,
EPP se entrega en planta Y, RGRL es por sede. Schema T-052 documenta
"MVP asume 1 sede por cliente".

Recomendación: **T-180** Fase 3 cuando entre 1er cliente con multi-sede.
Schema preparado para FK NULL-able futura.

Evidencia: `docs/analisis-completo.md` sección 2.5 + 5 Ola 3 #5 +
`supabase/migrations/20260519114309_empleados.sql` comment.

### A16 · Marca blanca diferenciada por plan
**Impacto: Bajo-Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: hoy todos los planes incluyen branding (logo + color en PDF).
Plan Pro Previo USD 179k incluye marca blanca como feature premium. Si
vendés Plan Team USD 100 sin diferenciar, ¿qué motiva el upgrade desde
Pro USD 30?

Implementación: feature flag `consultoras.plan` controla render del
footer "Generado con ConsultoraDemo" en PDF. Plan trial/pro lo muestra,
Plan team/enterprise lo oculta + permite logo + color custom.

Recomendación: **T-190** cuando Plan Team se lance Fase 2.

### A17 · Resumen semanal lunes via Telegram bot
**Impacto: Bajo · Esfuerzo: S (2d) · Riesgo: Bajo**

Descripción: cron lunes 09:00 ART manda al chat del bot Telegram del user
"tenés 3 entregas EPP esta semana + 1 capacitación renovar + 2 RGRL para
firmar". Reduce churn pasivo (user que no abre la app no ve
notificaciones).

Implementación: cron semanal pg_cron + función `get_weekly_summary
(user_id)` + dispatcher Telegram existente. Reusa T-031/T-033 infra.

Recomendación: **T-195** quick win post-launch. S.

Evidencia: `docs/analisis-completo.md` oportunidad #8.

### A18 · Tabla `incidentes` libro digital separado del informe accidente
**Impacto: Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: hoy `accidente` es un tipo de informe IA. Falta libro de
incidentes con seguimiento ART (denuncia + ART id + status + días de baja
+ retorno) para calcular índices A10. Schema modular: `incidents` table
con FK `informe_id` opcional (un incidente puede o no tener informe
asociado).

Recomendación: **T-200** dependencia de A10 (8 índices). Hacer juntos.

---

## B. Arquitectura · escalabilidad

### B1 · Doc drift: `src/modules/` documentado vs `src/shared/` real
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: `CLAUDE.md` línea 29 + `docs/technical/02-architecture.md` +
`docs/technical/04-folder-structure.md` describen un layout
`src/modules/<nombre>/` con `actions.ts`+`queries.ts`+`schemas.ts`+`index.ts`
por módulo. La realidad es `src/app/(app)/<route>/` para actions/queries
+ `src/shared/<área>/` para infraestructura compartida. Esto confunde a
CC en cada briefing.

Evidencia: `docs/technical/02-architecture.md` líneas 33+ vs `ls src/`
muestra `app/`, `shared/`, `tests/` sin `modules/`.

Recomendación: **T-DOC1** cleanup doc: actualizar arquitectura.md y
folder-structure.md al layout real. S.

### B2 · `getInformesByClienteId` cap 50 hard, sin paginación
**Impacto: Bajo (hoy) · Esfuerzo: S · Riesgo: Bajo**

Descripción: `src/app/(app)/clientes/queries.ts` (T-050) limita la lista
de informes vinculados a 50. Para Plan Team con consultora atendiendo
cliente industrial 200 informes/año, 50 es insuficiente.

Recomendación: **T-FU2 T-050** ya está en backlog del módulo. Activar
trigger "clientes con >10 informes" → paginar.

### B3 · Search clientes/empleados client-side filter
**Impacto: Bajo-Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: `ClientesList.tsx` + `EmpleadosListContainer.tsx` filtran
client-side sobre rows pre-fetched. Funciona hasta 100-200 entries.
Plan Team con consultora gestionando 500+ clientes/empleados va a
necesitar full-text search server-side con índices GIN `pg_trgm` o
`tsvector`.

Recomendación: **T-FU3** diferible. Disparador: 1er tenant con
`select count(*) from clientes where consultora_id=X` > 200.

Evidencia: `src/app/(app)/clientes/ClientesList.tsx` (T-049).

### B4 · PDF Puppeteer single-process retirado, sin pool
**Impacto: Medio · Esfuerzo: M · Riesgo: Medio**

Descripción: CHORE-D retiró `--single-process` (lesson docs/lessons-learned.md).
Cada PDF arranca un Chromium fresh ~300 MB RAM. Si 5 users concurrentes
generan PDFs, el container 8GB se acerca al límite (5 × 300 MB + Node
600MB + Supabase pool 100MB + tilt overhead ≈ 2.5 GB + buffers).

Recomendación: **T-PDF1** evaluar pool de N=2-3 browsers con reuse +
TTL. Disparador: alerta Sentry "OOM" / `docker stats` reporta >80%
sostenido. Hoy NO crítico (VPS 8GB + 1 user productivo). NO premature
optimization.

Evidencia: `docs/lessons-learned.md` "Puppeteer --single-process retirado
CHORE-D".

### B5 · `notification_log` no particionado
**Impacto: Bajo (hoy) · Esfuerzo: M · Riesgo: Bajo**

Descripción: `notification_log` crece linealmente con N consultoras × N
notificaciones/día. Hoy ~10 rows/día, OK. Con 100 consultoras × 10 notif
= 1000 rows/día × 365 = 365k rows/año = ~50MB/año aprox. Tolerable hasta
1-2 años, después query slow + index bloat.

Recomendación: **T-PART1** evaluar partición por mes cuando el row count
supere 100k. Diferible.

### B6 · `audit_log` retención sin política
**Impacto: Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: `audit_log` tiene FK `consultora_id ON DELETE RESTRICT`
(T-011) — bloquea cleanup. Crece linealmente con todas las tablas de
dominio (audit triggers en cada INSERT/UPDATE de cada tabla). Con 28
tablas dominio + 5 events/tabla/día por tenant promedio × 100 tenants =
14k rows/día × 365 = 5M rows/año = ~2-3 GB/año.

Recomendación: **T-AUD1** política de retención:
- Partición por mes (`pg_partman` o manual).
- Cron archive rows >12 meses al bucket Supabase Storage en formato JSON.
- DROP partition tras archive.
Combinable con compliance Ley 25.326 I1.

Disparador: row count > 1M. Hoy NO urgente.

### B7 · Cross-tenant defense pre-INSERT pattern: solo en T-050/T-053
**Impacto: Medio · Esfuerzo: S por módulo · Riesgo: Medio**

Descripción: el pattern "SELECT RLS-aware antes de INSERT con FK cross-
módulo" está implementado en `informes` (T-050 cliente_id) + `empleados`
(T-053 cliente_id), pero **no aplicado uniformemente** en otros lugares
donde FK cross-módulo entra desde input del cliente:
- `epp_entrega_items.empleado_id` (T-100/T-102) — verificar
- `calendar_events.informe_id` (T-027) — verificar (legacy pre-pattern)
- `epp_entregas.empleado_id` (T-100) — verificar
- `empleados_puestos.empleado_id + puesto_id` (T-100) — verificar

Si alguno bypasea, atacante puede crear FK cross-tenant + leakear
existencia.

Recomendación: **T-SEC1** audit pasada por todas las server actions que
insertan FK cross-módulo desde input. S por módulo, M total.

Evidencia: `docs/lessons-learned.md` "Cross-tenant defense pre-INSERT con
SELECT RLS-aware" lesson T-050.

### B8 · Service-role usage scope cap
**Impacto: Bajo-Medio · Esfuerzo: S · Riesgo: Medio**

Descripción: `createServiceRoleClient()` es usado en 8+ lugares (cron
handlers + webhooks + endpoints subscribe). Cada uso es defensible
individualmente, pero NO hay test arquitectónico que prohíba uso desde
Server Actions del usuario.

Recomendación: **T-SEC2** ESLint custom rule + dependency-cruiser config
que prohíba `createServiceRoleClient` desde `src/app/(app)/**/actions.ts`
excepto whitelist explícita (`epp/entregas/actions.ts` para RPC
`gen_epp_planificaciones_y_calendar_for`).

### B9 · RHF schema LOCAL workaround repetido
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: lesson T-049 (schema LOCAL gotcha RHF) abierto como
follow-up T-049-FU1 "helper canónico `optionalString({min, max})`".
Ya se repitió en T-053 Empleados, va a repetirse en EPP forms. Tech
debt acumulándose.

Recomendación: **T-049-FU1** ejecutar como S. Helper en `src/shared/lib/`
+ migrar 4-5 schemas existentes en paralelo.

### B10 · Rate limit fail-open en auth = false negative attack vector
**Impacto: Medio · Esfuerzo: S · Riesgo: Medio**

Descripción: `src/shared/security/rate-limit.ts` retorna `success: true`
+ `logger.warn` si Upstash cae. Lesson `docs/operations/rate-limiting.md`
explica el trade-off (defense in depth + Supabase Auth tiene throttle
interno). Pero un atacante que detecta `rate_limit_check_failed_failing_open`
en Sentry + sabe que Upstash está caído puede burst login attempts en esa
ventana.

Mitigación parcial existente: `T-081-FU5` split per-endpoint (auth
fail-closed, AI generation fail-open) — diferido a userbase > 1000.

Recomendación: **T-SEC3** activar split EARLIER (userbase > 50 ya
justifica). S.

### B11 · CSP `'unsafe-inline'` en script-src + style-src
**Impacto: Medio · Esfuerzo: L · Riesgo: Bajo**

Descripción: `next.config.ts` CSP tiene `script-src 'self' 'unsafe-inline'`
+ `style-src 'self' 'unsafe-inline'`. Comment dice "migración a
nonce-based queda para iter futura". `unsafe-inline` permite XSS si
algún input se renderiza sin sanitización (hoy `react-markdown` con
`rehype-sanitize` cubre, pero no es def-in-depth).

Recomendación: **T-CSP1** migración a nonce-based con Next 16 middleware.
L. Diferible — `rehype-sanitize` + dompurify equivalente vía rehype cubre
el caso principal de XSS hoy.

### B12 · Single-tenant per user (schema soporta M:N, código no)
**Impacto: Bajo (hoy) · Esfuerzo: M · Riesgo: Bajo**

Descripción: `consultora_members` es M:N pero `getCurrentConsultora()`
asume single. Si un user es member de 2 consultoras, el JWT custom claim
+ helpers T-015 fast-path solo soportan una.

Recomendación: **T-MULTI1** activar selector de tenant cuando llegue 1er
user multi-consultora. Diferible.

### B13 · `puppeteer-core` + Chromium-alpine version drift
**Impacto: Medio · Esfuerzo: S · Riesgo: Medio**

Descripción: `puppeteer-core@23.11.1` (Sept 2024) + Chromium-alpine
default del Dockerfile. Si Alpine actualiza Chromium pero puppeteer-core
no upgrada, protocolo CDP se desincroniza → PDF rendering falla
silencioso. Lesson `Issue #56` muestra que Windows local ya tiene
problemas similares.

Recomendación: **T-PDF2** pin Chromium version en Dockerfile + sumar
smoke test en CI que renderice 1 PDF mínimo. S.

Evidencia: `Dockerfile` líneas Chromium install + lessons T-023 + Issue
#56.

---

## C. Operations · observability

### C1 · Health endpoint para crons + Sentry alert por silencio
**Impacto: Alto · Esfuerzo: M · Riesgo: Medio**

Descripción: lesson AUD-001 + Vault placeholder demostraron que crones
silenciosos rompen el producto sin alerta. Hoy `/api/health` solo chequea
Supabase. Falta:

- `/api/health/crons` que devuelva por cada cron registrado: nombre +
  `last_run_at` + `last_status` + `consecutive_failures`. Lee de
  `net._http_response` agregando por `headers.X-Cron-Name`.
- Sentry alert rule "si `last_run_at` > 90min hace + cron config dice
  `every 60min`" → notify.
- `/api/health/notifications` que devuelva `count(*) where status='failed'
  and created_at > now() - interval '6h'` por canal.

Evidencia: `docs/lessons-learned.md` "AUD-001 immutable trigger rompió
T-074 silenciosamente" + handoff sección "Roadmap post-launch" tercer
ítem.

Recomendación: **T-201** crítico defense forward. M.

### C2 · Métricas custom IA cost + token per tenant
**Impacto: Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: la tabla `ai_usage_log` está mencionada en roadmap T-039
pero no implementada (renumerado al Sprint 3 Pagos). Hoy hay tracking
local en `audit_log` payload del informe (input/output tokens), pero NO
hay query agregado para ver "esta consultora consumió $X de Claude este
mes".

Si una consultora abusa (50 generaciones/día = ~USD 5/día = USD 150/mes
contra plan USD 30 → margen negativo), no te enterás hasta facturar
Anthropic.

Recomendación: **T-202** crítico para cost control. Migration
`ai_usage_log` + write desde streaming `onComplete` callback + dashboard
admin `/internal/usage`. M.

Evidencia: `docs/technical/10-roadmap.md` T-039 mencionado + `docs/analisis-completo.md`
sección 6.2 escalabilidad.

### C3 · Sentry alert rules NO configuradas
**Impacto: Medio · Esfuerzo: S · Riesgo: Medio**

Descripción: Sentry está instalado + capturando, pero `T-083-FU1`
"Sentry alerting rules complementario al synthetic monitoring" sigue
abierto. Sin alerts proactivas (error rate spike > 5%/hora, latency p95
> 2s, nuevo error type, billing webhook fail), descubrís bugs por
casualidad o por user que reporta.

Recomendación: **T-203** S. Configurar 5-7 reglas iniciales:
- Error rate spike (>10 errors/hora desde un módulo).
- Latency p95 `/api/informes/[id]/generate-stream` > 5s sostenido.
- New issue type (primera ocurrencia → telegram).
- MP webhook signature failures > 3/hora.
- Cron handler error → telegram.
- DB connection pool exhaustion.

Evidencia: `docs/operations/monitoring.md` §11 futuro + handoff.

### C4 · Smoke runbook post-deploy general
**Impacto: Medio · Esfuerzo: S (2-3h) · Riesgo: Medio**

Descripción: existen runbooks por módulo (clientes-smoke + empleados-smoke
+ sprint3-smoke). Falta runbook **post-deploy general** que combine:
verificación crons activos, magic bytes válidos, CSP headers, health,
PDF render, AI generation 1 sample. ~10 min check post-merge.

Recomendación: **T-204** S. Handoff lo identifica.

Evidencia: handoff sección "Roadmap post-launch" segundo ítem.

### C5 · Dashboard de uso interno (admin)
**Impacto: Bajo · Esfuerzo: M · Riesgo: Bajo**

Descripción: para vos como owner: ver MRR + ARR + churn + N tenants
activos + AI cost + EPP entries últimos 30d. Hoy todo está en queries
manuales a Supabase Studio. Un dashboard `/internal/admin` (gateado por
email allowlist) ahorra 15 min/semana.

Recomendación: **T-205** post-launch cuando arranquen métricas reales.
M. Acoplado a C2 (ai_usage_log).

### C6 · Logs aggregator no configurado
**Impacto: Bajo · Esfuerzo: M · Riesgo: Bajo**

Descripción: pino loggea a stdout del container EasyPanel. Para query
"qué pasó con el cron last night" hay que ssh + docker logs grep. Sin
aggregator (Loki/Logtail/Better Stack Logs), debugging es lento.

Recomendación: **T-206** Better Stack Logs tier free 1GB/mes alcanza
para MVP. Setup ~2h.

### C7 · Test cuatrimestral DR sin agenda activa
**Impacto: Medio · Esfuerzo: 0 (es discipline) · Riesgo: Medio**

Descripción: `docs/operations/disaster-recovery.md` §8 documenta test
cuatrimestral marzo/julio/noviembre. **Próximo julio 2026 + nunca
ejecutado**. Sin test, los backups son "esperanza".

Recomendación: agendar reminder ahora. Si llegamos a julio sin clientes
pagos, postergar pero documentar la decisión.

### C8 · Better Stack monthly test alerting nunca ejecutado
**Impacto: Bajo · Esfuerzo: 0 · Riesgo: Medio**

Descripción: `docs/operations/monitoring.md` §8 documenta test mensual 1er
sábado. **Última ejecución: campo vacío en doc**. Mismo riesgo que C7.

Recomendación: ejecutar próximo sábado, fijar el log. S.

---

## D. Developer experience

### D1 · Seed data mínimo / no representativo
**Impacto: Bajo · Esfuerzo: M · Riesgo: Bajo**

Descripción: `supabase/seed.sql` (existe pero no leído por CC al onboardear).
Para CC y para futuros developers, falta seed realista (1 consultora + 5
clientes + 30 empleados + 10 informes + 20 entregas EPP). Permitiría
demos locales + testing E2E con data realista.

Recomendación: **T-DX1** M. Script `pnpm db:seed:demo` con fixtures.

### D2 · `pnpm db:types` no auto-run post-migration
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: lesson T-047 forzada manualmente. Husky pre-push detecta
falla typecheck pero no auto-fix. Friction repetitiva.

Recomendación: **T-DX2** git hook post-merge a main que detecta nuevas
migrations + corre `pnpm db:types` auto + commit "chore: regenerate
types post migration". S.

### D3 · Docs drift acumulado
**Impacto: Medio · Esfuerzo: S · Riesgo: Bajo**

Descripción: drift detectado en este audit:
- `02-architecture.md` describe `src/modules/`, NO existe.
- `10-roadmap.md` aún tiene Sprint 5/6/7 numeración legacy mezclada.
- `analisis-completo.md` dice "T-054 UI Empleados pendiente" pero T-054
  está implementado (verificado: `src/app/(app)/empleados/page.tsx`
  existe + T-054 mencionado en código).
- `CLAUDE.md` "Próximo ticket: T-054" estale.

Recomendación: **T-DX3** sweep mensual de docs principales. S/M.

### D4 · ADRs no actualizados post-decisión
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: hay 8 ADRs (0001-0008). Decisiones grandes posteriores que
deberían ser ADRs:
- CHORE-D retiró single-process Puppeteer.
- T-085 timezone AR hardcode.
- Sprint 5 EPP arquitectura (7 tablas + función pública vs trigger).
- AUD-001 fix pattern (trigger refinement).

Recomendación: **T-DX4** crear ADRs 0009-0012 retroactivos. S.

### D5 · Browser pool E2E pre-warm
**Impacto: Bajo · Esfuerzo: M · Riesgo: Bajo**

Descripción: `T-037-FU1` abierto: 4 E2E Windows-local-only flaky.
Workaround documentado, refactor pendiente. Tech debt.

Recomendación: ya tracked. Mantener.

### D6 · CI sin coverage gate
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: `package.json` tiene `test:coverage` pero CI no ejecuta ni
gate. Principio 4 (`docs/technical/01-principles.md`) dice ">70%
cobertura". Sin gate, principio es aspiracional.

Recomendación: **T-DX5** sumar step `pnpm test:coverage --reporter=text-summary`
+ fail si line < 70% en CI. S.

---

## E. Performance

### E1 · Lighthouse no medido en CI / sin baseline
**Impacto: Medio · Esfuerzo: S · Riesgo: Bajo**

Descripción: principio 8 (`docs/technical/01-principles.md`) dice
"Lighthouse > 90". NO existe baseline ni CI gate. T-072 lo tenía
agendado en Sprint 7 (legacy), nunca ejecutado.

Recomendación: **T-PERF1** S. Acción GitHub `treosh/lighthouse-ci-action`
+ baseline contra /, /login, /dashboard (mock auth). Gate informativo
primer mes, blocking después.

### E2 · Bundle size no monitoreado
**Impacto: Bajo-Medio · Esfuerzo: S · Riesgo: Bajo**

Descripción: el bundle del cliente puede crecer sin tracking. `react-day-picker`
+ `lucide-react` + `recharts` (si entra en C5 dashboard) son pesados.

Recomendación: **T-PERF2** `next-bundle-analyzer` plugin + CI step report
size diff por PR. S.

### E3 · DB slow query log no activado
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: Supabase free tier permite query stats via
`pg_stat_statements`. Sin review periódico, queries que pueden saturar
producción siguen sin detectar.

Recomendación: **T-PERF3** S. Review mensual top 20 queries by
`total_exec_time` + index si justifica.

### E4 · Costo IA proyección 100x no calculado
**Impacto: Medio · Esfuerzo: S · Riesgo: Medio**

Descripción: hoy 1 informe Sonnet 4.6 cuesta ~$0.10-0.30 (input + output
+ thinking). 100 consultoras × 10 informes/mes = 1000 generaciones =
$100-300/mes. Plan Pro = USD 30, margen = USD 27 - costo IA. Si la
consultora abusa (50/mes) → margen NEGATIVO.

Sin ai_usage_log (C2), no podés enforce ni siquiera detectar.

Recomendación: combina con C2 + agregar caps por plan (Plan Pro: 50
generaciones/mes hard cap, soft warn a 30). M.

### E5 · Sin caching de prompt prefix Anthropic (ephemeral)
**Impacto: Medio · Esfuerzo: S · Riesgo: Bajo**

Descripción: Anthropic SDK soporta prompt caching ephemeral (TTL 5min).
Si el prompt de RGRL tiene 6000 tokens de instrucciones + 1500 tokens
input variable, marcando los primeros 6000 como cache reduce costo
50-90% en generaciones consecutivas.

Hoy `src/shared/ai/stream.ts` no marca `cache_control: { type:
'ephemeral' }`. Cada generación paga input completo.

Recomendación: **T-PERF4** activar caching en los 5 prompts. S. Esfuerzo
1-2h. Ahorro tangible una vez activado A6 (tablas SRT pesadas como
prefix).

Evidencia: `src/shared/ai/anthropic.ts` comment línea 33 menciona prompt
caching pero no lo activa.

### E6 · Image optimization Next.js / `<Image>` no uniforme
**Impacto: Bajo · Esfuerzo: M · Riesgo: Bajo**

Descripción: sin auditar a fondo, pero `consultora-logo` y attachments
probablemente se renderizan con `<img>` clásico en algunos lugares. Next
`<Image>` con LCP optimizations no aplica en todos.

Recomendación: **T-PERF5** sweep + reemplazo. M.

---

## F. Marketing / GTM

### F1 · Landing pública + `/precios` + `/features` + signup polish
**Impacto: Alto · Esfuerzo: M-L · Riesgo: Bajo**

Descripción: landing existe pero falta:
- Página dedicada `/precios` con tabla pricing + FAQ pricing + CTA trial.
- Página dedicada `/features` con video 30s de IA streaming + screenshots
  EPP + capturas Telegram alert + comparación silenciosa contra Previo.
- Signup polish: progress indicator + "qué pasa después de signup" +
  validación visual.
- Hero copy con prueba social (cuando exista 1er testimonio).
- Open Graph tags + Twitter card.

Evidencia: análisis-completo.md sección 5 Ola 1 #5. `src/app/page.tsx` ya
muestra landing decente pero one-pager.

Recomendación: **T-MK1** M-L. Bloqueante para captación orgánica seria.

### F2 · Demo interactiva embebida
**Impacto: Medio-Alto · Esfuerzo: M · Riesgo: Bajo**

Descripción: hoy un visitante interesado tiene que signup → trial →
explorar. Friction alta. Demo embebida (video 90s + sandbox readonly con
tenant demo pre-cargado) baja friction → 3x conversion.

Recomendación: **T-MK2** Loom + sandbox solo lectura post-launch. M.

### F3 · Blog SEO técnico HyS
**Impacto: Medio · Esfuerzo: L sustained · Riesgo: Bajo**

Descripción: SEO orgánico es el canal de captación más barato a largo
plazo. Posts mensuales tipo "Cómo armar la planilla Res 299/11", "RGRL
Res 463/09 paso a paso", "8 índices SRT calculados con Excel", drenan
tráfico long-tail.

Hoy `/blog/*` no existe.

Recomendación: **T-MK3** L. 1 post quincenal × 6 meses → 12 posts → 50%
del tráfico organico target. NO consume mucho dev time si Lautaro
escribe.

### F4 · Programa de referidos (D13)
**Impacto: Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: `docs/discovery/00-decisiones.md` D13 dice "referidos desde
día uno". No está implementado.

Implementación: tabla `referrals` + `referral_code` único por user +
landing `?ref=X` + tracking + crédito ARS al pago efectivo. Suma
viralidad sin marketing budget.

Recomendación: **T-MK4** post-launch comercial. M.

### F5 · Convenio con colegio profesional / cámara
**Impacto: Muy Alto · Esfuerzo: S técnico + M negociación · Riesgo: Medio**

Descripción: GENESIS firmó convenio con CPIA Corrientes (cpiaya.org.ar) =
distribución capturada. Mismo movimiento con AHRA + COPIME + COPHISEC =
acceso a 10-15k matriculados activos.

Lo técnico: descuento código aplicable + signup landing con co-branding.
Lo difícil: negociación.

Recomendación: **T-MK5** post-launch + post-EPP + post-Pagos. Lautaro
arranca negociación con AHRA cuando tenga 3 clientes pagos como referencia.

Evidencia: `docs/analisis-completo.md` op #4 + 7.

### F6 · Onboarding interactivo (checklist + tour)
**Impacto: Medio-Alto · Esfuerzo: M · Riesgo: Bajo**

Descripción: T-067 del Sprint 7 legacy. Sin esto un user nuevo se pierde
en `/dashboard`. Banner "Creá tu primer cliente → dá de alta un empleado
→ generá tu primer informe → recibí tu primera alerta". Reduce churn
primera semana ~50%.

Recomendación: **T-MK6** S-M. Crítico pre-comercial.

### F7 · Email de bienvenida + tour
**Impacto: Bajo-Medio · Esfuerzo: S · Riesgo: Bajo**

Descripción: T-074 legacy. Hoy welcome email default Supabase. Custom
email Resend con CTA "primer informe en 5min" + link a tutorial video
mejora activation.

Recomendación: **T-MK7** post-F6. S.

### F8 · Social proof prep
**Impacto: Medio · Esfuerzo: S · Riesgo: Bajo**

Descripción: cuando llegue el 1er cliente pago, pedir testimonio + caso
de uso + métrica concreta ("ahorró 3hs/semana"). Hoy NO existe section
en landing.

Recomendación: hold-out hasta que existan los testimonios. Sumar section
en `/features` cuando exista.

---

## G. Data / analytics

### G1 · Funnel signup → trial activo → paid no instrumentado
**Impacto: Alto · Esfuerzo: M · Riesgo: Bajo**

Descripción: D14 dice "métricas con cláusulas de pivot 60/90/180 días"
pero no hay funnel. Hoy NO sabés:
- Signups/semana
- % que activa trial (genera 1er informe)
- % que entra Plan Pro
- Time-to-first-informe
- Churn semana 1 / mes 1 / mes 3

Sin esto, NO podés hacer pivot informado a 60/90 días.

Implementación: eventos custom en pino + tabla `analytics_events` o
PostHog cloud free tier (1M events/mes). Eventos clave: signup,
trial_started, first_informe_generated, first_client_added, plan_upgraded,
trial_expired, churned.

Recomendación: **T-AN1** M. PostHog vs custom — PostHog gana por
funnel/cohort UI built-in.

### G2 · Cohort retention no medible
**Impacto: Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: corolario de G1. Sin events no hay cohort.

Recomendación: combina con G1.

### G3 · Métricas uso por consultora
**Impacto: Medio · Esfuerzo: S (post-C2) · Riesgo: Bajo**

Descripción: para soporte ("¿esta consultora está activa?") + sales
intelligence ("usuario power user, candidate a Plan Team"). View en
admin (C5) con N informes/mes + N empleados + N entregas + last login.

Recomendación: **T-AN2** S post-C2 y C5.

### G4 · Cost per consultora tracking
**Impacto: Medio · Esfuerzo: S (post-C2) · Riesgo: Bajo**

Descripción: para detectar consultoras con cost > revenue (Plan Pro USD
30 - cost IA real). Critical para sustainability.

Recomendación: combina con C2 ai_usage_log + view admin.

---

## H. Security hardening adicional

### H1 · pnpm audit en CI no bloqueante
**Impacto: Medio · Esfuerzo: S · Riesgo: Medio**

Descripción: `docs/operations/security.md` documenta `pnpm audit
--audit-level=high` corriendo en CI pero NO bloquea merge. HIGH/CRITICAL
findings pasan a main si CI verde por otros steps.

Recomendación: **T-SEC4** dependabot + pnpm audit ya activos. Cambiar
workflow `security.yml` a `continue-on-error: false` para CRITICAL.
HIGH puede quedar warn. S.

### H2 · HSTS preload submission pendiente
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: `next.config.ts` ya emite `Strict-Transport-Security:
max-age=63072000; includeSubDomains; preload`. Falta **submit a
hstspreload.org** para que Chrome/Firefox hardcodeen HSTS sin requerir el
header. Mitiga primer hit MITM (browser no conoce sitio).

Recomendación: **T-SEC5** verificar criterio Chromium (max-age 1 año +
includeSubDomains + preload + HTTPS-only) + submit. S.

### H3 · 2FA para owners
**Impacto: Medio · Esfuerzo: M · Riesgo: Medio**

Descripción: Supabase Auth soporta MFA TOTP nativo. NO activado. Owner
de tenant con 200 empleados pierde password → acceso completo. Plan
Team/Enterprise no se vende sin 2FA.

Recomendación: **T-SEC6** M. Setup Supabase MFA + UI en Settings →
Seguridad. Opt-in primero, mandatory para owners en Plan Team.

### H4 · Brute force / credential stuffing — solo rate limit
**Impacto: Medio · Esfuerzo: M · Riesgo: Medio**

Descripción: hoy 10 intentos login/15min por IP + 5/15min por email.
Atacante con botnet (1000 IPs) evade fácilmente. CAPTCHA tras 3 fails +
device fingerprint + risk scoring son extras.

Mitigación intermedia: agregar `hCaptcha` o Cloudflare Turnstile tras
2 fails por email. Free tier.

Recomendación: **T-SEC7** M. Solo cuando llegue 1er ataque o cliente
exija (auditoría ISO).

### H5 · Pentest external no ejecutado
**Impacto: Alto (latente) · Esfuerzo: XL (externo) · Riesgo: Alto**

Descripción: nunca se hizo pentest profesional. Bug surface tipo SSRF,
SQLi via raw queries en endpoints, file upload bypass, CSRF en webhooks,
XXE — no descartables sin auditoría profesional.

Recomendación: **T-SEC8** post-launch comercial + 5 clientes pagos.
Presupuesto USD 1500-3000 pentest puntual con boutique AR (algo como
Faraday/Caprihold). XL externo, S interno (preparar surface).

### H6 · Storage bucket policy no auditada en este pasada
**Impacto: Medio · Esfuerzo: S · Riesgo: Medio**

Descripción: análisis-completo.md sección 6.2 menciona "verificá que
buckets sean privados". No verifiqué en este audit. Si `consultora-logos`
es público y leakea URL, OK. Si `informe-attachments` es público con
signed URL leakeable, NO OK (DNI/CUIL en fotos).

Recomendación: **T-SEC9** auditar policies de los 3 buckets
(`consultora-logos`, `informe-attachments`, `epp-firmas`) + TTL signed
URL. S.

### H7 · Webhook MP firmas timing safe — confirmar uniformemente
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: lesson dice "MP signature verify ya usa `timingSafeEqual`
directo desde T-067 (puede refactorizarse al helper pero no urgente)".
Confirmar que sigue así post-CHORE-A. S verificación.

### H8 · CSP migración a nonce-based
**Impacto: Medio · Esfuerzo: L · Riesgo: Bajo**

Descripción: ya cubierto en B11. Cross-ref.

---

## I. Compliance legal AR

### I1 · Cron retención_datos_hasta NO existe
**Impacto: Alto · Esfuerzo: M · Riesgo: Alto**

Descripción: schema T-070 tiene `consultoras.retencion_datos_hasta` pero
el cron que dispara el borrado al alcanzar fecha NO existe. Ley 25.326
art. 4: "datos no deben conservarse más de lo necesario". Sin cron, vas a
violar en cuanto vencen las primeras retenciones (~30 días post-cancel).

Implementación: cron pg_cron daily + función `delete_expired_tenants()`
que itera `where retencion_datos_hasta < now()` + soft archive primero
(7 días) + hard delete después + audit_log entry "compliance: data
retention expired".

Recomendación: **T-CMP1** crítico pre-comercial. M.

Evidencia: `docs/analisis-completo.md` sección 6.2 + `supabase/migrations/
20260520000001_t070_pagos_schema.sql`.

### I2 · Endpoint export GDPR-like (art. 14 Ley 25.326)
**Impacto: Alto · Esfuerzo: M · Riesgo: Alto**

Descripción: art. 14 Ley 25.326: derecho de acceso. El user pide "dame
todos mis datos en formato exportable". Hoy NO hay endpoint. Si un user
lo solicita formal, hoy NO cumplís.

Implementación: endpoint `/api/account/export` autenticado que genera ZIP
con CSVs de todas las tablas del tenant + media (logo + attachments) +
audit_log + envia link signed URL TTL 48h al email del owner.

Recomendación: **T-CMP2** crítico pre-comercial. M.

### I3 · DNI + CUIL encrypt at-rest
**Impacto: Medio · Esfuerzo: M · Riesgo: Medio**

Descripción: hoy `empleados.dni` + `empleados.cuil` en claro. Supabase
encripta storage a nivel disco pero no columna. Para Ley 25.326 art. 9
(seguridad de datos sensibles) + auditoría ISO 27001 futura, encrypt
columna con `pgcrypto` `pgp_sym_encrypt(value, key)` es def-in-depth.

Trade-off: rompe `.ilike()` search sobre DNI digits-only (T-053 query
`searchEmpleadosByDni`). Mitigación: column tokenizada `dni_hash sha256`
para search + `dni_encrypted` para retrieval.

Recomendación: **T-CMP3** Fase 2 cuando llegue cliente que pida o
auditoría. M. NO urgente pre-launch.

Evidencia: `docs/analisis-completo.md` sección 6.2 compliance.

### I4 · Cookie banner / consentimiento
**Impacto: Bajo (AR) · Esfuerzo: S · Riesgo: Bajo**

Descripción: Ley 25.326 NO exige cookie banner explícito (a diferencia de
GDPR). Pero si vendés a cliente con cliente europeo / con compliance
extra, sumar banner es positivo.

Recomendación: **T-CMP4** opt-in cuando emerja demanda. S.

### I5 · DPO contact / privacy officer designado
**Impacto: Bajo · Esfuerzo: 0 · Riesgo: Bajo**

Descripción: ART 17 Ley 25.326 recomienda (no obliga aún) responsable de
datos. Para tenant que vende a empresa grande, exigible. Lautaro hoy es
implícito.

Recomendación: declarar formal en `/privacidad` con email `dpo@...`.
S documentación.

### I6 · Disclaimer profesional en PDFs
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: `CLAUDE.md` línea 91 declara "El matriculado revisa y firma
todo informe". Verificar que el PDF generado incluye este disclaimer
visible (no solo footer chico). Si no, agregar.

Recomendación: **T-CMP5** S audit PDF templates + add explicit footer
"Este informe es generado con asistencia de IA. La validación y firma
profesional corresponden al matriculado. ConsultoraDemo NO reemplaza
criterio profesional ni absuelve responsabilidad civil/penal (Ley
19.587)."

### I7 · ToS + Privacy review legal pre-comercial
**Impacto: Medio · Esfuerzo: M (externo) · Riesgo: Medio**

Descripción: `/privacidad` y `/terminos` están con `robots.index = false`
marcando "versión preliminar pre-revisión legal". Pre-comercial hay que
hacer la revisión + cambiar a `index = true`.

Recomendación: **T-CMP6** consulta abogado AR especializado (Marval +
Faerman / Brons & Salas — fees ~USD 500-1500 review único). M
calendario, S esfuerzo dev.

### I8 · Audit log inmutable + cumplimiento ISO 45001 7.5.3
**Impacto: Bajo (hoy) · Esfuerzo: S · Riesgo: Bajo**

Descripción: ya cubierto técnicamente. Falta página de docs públicas
"Cumplimiento técnico: cómo ConsultoraDemo soporta ISO 45001 cláusula
7.5.3 y 9.2.1". Diferenciador silencioso vs competencia.

Recomendación: **T-CMP7** S. Página `/cumplimiento` + screenshot del
audit log + link a ADR-0006.

Evidencia: `docs/analisis-completo.md` diferenciador #4.

---

## J. Negocio · pricing & expansion

### J1 · Plan anual con descuento
**Impacto: Medio · Esfuerzo: S · Riesgo: Bajo**

Descripción: Plan Pro USD 30/mes = USD 360/año. Plan anual USD 300 (17%
off) reduce churn + mejora cash flow. MP Subscriptions soporta `frequency
12 months`.

Recomendación: **T-PR1** S post-Pagos cerrado. Implementación 1 día.

### J2 · Add-ons (storage extra / generaciones IA extra)
**Impacto: Bajo · Esfuerzo: M · Riesgo: Bajo**

Descripción: Plan Pro 50 informes/mes hard cap (E4) + add-on USD 5 = +25
informes. Plan Pro Storage 1GB + add-on USD 5 = +5GB. Monetización
incremental.

Recomendación: **T-PR2** Fase 2.

### J3 · Plan Team USD 100 (Fase 2)
**Impacto: Alto · Esfuerzo: XL · Riesgo: Medio**

Descripción: D09 reservó pricing. Implementación:
- Roles finos (admin / consultor senior / junior / asistente)
- Asignación de visitas a técnicos
- Aprobación pre-firma
- Branding marca blanca (A16)
- API básica

Recomendación: ya en roadmap Fase 2. Mantener.

### J4 · Plan Enterprise USD 250 (Fase 4)
**Impacto: Alto · Esfuerzo: XL · Riesgo: Medio**

Descripción: D09 reservó. Multi-establecimiento + 7 módulos SGSST + API
pública + SLA. Lejos en roadmap.

Recomendación: ya en roadmap Fase 4. Mantener.

### J5 · Trial extension policy
**Impacto: Bajo · Esfuerzo: S · Riesgo: Bajo**

Descripción: hoy trial = 7 días hard. Sin policy para extension manual
("usuario pidió +7 días para evaluar"). Admin endpoint
`/internal/users/[id]/extend-trial` + audit_log.

Recomendación: **T-PR3** S quick win.

### J6 · Yearly pricing review (FX volatility AR)
**Impacto: Medio · Esfuerzo: S · Riesgo: Medio**

Descripción: `ARS_PRICE_MONTHLY` env var hardcoded. Lautaro lo ajusta
manualmente en EasyPanel cuando FX drift. Sin política, hay drift entre
USD 30 declarado y ARS cobrado real.

Recomendación: **T-PR4** S. Quincenal o mensual review FX BCRA + ajuste.
Sumar comment en var con fecha último update.

### J7 · Discount code system
**Impacto: Bajo-Medio · Esfuerzo: M · Riesgo: Bajo**

Descripción: para convenio AHRA (F5) + campaigns + cobertura. Tabla
`discount_codes` + apply en checkout MP.

Recomendación: **T-PR5** post-F5 negociación cerrada.

---

## Matriz priorización

### Quick wins (Alto impacto / Bajo esfuerzo) — Sprint operacional

- **A6** Tablas SRT al prompt IA (M, diferenciador 10x)
- **A17** Resumen semanal Telegram (S, retención)
- **C1** Health endpoint crones + Sentry alerts (M, defense forward)
- **C3** Sentry alert rules (S)
- **C4** Smoke runbook post-deploy (S)
- **E5** Prompt caching Anthropic (S, cost saving)
- **F6** Onboarding interactivo (S-M, churn-killer)
- **F7** Email bienvenida custom (S)
- **I1** Cron retención_datos_hasta (M, compliance)
- **I6** Disclaimer profesional PDF (S)
- **J5** Trial extension policy (S)

### Strategic bets (Alto impacto / Alto esfuerzo) — Sprint dedicado

- **A1** Trazabilidad EPP per-empleado completa (M, post Sprint 5)
- **A2** Chat IA contextual (L, diferenciador único AR)
- **A7** RGRL anual pre-llenado 80% (M, justifica Plan Pro)
- **A9** WhatsApp Business API (L, canal universal AR)
- **F1** Landing + /precios + /features completo (L, captación seria)
- **F3** Blog SEO HyS (L sustained)
- **F5** Convenio AHRA / colegio (M negociación, distribución)
- **G1** Funnel analytics PostHog (M, decisiones informadas)
- **I2** Endpoint export GDPR (M, compliance crítico)

### Backlog (Medio/Bajo impacto)

- A3 casi-accidente, A4 checklists, A5 OCR, A8 import CSV, A10 índices
  SRT, A11 IPER, A12 capacitaciones módulo, A13 exámenes médicos, A14
  CIIU, A15 establecimientos, A16 marca blanca, A18 incidentes
- B-series excepto B7, D-series, E2-E3-E6, F2-F4-F8, G2-G4, H1-H2-H6,
  I3-I4-I5, J1-J2-J3-J4-J6-J7

### NO recomendado / Hold

- **A14 Cronograma CIIU 53 obligaciones**: Could, mucho data entry para
  curar. Postergar hasta que un cliente lo pida explícitamente.
- **H5 Pentest external**: solo cuando llegue 5to cliente pago. Antes,
  ROI bajo.
- **J3 Plan Team / J4 Enterprise**: ya en roadmap Fase 2/4, no
  re-priorizar antes de tener tracción Plan Pro.
- **B11/H8 CSP nonce-based**: `rehype-sanitize` cubre XSS hoy.
  Migración costosa para risk reduction marginal.

---

## Roadmap propuesto post-launch (12 semanas)

> Premisas: EPP (Sprint 5 T-100..T-106) cierra antes de arrancar este
> roadmap. Asume ritmo de 1 dev + CC, sin deadline duro.

### Semana 1-2 · Defensa pre-comercial

- C1 Health endpoint crones + Sentry alerts (M)
- C3 Sentry alert rules (S)
- C4 Smoke runbook post-deploy general (S)
- I6 Disclaimer profesional PDF (S)
- E5 Prompt caching Anthropic (S)
- D2 Auto-run `pnpm db:types` post-merge (S)

### Semana 3-4 · Compliance crítico pre-comercial

- I1 Cron retención_datos_hasta (M)
- I2 Endpoint export GDPR (M)
- I7 ToS + Privacy review legal pre-comercial (M calendario, S dev)
- C7 Test DR cuatrimestral ejecutar (S discipline)

### Semana 5-6 · Onboarding + landing

- F6 Onboarding interactivo (M)
- F7 Email bienvenida custom (S)
- F1 Landing pública + /precios + /features (M)
- J5 Trial extension policy (S)

### Semana 7-8 · Diferenciador IA + retención

- A6 Tablas SRT al prompt (M)
- A17 Resumen semanal Telegram bot (S)
- A1 Trazabilidad EPP per-empleado completa (M post Sprint 5)
- C2 ai_usage_log + dashboard cost per tenant (M)

### Semana 9-10 · Analytics + métricas

- G1 Funnel PostHog (M)
- G3 Métricas uso por consultora (S post-C2)
- E4 Cost per consultora caps por plan (S post-C2)
- C5 Dashboard admin interno (M)

### Semana 11-12 · Generación IA avanzada

- A7 RGRL pre-llenado 80% (M post-A6)
- A8 Import CSV clientes/empleados (M)
- A3 Casi-accidente vs accidente real (M)
- B7 Cross-tenant defense audit pasada completa (M)

### Post-12 semanas · Strategic

- A9 WhatsApp Business API (L) — trigger 5 clientes pagos
- A2 Chat IA contextual (L) — post-Sprint 5 cerrado
- F3 Blog SEO sustained
- F5 Convenio AHRA — trigger 3 testimonios reales

---

Auditoría completa, ¿por dónde arrancamos?
