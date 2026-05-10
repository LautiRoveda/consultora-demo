# Technical 02 · Arquitectura modular

Define los 14 módulos del sistema, qué hace cada uno, qué expone, qué consume, y cómo se conectan. Es el plano maestro al que se va a referir cualquier decisión de implementación.

## Vista general

```
┌──────────────────────────────────────────────────────────────────┐
│ Cliente: PWA en navegador (Next.js 16, React, Tailwind)          │
│ Pantallas → Server Components + Server Actions                   │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│ Capa de aplicación (módulos de negocio)                          │
│                                                                   │
│  Capa transversal (todos consumen)                               │
│  ┌────────┐ ┌──────────┐ ┌───────────┐ ┌───────────────┐         │
│  │  Auth  │ │ Tenancy  │ │ Auditoría │ │ Notificaciones│         │
│  └────────┘ └──────────┘ └───────────┘ └───────────────┘         │
│                                                                   │
│  Capa de coordinación                                            │
│  ┌────────────┐                                                  │
│  │ Calendario │ ← cruza vencimientos de todos los módulos        │
│  └────────────┘                                                  │
│                                                                   │
│  Capa de negocio (independientes entre sí salvo por contratos)   │
│  ┌──────────┐ ┌─────┐ ┌─────────────┐ ┌─────────────────┐        │
│  │ Informes │ │ EPP │ │ Checklists  │ │ Catalogo Tareas │        │
│  └──────────┘ └─────┘ └─────────────┘ └─────────────────┘        │
│  ┌──────────────────┐ ┌──────────────────┐ ┌────────────┐        │
│  │ Accidentabilidad │ │ Permisos Trabajo │ │ Documentos │        │
│  └──────────────────┘ └──────────────────┘ └────────────┘        │
│  ┌────────────────┐ ┌───────┐                                    │
│  │ Capacitaciones │ │ Pagos │                                    │
│  └────────────────┘ └───────┘                                    │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│ Infraestructura (compartida)                                     │
│  Supabase (Postgres + Auth + Storage)                            │
│  Anthropic Claude API · Resend · Telegram Bot · Mercado Pago    │
│  Vercel · Sentry                                                 │
└──────────────────────────────────────────────────────────────────┘
```

## Reglas de dependencias entre módulos

1. Los módulos de la **capa transversal** no dependen de ningún otro módulo de negocio. Solo de infraestructura.
2. La **capa de coordinación** (Calendario) puede consumir todos los demás módulos.
3. Los módulos de **negocio** consumen únicamente la capa transversal y, eventualmente, otros módulos de negocio que estén listados como dependencia explícita.
4. Ningún módulo de capa transversal o coordinación puede importar de un módulo de negocio.
5. El cliente (UI) no llama directo a la capa de negocio — siempre pasa por Server Actions del módulo correspondiente.

Las violaciones a estas reglas son detectables con tests de arquitectura (ej: `dependency-cruiser`) que vamos a configurar en CI.

## Catálogo de módulos

### M1 · Auth

**Responsabilidad:** autenticación de usuarios. Login, logout, magic link, recuperación de contraseña, sesión activa.

**Dependencias:** Supabase Auth.

**API pública (`src/modules/auth/index.ts`):**
- `login(email, password)`
- `loginWithMagicLink(email)`
- `logout()`
- `getCurrentUser()`
- `getCurrentSession()`
- `requireAuth()` — middleware-helper que tira si no hay sesión

**Tablas propias:** ninguna (usa `auth.users` de Supabase).

**Disponible en:** Fase 1.

---

### M2 · Tenancy

**Responsabilidad:** multi-tenancy. Una consultora es la unidad de tenant. Maneja alta de consultora, rol del usuario dentro de la consultora, invitación de usuarios al equipo.

**Dependencias:** Auth.

**API pública:**
- `createConsultora(input)` — alta inicial al registrarse
- `getCurrentConsultora()` — la consultora del usuario logueado
- `inviteUser(email, rol)` — solo admin puede
- `getMembers()` — listado de usuarios de la consultora
- `requireRol(rol)` — helper para action que requiere rol específico

**Tablas propias:**
- `consultoras` (id, nombre, cuit, plan, mp_subscription_id, created_at)
- `consultora_users` (consultora_id, user_id, rol, invited_by, joined_at)

**RLS:** las tablas filtran por membresía a la consultora.

**Disponible en:** Fase 1.

---

### M3 · Auditoría

**Responsabilidad:** registrar acciones sensibles del sistema en un log inmutable. Útil para defensa legal del consultor (Decisión D04: pitch principal es resguardo legal).

