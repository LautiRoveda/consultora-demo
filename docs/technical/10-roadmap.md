# Technical 10 · Roadmap de implementación

Cómo construir el sistema, ticket por ticket, con dependencias claras. La idea: cada ticket es chico, autocontenido, y cuando termina deja el sistema en estado "verde y deployable".

## Filosofía de implementación

- **Construir el esqueleto antes que la carne.** Primero los módulos transversales (Auth, Tenancy, Auditoría, Notificaciones, Calendario), después la lógica de negocio. Sin un buen esqueleto, los módulos de negocio se pisan entre sí.
- **Ticket = PR.** Un ticket cierra cuando hay PR mergeada en main, con CI verde, código en producción.
- **Tickets pequeños.** 200-500 líneas de cambio promedio. Si pesa más, partir.
- **Deploy continuo.** Cada PR mergeada se deploya. Si el deploy falla, el revert es inmediato.
- **TDD donde aplica.** Para lógica de dominio (cálculos, generadores, validadores), escribir test primero. Para UI, no es obligatorio.

## Fase 1 · MVP cobrable (target: 6-8 semanas con foco)

### Sprint 0 · Setup del repo (semana 1, día 1-3)

Tickets base que dejan el repo listo para construir features.

- **T-001 · Inicializar Next.js 15 con TypeScript strict.**
  Crear el proyecto, configurar `tsconfig`, instalar Tailwind, configurar shadcn/ui CLI, primer commit.

- **T-002 · Configurar ESLint + Prettier + Husky + commit hooks.**
  Reglas de formato y linting. Pre-commit hook que corre `lint-staged`.

- **T-003 · Configurar Vitest y Playwright.**
  Setup de tests unitarios y E2E. Test "hello world" pasando.

- **T-004 · Configurar GitHub Actions CI.**
  Workflow que en cada PR corre typecheck + lint + test + build. Branch protection en main.

- **T-005 · Configurar Supabase local + remote.**
  Crear proyecto en Supabase, instalar Supabase CLI, primera migration vacía aplicada en remoto.

- **T-006 · Setup del cliente Supabase + helpers para Server Components.**
  `src/shared/supabase/server.ts`, `client.ts`, `middleware.ts`. Validación de env vars con Zod en `src/env.ts`.

- **T-007 · Configurar Sentry + estructura de logs.**
  Sentry inicializado en server y client. Logger custom con niveles y contexto.

- **T-008 · Configurar Tailwind y shadcn/ui base.**
  Theme oscuro tipo prototipo Fase 0. Primeros componentes (Button, Input, Form) instalados desde shadcn.

- **T-009 · Página landing minimalista + ruta `/login`.**
  Landing con propuesta de valor + CTA → /signup. Form de login y signup funcional pero sin lógica todavía.

- **T-010 · Configurar Vercel deploy desde main.**
  Cada merge en main triggea deploy. Variables de entorno cargadas. URL pública funcionando.

**Criterio de aceptación Sprint 0:** repo iniciado, CI verde, app en producción mostrando landing y formulario de login. Sin features funcionales todavía pero todo el plumbing listo.

---

### Sprint 1 · Auth + Tenancy + base multi-tenant (semana 1-2)

- **T-011 · Migration: Tenancy schema (consultoras, consultora_users).**
  Aplicar schema de M2 con RLS policies. Tipos generados.

- **T-012 · Módulo Auth: signup con creación de consultora.**
  El usuario se registra, se crea su consultora, queda logueado como admin. Email de bienvenida (con Resend).

- **T-013 · Módulo Auth: login + magic link.**
  Login email/password. Magic link como alternativa.

- **T-014 · Módulo Auth: logout + recuperación de contraseña.**

- **T-015 · Módulo Tenancy: getCurrentConsultora + helpers RLS.**
  Funciones helper para todas las queries posteriores.

- **T-016 · Custom claim `consultora_id` en JWT.**
  Auth Hook de Supabase que agrega el tenant_id al JWT al login.

- **T-017 · Layout autenticado `(app)` con guard.**
  Layout que verifica sesión, muestra navegación lateral, dropdown de usuario.

- **T-018 · Test E2E: signup → login → logout flow.**

**Criterio de aceptación Sprint 1:** un usuario puede registrarse creando su consultora, loguearse, ver una página vacía con su nombre, y desloguearse. Multi-tenancy garantizado por RLS, verificado con tests de integración.

