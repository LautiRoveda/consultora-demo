# 05 · Roadmap por fases

Cada fase entrega **algo usable y vendible**. Nada de fases de 6 meses sin producto. Todas las estimaciones son para un dev (vos + Claude Code) trabajando con foco part-time. Multiplicar por 2 si no hay foco.

## Fase 0 · Prototipo de validación ✅ COMPLETADO

**Objetivo:** validar interés, mostrar a expertos del rubro, recibir feedback cualitativo.

**Alcance:**
- HTML estático con 5 tipos de informe (ruido, iluminación, PAT, RGRL, carga de fuego)
- Prompt editable por tipo
- Modo demo (plantillas locales) + modo IA real (con API key del usuario)
- Branding "ConsultoraDemo" genérico
- Hospedado en Vercel free

**Entregables:**
- `index.html` — la app de un solo archivo
- Repo en GitHub
- URL pública de Vercel

**Tiempo:** 1 día.

**Resultado:** validado por experto del rubro, lista de features siguientes definida.

---

## Fase 1 · MVP con persistencia y kit de jornada

**Objetivo:** convertir la app en un producto cobrable básico. Persistir todo. Sumar la sexta feature crítica (kit de jornada por tarea).

**Alcance:**
- Migrar de HTML estático a Next.js 16 con App Router.
- Auth con Supabase (email + password + magic link).
- Multi-tenancy desde día cero (todas las tablas con `consultora_id`, RLS activo).
- Persistir `informes` generados con histórico por usuario.
- Lista de informes anteriores con filtros (cliente, tipo, fecha).
- Re-edición de informe en borrador, firma final que congela.
- Generación de PDF descargable con la marca de la consultora (logo configurable).
- **Sexto tipo: "Kit de jornada"** — input "trabajo en altura" + cantidad operarios → output paquete con charla, capacitación, checklists múltiples, permiso.
- Onboarding mínimo: alta de consultora + alta de cliente + alta de establecimiento.
- Plan único USD 30/mes con prueba gratis de 7 días o 5 informes.
- Cobro con Mercado Pago (suscripción recurrente).

**No incluido en esta fase:**
- Empleados ni EPP (Fase 2)
- PWA offline (Fase 3)
- Vencimientos de manuales (Fase 4)

**Entregables:**
- `app/` con rutas principales (`/login`, `/dashboard`, `/informes`, `/clientes`, `/perfil`)
- `app/api/` con endpoints de auth, informes, MP webhook
- Schema Postgres con migraciones versionadas
- README de onboarding técnico

**Tiempo:** 2-3 semanas con Claude Code.

**Resultado:** producto cobrable. Vendible al perfil A (freelancer multi-cliente).

**Métrica de éxito:** 5 consultoras pagando USD 30/mes en los primeros 60 días.

---

## Fase 2 · Gestión de empleados y entrega de EPP

**Objetivo:** sumar el feature más vendible (entrega de EPP con calendario y firma) y el módulo de gestión de empleados que lo soporta.

**Alcance:**
- CRUD de `empleados` por establecimiento (alta masiva con CSV o Excel).
- Catálogo de EPP: items, marcas, talles, lotes.
- Flujo de **entrega de EPP**:
  - Selección de empleado
  - Selección de items
  - Firma digital del empleado en pantalla del celular
  - Foto opcional de la entrega
  - Persistencia con timestamp + GPS
- **Calendario de vencimientos**: cada entrega se renueva a los 6 meses, alerta a los 7 días previos.
- **Detección de doble entrega**: warning si hay otra entrega del mismo empleado en menos de 5 meses.
- **Reporte mensual** del padrón con estado por empleado.
- **Generación de planilla Resolución 299/11** descargable como PDF firmable.
- **Sugerencia IA de EPP por puesto**: al crear empleado declarando puesto, la IA propone el kit estándar.

**Entregables:**
- Páginas `/empleados`, `/epp/entregar`, `/epp/agenda`, `/epp/reportes`
- API de búsqueda y filtros
- PDF generator de Res 299/11
- Sistema de notificaciones (email + push web)

**Tiempo:** 3-4 semanas.

**Resultado:** producto sólido para perfil B (consultora chica) y C (supervisor en obra).

**Métrica de éxito:** 20 consultoras pagando, NPS > 40 en encuesta de satisfacción.

---

## Fase 3 · PWA offline-first y permisos de trabajo

**Objetivo:** llevar la app al campo. Funciona sin internet. Sirve para el día a día en obra.

**Alcance:**
- Convertir app en PWA instalable (manifest + service worker).
- Cache de assets + rutas estáticas.
- IndexedDB para borradores y operaciones pendientes de sync.
- BackgroundSync API para enviar al server cuando reconecta.
- **Permisos de trabajo del día**:
  - Plantillas por tipo (altura, confinado, caliente, eléctrico)
  - Mediciones rápidas (viento, gas) integradas
  - Evaluación contra umbrales
  - Firma digital de todos los involucrados
  - GPS automático
  - Acta de no-habilitación si umbral excedido