**Dependencias:** Tenancy (para asociar a consultora).

**API pública:**
- `appendAuditEntry(input)` — registra una entrada
- `queryAuditLog(filtros)` — solo admin de consultora puede leer

**Tablas propias:**
- `audit_log` (id, consultora_id, user_id, accion, entidad_tipo, entidad_id, datos_json, ip, user_agent, created_at) — append-only, sin update/delete

**Disponible en:** Fase 1.

**Patrones especiales:**
- Append-only enforced por trigger Postgres
- Particionado por mes a partir del primer millón de registros

---

### M4 · Notificaciones

**Responsabilidad:** enviar notificaciones al usuario por uno o varios canales. Email (Resend), push web, Telegram, SMS (futuro). El llamador no elige el canal — manda un evento, el módulo decide según preferencias del usuario.

**Dependencias:** Auth, Tenancy.

**API pública:**
- `send(eventType, userId, data)` — dispara una notificación
- `schedule(eventType, userId, data, scheduledAt)` — agenda para el futuro
- `cancelScheduled(notificationId)`
- `getPreferences(userId)`
- `updatePreferences(userId, preferences)`

**Tablas propias:**
- `notification_templates` (id, event_type, channel, subject_template, body_template)
- `notification_preferences` (user_id, event_type, channels[])
- `notifications_queue` (id, user_id, event_type, data, scheduled_at, sent_at, status, error)
- `telegram_links` (user_id, telegram_chat_id, linked_at)

**Adapters internos** (uno por canal, en `infrastructure/adapters/`):
- Email (Resend)
- Push web (Web Push API + Service Worker)
- Telegram (Bot API)
- SMS (placeholder — Twilio o similar para Enterprise)

**Disponible en:** Fase 1 (email + Telegram). Push web Fase 1.5.

---

### M5 · Calendario

**Responsabilidad:** unifica los vencimientos de todos los módulos de negocio. Cuando se firma un informe, programa renovación. Cuando se entrega EPP, programa próxima entrega. Genera el dashboard de "próximos vencimientos" cruzando todo.

**Dependencias:** todos los módulos de negocio.

**API pública:**
- `scheduleEvent(input)` — registra un vencimiento futuro
- `cancelEvent(eventId)`
- `getUpcoming(filters)` — lo que vence en los próximos N días
- `getOverdue(filters)` — lo ya vencido sin atender
- `markAttended(eventId)` — marca como atendido sin completar
- `complete(eventId, completionData)` — marca como completado con datos

**Tablas propias:**
- `calendar_events` (id, consultora_id, tipo, entidad_origen_modulo, entidad_origen_id, fecha_vencimiento, fecha_alerta, estado, completed_at, completed_by)

**Job programado:** cada hora, recorrer eventos próximos a vencer y disparar `Notificaciones.send`.

**Disponible en:** Fase 1.

---

### M6 · Informes

**Responsabilidad:** generar, persistir, firmar y exportar informes técnicos protocolarios. Pilar 1 del producto (D08).

**Dependencias:** Auth, Tenancy, Auditoría, Calendario, Notificaciones.

**Tipos soportados en Fase 1:**
- Ruido (Res SRT 85/12)
- Iluminación (Res SRT 84/12)
- Puesta a Tierra (AEA 90364)
- RGRL (Res SRT 463/09)
- Carga de Fuego (Dec 351/79 + IRAM 11949)

**API pública:**
- `generateReport(input)` — genera con IA, persiste en estado borrador
- `signReport(reportId)` — el profesional firma, congela
- `getReports(filters)`
- `getReportById(id)`
- `exportPDF(reportId)` — genera PDF con marca de la consultora
- `compareNormVersions(normCode, version1, version2)` — D06: compara dos versiones de norma con IA

**Tablas propias:**
- `informes` (id, consultora_id, cliente_id, tipo, version_norma_id, datos_input_json, prompt_usado, contenido_html, profesional_id, estado, firmado_at, pdf_url)
- `norm_templates` (id, codigo, nombre, version, vigencia_desde, vigencia_hasta, prompt_template, marco_normativo)

**Patrones especiales:**
- Cliente IA abstracto (`src/shared/ai/`) con caching y tracking
- Versionado de normas (D05): cada `informe` referencia un `norm_template`. Cuando una norma cambia, se crea un nuevo template; el viejo queda. El consultor puede elegir cuál usar.
- Generación de PDF server-side con `@react-pdf/renderer`

**Disponible en:** Fase 1.

---

### M7 · EPP

**Responsabilidad:** padrón de empleados, catálogo de EPP, registro de entregas con firma digital, alertas a 6 meses, planilla Resolución 299/11. Pilar 2 (D08).