---

### Sprint 2 · Auditoría + Notificaciones + Calendario (semana 2-3)

- **T-019 · Migration: audit_log + triggers append-only.**
- **T-020 · Módulo Auditoría: appendAuditEntry.**
- **T-021 · Migration: notification_templates, preferences, queue, telegram_links.**
- **T-022 · Módulo Notificaciones: dispatcher + adapter Email (Resend).**
- **T-023 · Módulo Notificaciones: adapter Telegram con onboarding del bot.**
  Crear bot en BotFather, webhook handler, flujo de vinculación con código.
- **T-024 · Migration: calendar_events.**
- **T-025 · Módulo Calendario: scheduleEvent + getUpcoming + getOverdue.**
- **T-026 · Cron job: alertas de eventos próximos.**
  pg_cron que cada hora detecta eventos con `fecha_alerta <= now()` pendientes y dispara notificaciones.
- **T-027 · UI: panel "Próximos vencimientos" en dashboard.**
- **T-028 · Tests integración: notificación end-to-end.**

**Criterio de aceptación Sprint 2:** un evento programado a 3 días dispara una notificación por email (y Telegram si vinculado). El usuario ve "vencimientos próximos" en su dashboard.

---

### Sprint 3 · Pagos + Plan Pro + trial (semana 3-4)

- **T-029 · Migration: subscriptions, invoices, ai_usage_log.**
- **T-030 · Módulo Pagos: definición de planes y guard de acceso.**
- **T-031 · Integración Mercado Pago: setup de credenciales.**
- **T-032 · Flujo de suscripción: usuario elige Plan Pro → MP checkout → webhook.**
- **T-033 · Webhook handler con validación de firma.**
- **T-034 · Trial automático al signup (7 días o 5 informes).**
- **T-035 · UI: página `/facturacion` con plan actual e historial.**
- **T-036 · Tests E2E: trial expira → bloqueo de acceso a features pagas.**

**Criterio de aceptación Sprint 3:** un usuario puede activar Plan Pro pagando con MP. El trial expira y se bloquea acceso. Facturación visible.

---

### Sprint 4 · Informes core (semana 4-5)

- **T-037 · Migration: norm_templates + informes.**
- **T-038 · Seed de norm_templates iniciales (5 normas vigentes).**
- **T-039 · Cliente IA abstracto en `src/shared/ai/client.ts`.**
  Wrapper sobre Anthropic SDK con caching, tracking de tokens, retry.
- **T-040 · Módulo Informes: generador de Ruido (Res 85/12).**
  Server Action que toma datos, llama a Claude, persiste informe.
- **T-041 · Módulo Informes: generador de Iluminación (Res 84/12).**
- **T-042 · Módulo Informes: generador de Puesta a Tierra.**
- **T-043 · Módulo Informes: generador de RGRL.**
- **T-044 · Módulo Informes: generador de Carga de Fuego.**
- **T-045 · UI: formulario dinámico por tipo de informe.**
  Inspirado en el prototipo Fase 0 pero adaptado a multi-tenant y persistencia.
- **T-046 · UI: editor de prompt con valor por defecto.**
- **T-047 · Comparación de versiones de norma (D06).**
  Server Action que recibe dos `norm_template_id` y devuelve diff con IA.
- **T-048 · Listado y detalle de informes.**
- **T-049 · Firmar informe + generar PDF con marca.**
  Integrar `@react-pdf/renderer` o equivalente.
- **T-050 · Auto-programar renovación a 12 meses al firmar.**
  El informe firmado dispara `Calendario.scheduleEvent`.

**Criterio de aceptación Sprint 4:** un usuario Pro puede generar los 5 tipos de informe, editar prompt, firmarlo, descargar PDF, ver el listado. La renovación queda agendada en el calendario.

---

### Sprint 5 · EPP core (semana 5-6)

- **T-051 · Migration: clientes, establecimientos, empleados, epp_items, epp_deliveries.**
- **T-052 · Seed de epp_items iniciales (catálogo común argentino).**
- **T-053 · Módulo EPP: CRUD de empleados + alta masiva por CSV.**
- **T-054 · UI: padrón de empleados por establecimiento.**
- **T-055 · Módulo EPP: registerDelivery + checkDuplicate.**
- **T-056 · UI: registro de entrega con firma digital en pantalla.**
  Captura de firma con canvas + storage en Supabase.