- Captura de fotos desde la cámara para evidencia (incumplimientos, EPP entregado, etc.).
- Generación de capacitaciones cortas con IA (continuación del kit de jornada).
- Optimización mobile: navegación bottom nav, formularios cortos.

**Entregables:**
- PWA funcional probada en iOS Safari y Android Chrome (instalación, offline, sync)
- Páginas `/permisos`, `/permisos/nuevo`, `/permisos/[id]`
- Service worker custom con estrategia offline-first

**Tiempo:** 3-4 semanas.

**Resultado:** producto que el consultor usa parado en la planta.

**Métrica de éxito:** 50 consultoras activas, > 60% loguean al menos 5 días por semana.

---

## Fase 4 · Repositorio documental, capacitaciones y analytics

**Objetivo:** completar el producto con features de gestión y análisis. Subir el ARPU.

**Alcance:**
- **Repositorio documental** con upload, OCR (Claude vision o Google Cloud Vision), tags automáticos, búsqueda semántica con pgvector.
- **Vencimientos de manuales** con alertas configurables.
- **Q&A sobre manuales**: chat embebido para preguntar al manual del arnés su carga máxima.
- **Capacitaciones automáticas**: generador completo según industria + tema + duración. Material proyectable + handout + evaluación + lista de asistentes con firma.
- **Análisis de accidentabilidad**: carga de incidentes, cálculo de IF/IG/ID, ranking de riesgos, plan de mitigación jerárquico generado por IA.
- **Dashboard ejecutivo**: para perfil C (supervisor con 100 personas), con KPIs de cumplimiento del padrón, eventos del mes, próximos vencimientos.

**Entregables:**
- Páginas `/documentos`, `/capacitaciones`, `/incidentes`, `/dashboard`
- Pipeline de OCR + embeddings
- Pipeline de chat con RAG
- Sistema de KPIs

**Tiempo:** 4-5 semanas.

**Resultado:** producto que justifica precio de Plan Team y Enterprise.

**Métrica de éxito:** ARPU promedio > USD 60. Mix saludable 60% Pro / 30% Team / 10% Enterprise.

---

## Fase 5+ · Avanzadas (post-validación)

Features que solo tienen sentido cuando el producto ya está validado y monetizando:

### Asistente conversacional ("ChatHyS")
Chat con contexto multi-tenant sobre los datos del usuario y la normativa cargada. Permite acciones por lenguaje natural ("agéndame visita el martes", "muéstrame entregas pendientes esta semana").

### Visión computacional para auditorías
Subo foto de planta → IA detecta incumplimientos (sin EPP, mal estiba, etc.) y arma reporte preliminar.

### Integraciones
- Anemómetros y multigas con Bluetooth (lectura automática)
- Lector OCR de DNI argentino para alta rápida de empleados
- Importación desde sistemas ART (Asociart, Provincia ART, Federación Patronal)
- Exportación a contabilidad (Tango, Bejerman)

### Marketplace de checklists
Consultoras pueden compartir/comprar templates de checklists especializados.

### Whitelabel para consultoras grandes
Subdominios propios, personalización completa, plan Enterprise USD 500/mes.

### Internacionalización
Adaptación a normativa Chile (Mutual), México (STPS), Uruguay (BSE). Después de tracción local.

---

## Cronograma resumido

| Fase | Tiempo | Acumulado | Hito vendible |
|------|-------:|----------:|---------------|
| 0    | hecho  | hecho     | Demo para validar |
| 1    | 3 sem  | 3 sem     | Producto cobrable básico |
| 2    | 4 sem  | 7 sem     | Feature EPP (la más vendible) |
| 3    | 4 sem  | 11 sem    | Mobile + offline (paridad mercado) |
| 4    | 5 sem  | 16 sem    | Producto completo (Team/Enterprise) |

**Total para producto completo: ~16 semanas (4 meses) full-focus.** Realista part-time: 6-8 meses.

---

## Cómo iterar con Claude Code

Cada fase se rompe en tickets concretos, cada ticket → un PR. Workflow sugerido:

1. Abrís Claude Code en el repo `consultora-demo`.
2. Le decís "leé `CLAUDE.md` y `docs/05-roadmap.md`, vamos por la Fase 1".
3. Claude propone el primer ticket (ej: "migrar HTML estático a Next.js manteniendo el flujo actual").
4. Validás el plan, dice "dale", trabaja.
5. Reviewás el PR, mergeás, deploya solo a Vercel.
6. Próximo ticket.

**Nunca abrir 3 tickets en paralelo.** Más vale un ticket terminado por día que tres a medias.