**Dependencias:** Auth, Tenancy, Auditoría, Calendario, Notificaciones.

**API pública:**
- `getEmpleados(filters)`
- `createEmpleado(input)`
- `updateEmpleado(id, input)`
- `archiveEmpleado(id)`
- `getEPPCatalog()` — items disponibles
- `registerDelivery(input)` — registra entrega con firma
- `getDeliveriesByEmpleado(empleadoId)`
- `checkDuplicateDelivery(empleadoId, items)` — D08: warning si hay otra reciente
- `exportRes299Form(deliveryId)` — PDF firmable conforme normativa
- `suggestEPPForPosition(puesto)` — IA propone kit estándar según puesto

**Tablas propias:**
- `empleados` (id, consultora_id, establecimiento_id, nombre, dni, cuil, puesto, talles_json, foto_url, fecha_ingreso)
- `epp_items` (id, codigo, nombre, marca, talles_disponibles, vida_util_meses, norma_iram)
- `epp_deliveries` (id, consultora_id, empleado_id, fecha, items_json, firma_url, foto_entrega_url, gps, proxima_entrega, registered_by)

**Disponible en:** Fase 1.

---

### M8 · Checklists

**Responsabilidad:** checklists firmables digitalizados. Versión Lite — el consultor crea sus propios checklists y los aplica en visitas.

**Dependencias:** Auth, Tenancy, Auditoría.

**API pública:**
- `getChecklistTemplates()`
- `createChecklistTemplate(input)`
- `updateChecklistTemplate(id, input)`
- `executeChecklist(templateId, contextData)`
- `signExecution(executionId)`

**Tablas propias:**
- `checklist_templates` (id, consultora_id, nombre, descripcion, items_json, tipo_tarea, tipo_equipo)
- `checklist_executions` (id, consultora_id, template_id, ejecutado_por, contexto_json, respuestas_json, firmado_at, gps)

**Disponible en:** Fase 1 (versión Lite — sin catálogo inteligente, eso va en Catálogo de Tareas).

---

### M9 · Catálogo de Tareas

**Responsabilidad:** mapeo de "tipo de obra/tarea" → "checklists relevantes + capacitaciones + permisos". El feature que pidió el experto ("decime obras viales y mostrame todo lo que necesito").

**Dependencias:** Checklists, Capacitaciones, Permisos.

**API pública:**
- `getTaskCatalog()` — listado de tipos de tarea pre-cargados
- `getRecommendationsForTask(taskType, context)` — devuelve checklists, capacitaciones y permisos sugeridos

**Tablas propias:**
- `task_catalog` (id, slug, nombre, descripcion, industria_aplicable[])
- `task_recommendations` (task_id, tipo_recomendacion, target_id, prioridad)

**Disponible en:** Fase 3.

---

### M10 · Accidentabilidad

**Responsabilidad:** registro de incidentes, cálculo de índices (IF, IG, ID), análisis con IA y propuesta de jerarquía de controles.

**Dependencias:** Auth, Tenancy, Auditoría, Checklists (para sugerir checklist como control).

**API pública:**
- `registerIncident(input)` — registra incidente
- `getIncidents(filters)`
- `calculateIndices(consultora_id, periodo)` — IF, IG, ID
- `analyzeRisks(consultora_id)` — IA propone jerarquía de controles

**Tablas propias:**
- `incidents` (id, consultora_id, establecimiento_id, fecha, gravedad, dias_perdidos, causa_raiz, empleado_id, descripcion)
- `risk_analyses` (id, consultora_id, fecha, indices_json, jerarquia_propuesta, generada_por_ia)

**Disponible en:** Fase 4 (necesita data acumulada).
**En Fase 1:** solo `registerIncident` y `getIncidents` (libro digital simple). El análisis IA viene después.

---

### M11 · Permisos de Trabajo

**Responsabilidad:** permisos diarios firmables (altura, confinado, caliente, eléctrico). Captura de mediciones (viento con anemómetro, gases con multigás), evaluación contra umbrales, firma digital en obra.

**Dependencias:** Auth, Tenancy, Auditoría, Checklists.

**API pública:**
- `createPermit(input)`
- `signPermit(permitId, signature)`
- `closePermit(permitId, outcome)`

**Tablas propias:**
- `work_permits` (id, consultora_id, establecimiento_id, fecha, tipo, mediciones_json, empleados_ids, firmas_json, gps, habilitado, completed_at)

**Disponible en:** Fase 3 (requiere PWA offline para uso en obra).

---

### M12 · Documentos