- **T-057 · Cálculo automático de `proxima_entrega_calc` y agendamiento.**
- **T-058 · Reporte mensual del padrón con estado por empleado.**
- **T-059 · Generación de planilla Resolución 299/11 PDF.**
- **T-060 · IA: sugerencia de EPP por puesto.**

**Criterio de aceptación Sprint 5:** un usuario puede dar de alta empleados, registrar entregas de EPP con firma, ver vencimientos próximos, exportar planilla 299/11.

---

### Sprint 6 · Checklists Lite + Incidentes (semana 6-7)

- **T-061 · Migration: checklist_templates, checklist_executions, incidents.**
- **T-062 · Módulo Checklists: CRUD de templates.**
- **T-063 · UI: editor de checklist (items, criterios, requeridos).**
- **T-064 · Módulo Checklists: ejecutar checklist con firma.**
- **T-065 · UI: ejecución de checklist en mobile (responsive).**
- **T-066 · Módulo Accidentabilidad: libro de incidentes simple (sin IA).**
- **T-067 · UI: alta/listado de incidentes.**

**Criterio de aceptación Sprint 6:** el usuario puede crear sus checklists, ejecutarlos firmados, registrar incidentes en un libro digital.

---

### Sprint 7 · Pulido y lanzamiento (semana 7-8)

- **T-068 · Branding personalizable del informe (logo, color).**
- **T-069 · Configuración de notificaciones por usuario (preferencias).**
- **T-070 · Páginas de error elegantes (404, 500, sesión expirada).**
- **T-071 · Onboarding interactivo en primer login.**
- **T-072 · Documentación pública de ayuda + FAQ.**
- **T-073 · Política de privacidad + términos de uso.**
- **T-074 · Tests E2E completos de los flujos críticos.**
- **T-075 · Auditoría de seguridad: revisar RLS policies con suite de tests.**
- **T-076 · Optimización Lighthouse > 90 en /, /login, /dashboard.**
- **T-077 · Tracking de usage por consultora (analytics interno).**
- **T-078 · Email de bienvenida + tour del producto.**

**Criterio de aceptación Fase 1:** producto completo, testeado, con docs, listo para vender. Primer cliente real puede arrancar.

---

## Fase 2 · Plan Team + coordinación de equipo (target: 4 semanas)

- Roles más finos (admin, consultor senior, consultor junior, asistente)
- Dashboard de coordinación: ver qué hizo cada técnico
- Asignación de visitas / informes a técnicos específicos
- Aprobación de informes antes de firma final
- Plan Team activable con upgrade desde Pro
- Branding por consultora más completo
- API básica para integraciones simples

## Fase 3 · PWA, permisos diarios, kit de jornada (target: 5 semanas)

- Convertir app en PWA instalable
- Service Worker con cache estratégico
- IndexedDB para datos offline
- BackgroundSync API para sync diferido
- Cámara nativa + GPS
- Módulo Permisos de Trabajo (altura, confinado, caliente, eléctrico)
- Módulo Catálogo de Tareas (kit de jornada inteligente)
- Captura de mediciones (viento con anemómetro)

## Fase 4 · Documentos + Capacitaciones + Accidentabilidad IA (target: 6 semanas)

- Módulo Documentos con OCR + búsqueda semántica con pgvector
- Q&A sobre manuales con RAG
- Módulo Capacitaciones con generador de material didáctico
- Módulo Accidentabilidad con análisis IA y jerarquía de controles
- Plan Enterprise activado con multi-establecimiento y API pública

## Fase 5+ · Avanzadas

- Asistente conversacional ("ChatHyS")
- Visión computacional para auditorías de planta
- Marketplace de checklists compartibles
- Integraciones (anemómetros Bluetooth, sistemas ART, contables)
- Whitelabel para consultoras grandes
- Internacionalización Chile / Uruguay / México

## Cómo trabajar con Claude Code

1. Abrir el repo en Claude Code.
2. Decir: *"Leé `CLAUDE.md` y los documentos en `docs/technical/`. Después arrancamos por T-001."*
3. Claude propone un plan para el ticket actual.
4. Validás, decís dale, Claude trabaja.
5. Reviewás el PR, mergeás, deploy automático.
6. Pasás al siguiente ticket.

Mantener disciplina: **un ticket por vez**. Más vale uno terminado por día que tres a medias.