**Responsabilidad:** repositorio de manuales, certificados, planos. OCR, búsqueda semántica, alertas de vencimiento de revisión.

**Dependencias:** Auth, Tenancy, Auditoría, Calendario.

**API pública:**
- `uploadDocument(input)` — file + metadata
- `searchDocuments(query)` — búsqueda semántica
- `askDocument(docId, question)` — Q&A sobre manual
- `getExpiringDocs()` — los que vencen pronto

**Tablas propias:**
- `documents` (id, consultora_id, tipo, titulo, equipo_asociado, archivo_url, fecha_emision, periodicidad_dias, ocr_text, embedding)

**Disponible en:** Fase 4.

---

### M13 · Capacitaciones

**Responsabilidad:** generador de material didáctico con IA, registro de capacitaciones dictadas, certificados con firma de asistentes.

**Dependencias:** Auth, Tenancy, Auditoría, Calendario.

**API pública:**
- `generateTrainingMaterial(input)` — IA produce material según industria + tema
- `recordTraining(input)` — registra capacitación dictada con asistentes
- `getCertificate(trainingId, empleadoId)`

**Tablas propias:**
- `training_materials` (id, consultora_id, tema, industria, contenido_json, generado_por_ia)
- `training_sessions` (id, consultora_id, establecimiento_id, fecha, tema, duracion_min, material_id, asistentes_json)

**Disponible en:** Fase 4.

---

### M14 · Pagos

**Responsabilidad:** integración con Mercado Pago. Suscripciones recurrentes, gestión de plan, recibos, downgrades/upgrades, dunning.

**Dependencias:** Auth, Tenancy, Auditoría, Notificaciones.

**API pública:**
- `subscribeToPlan(planCode)` — inicia suscripción MP
- `cancelSubscription()`
- `upgradePlan(newPlan)`
- `getPlanInfo()`
- `getInvoices()`

**Tablas propias:**
- `subscriptions` (id, consultora_id, plan_code, status, mp_subscription_id, current_period_start, current_period_end, cancel_at)
- `invoices` (id, consultora_id, subscription_id, amount, currency, status, mp_payment_id, receipt_url)

**Webhooks:** `/api/webhooks/mercadopago` valida firma, actualiza estado.

**Disponible en:** Fase 1.

## Diagrama de dependencias

```
Auth ← Tenancy ← Auditoría ← Notificaciones
                     ↑
                     │
   ┌─────────────────┼──────────────────┐
   │ Calendario consume todos los demás │
   └─────────────────┼──────────────────┘
                     │
       ┌─────────────┼──────────────┐
       │             │              │
   Informes    EPP            Checklists
       │             │              │
       │             │         Catálogo de
       │             │         Tareas
       │             │              │
       │       Capacitaciones       │
       │             │              │
   Documentos  Accidentabilidad  Permisos
                     │              │
                     └──────┬───────┘
                            │
                          Pagos
```

## Flujo end-to-end de ejemplo

**Caso: el consultor genera un informe de ruido y se programa la próxima medición.**

1. Cliente carga el formulario en `/informes/nuevo` (Server Component).
2. Submit ejecuta `informes.generateReport(input)` (Server Action).
3. Server Action verifica auth → llama a `Auth.requireAuth()`.
4. Verifica plan y rate limit → llama a `Pagos.getPlanInfo()` y a un counter local.
5. Construye prompt con `norm_templates` correspondiente (versión elegida o última vigente).
6. Llama a `aiClient.generateWithClaude()` que loggea uso a `Pagos.trackUsage()`.
7. Persiste en `informes` con estado `borrador`.
8. Programa renovación a 12 meses → `Calendario.scheduleEvent({ tipo: 'informe_ruido_renovacion', ... })`.
9. Registra en audit log → `Auditoría.appendAuditEntry({ accion: 'informe.generar', ... })`.
10. Retorna informe al cliente.
11. Cliente muestra informe, consultor firma → `informes.signReport()`.
12. Generar PDF → `informes.exportPDF()`.

Cada paso usa la API pública del módulo correspondiente, no toca tablas ajenas, no salta capas.

## Cómo se reemplaza un módulo entero

Ejemplo: queremos cambiar Resend por Postmark para emails.

1. Crear nuevo adapter `postmark-adapter.ts` en `notificaciones/infrastructure/adapters/`.
2. Cambiar la línea en `notificaciones/infrastructure/dispatcher.ts` que registra el adapter por defecto para email.
3. Actualizar tests del módulo.
4. Tocar cero archivos fuera de `src/modules/notificaciones/`.

Esa es la prueba de modularidad. Si tocás archivos fuera, hay deuda de arquitectura.
