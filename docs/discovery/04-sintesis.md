# Discovery 04 · Síntesis · requerimientos, propuesta de valor y modelo de negocio

Documento de cierre del discovery. Acá se cocinan en una sola receta los aprendizajes de los tres documentos anteriores: el mercado nos dijo que hay tracción y precio sweet spot (USD 30-60), las personas nos dijeron qué jobs-to-be-done atacar primero, la competencia nos dijo dónde está el hueco. Ahora cerramos qué construir, cómo venderlo y cómo medir si funciona.

## Propuesta de valor

**Frase única:**
> *"El asistente argentino que escribe tus informes con IA y nunca te deja olvidar un vencimiento. Para consultores HyS por USD 30 al mes."*

**Tres pilares de venta visibles desde la home:**

1. **Informes en 5 minutos.** Lo que hoy te lleva 2-4 horas en Excel + Word, con normativa argentina actualizada y tu firma profesional al pie.
2. **Cero multas por olvido.** Calendario que te avisa antes — entrega de EPP a los 5 meses, protocolos anuales con 30 días de aviso, calibraciones, capacitaciones.
3. **Pricing claro, sin comerciales.** USD 30 por mes. Probás 7 días gratis. Cancelás cuando quieras.

**Por qué cada pilar está blindado por evidencia del discovery:**

- *Informes en 5 minutos* — la entrevista al experto reconoció textualmente "es una paja, especialmente si estás en campo". Los datos de mercado muestran USD 11/h hora-técnico, lo cual valida que ahorrar 2 horas semanales paga la suscripción ocho veces.
- *Cero multas* — la litigiosidad del sistema (132,8 juicios cada 10.000 trabajadores en 2025) y el dolor recurrente del experto ("se te pasa de los 6 meses, te cabe la multa") convierten el resguardo legal en argumento más fuerte que productividad.
- *Pricing claro* — ningún competidor publica precios. Hacerlo es ventaja de funnel desde el día uno.

## Requerimientos priorizados (MoSCoW para Fase 1)

### MUST HAVE — Fase 1 (sin esto no se lanza)

**Pilar 1 — Generación de informes:**
- Cinco tipos de informe vigentes: Ruido (SRT 85/12), Iluminación (SRT 84/12), Puesta a Tierra, RGRL, Carga de Fuego.
- Datos cargables: empresa, profesional firmante, instrumental, tabla de mediciones por punto.
- Prompt editable por tipo, con plantilla por defecto.
- Modo demo (plantillas locales) y modo IA real (Claude API desde backend).
- **Versionado de normas con elección libre** (decisión D05). Cada informe queda guardado con la versión usada y su fecha de vigencia.
- **Comparación de versiones de norma con IA** (decisión D06).
- Persistir informes con histórico por consultora y cliente.
- Exportar PDF firmable con marca de la consultora (logo configurable).
- Auditoría defensible básica: timestamp, usuario que firmó, versión de norma, datos crudos cargados.

**Pilar 2 — Calendario de vencimientos:**
- Padrón básico de empleados (alta manual, alta masiva por CSV, edición).
- Catálogo de EPP (items, marcas, talles).
- Registro de entrega de EPP con firma digital del empleado en pantalla.
- Cálculo automático de próxima entrega obligatoria a 6 meses (Resolución SRT 299/11).
- Alerta automática a los 5 meses (configurable: 30/60/90 días antes).
- Dashboard general "próximos vencimientos" con filtros por cliente, empleado, tipo.
- Detección y warning de doble entrega (si el último registro es de hace menos de 5 meses).
- Cuando se firma un protocolo anual, programación automática de renovación a 12 meses.
- Generación de planilla Resolución 299/11 descargable como PDF.

**Multi-tenancy y seguridad:**
- Auth con Supabase (email + password + magic link).
- Cada consultora aislada por Row Level Security desde día uno.
- Roles básicos: admin de consultora, consultor.

**Pagos y trial:**
- Trial de 7 días sin tarjeta o 5 informes gratis (lo que termine primero).
- Plan Pro USD 30/mes con cobro Mercado Pago en pesos.
- Posibilidad de cancelar en cualquier momento.

**Notificaciones:**
- Email de alerta de vencimientos próximos.
- Notificación push web (opt-in del browser).

### SHOULD HAVE — Fase 1.5 (si entra al alcance, mejor)

- Catálogo de clientes con CUIT, contacto, industria, ART.
- Catálogo de establecimientos por cliente.
- Asociar informes a establecimientos específicos.
- Branding del informe personalizable (logo, color, datos del firmante).
- Plan anual con 2 meses gratis (incentivo para reducir churn).
- Recordatorios para calibración de instrumental (telurómetro, sonómetro, luxómetro, anemómetro).
- Recordatorios para capacitaciones obligatorias periódicas.

### COULD HAVE — Fase 2+ (postergables)

- Permisos de trabajo diarios firmables (Fase 3).
- Kit de jornada por tipo de tarea (Fase 3).
- Repositorio documental con OCR y búsqueda semántica.
- Capacitaciones automáticas adaptadas por industria.
- Análisis de accidentabilidad con IA.
- Plan Team con dashboard de coordinación entre técnicos.
- PWA offline-first y captura desde cámara con GPS.

### WON'T HAVE — fuera de alcance por ahora

- Visión computacional sobre fotos de planta.
- Asistente conversacional sobre normativa.
- App nativa iOS/Android.
- Marketplace de checklists compartibles.
- Internacionalización (Chile, México, Uruguay).
- Integración Bluetooth con anemómetros y multigás.
- Importación desde sistemas ART externos.

## Requerimientos no funcionales

- **Disponibilidad:** 99% mensual (38 minutos máximo de caída por mes). No 99.9 — somos startup, no Fortune 500.
- **Performance:** primer contenido visible < 2 segundos en mobile 4G. Generar informe < 30 segundos extremo a extremo.
- **Seguridad:** auth con cookies httpOnly, datos cifrados en reposo (Supabase nativo), API keys de IA solo en servidor, audit log de acciones sensibles.
- **Privacidad / cumplimiento Ley 25.326 (Argentina):** datos personales (CUIL, DNI, foto, firma) tratados como sensibles. Política de privacidad clara, derecho de eliminación, consentimiento explícito al alta del empleado.
- **Backup:** point-in-time recovery automático (Supabase Pro lo da out-of-the-box).
- **Multi-dispositivo:** funciona en Chrome, Safari, Edge, Firefox actuales. Mobile (iOS Safari + Android Chrome) sin features faltantes.
- **Idioma:** español de Argentina exclusivamente.
- **Soporte:** email + chat asincrónico durante horario laboral GMT-3, sin SLA garantizado en Plan Pro, SLA 4h en Team, 1h en Enterprise.

## Modelo de pricing definitivo

### Plan Free Trial (gancho)
- 7 días o 5 informes generados, lo primero que termine.
- Sin tarjeta de crédito requerida.
- Acceso completo al Plan Pro.
- Email automático al día 5 con propuesta de continuar.

### Plan Pro — USD 30/mes
- 1 consultora, 1 usuario.
- Informes ilimitados con IA.
- Empleados ilimitados con tracking de EPP.
- Calendario de vencimientos completo.
- Notificaciones push y email.
- Versionado de normas con comparación IA.
- Soporte por email (sin SLA).
- Pago mensual o anual (con 2 meses gratis al elegir anual).
- Apunta a Marina (Persona A — freelancer multi-cliente).

### Plan Team — USD 100/mes
- Todo lo del Pro.
- Hasta 5 usuarios bajo la misma consultora.
- Dashboard de coordinación: ver qué hizo cada técnico, asignar visitas, revisar informes antes de firmar.
- Branding personalizado en informes (logo, color).
- Soporte SLA 4 horas hábiles.
- Apunta a Diego (Persona B — dueño de consultora chica).
- Disponible desde Fase 2.

### Plan Enterprise — USD 250/mes
- Todo lo del Team.
- Hasta 15 usuarios.
- Multi-establecimiento (cada cliente puede tener varios establecimientos manejados separadamente).
- API para integraciones (con sistemas ART o contables).
- Soporte SLA 1 hora hábil + onboarding personalizado.
- Apunta a Sergio's company (Persona C — supervisor en obra grande, jefe de seguridad).
- Disponible desde Fase 4.

### Cobros
- Mercado Pago en pesos argentinos al tipo de cambio del día (referencia BCRA).
- Tarjeta de crédito o débito.
- Suscripción recurrente automática.
- Cancelación auto-servicio sin contactar comercial.
- Recibo automático en PDF con CUIT del cliente para descarga.

### Métricas de unit economics esperadas

| Concepto | Pro | Team | Enterprise |
|----------|-----|------|------------|
| Precio | USD 30 | USD 100 | USD 250 |
| Costo IA estimado | USD 8-12 | USD 20-40 | USD 50-100 |
| Costo infraestructura | USD 1-2 | USD 3-5 | USD 8-15 |
| Costo MP fees (~3%) | USD 1 | USD 3 | USD 7 |
| **Margen bruto** | **USD 15-20 (50-67%)** | **USD 52-74 (52-74%)** | **USD 128-185 (51-74%)** |

Margen bruto saludable en los tres planes. El driver principal de costo es la IA — cuanto más informes genera el usuario, más alto el costo. Hay que monitorear con métricas de tokens consumidos por cuenta.

## Estrategia de go-to-market — primeros 5 clientes pagos

### Objetivo
Conseguir las primeras 5 cuentas Pro pagas (USD 150 MRR) en 60 días desde lanzamiento de Fase 1. Con esto validamos que el producto se vende, no solo que tiene interés.

### Canales priorizados

**Canal 1 — Demo personal a red existente (esfuerzo manual)**
El experto del audio + Lautaro pueden mostrar el producto a 10-15 consultores conocidos. Demo de 30 minutos, propuesta de plan beta: 3 meses gratis a cambio de uso real + feedback estructurado.
- Esperado: 3-5 betas activos, de los cuales 2-3 convierten a Pro pago al mes 3.
- Costo: $0, solo tiempo.
- Ventaja: feedback de alta calidad para iterar.

**Canal 2 — Grupos de WhatsApp del rubro**
Argentina tiene grupos WhatsApp activos de profesionales HyS organizados informalmente y por colegio profesional (CPHySA, COPIME, CPHST de cada provincia).
- Posts honestos: caso real con foto/video, "estoy resolviendo X problema, ¿les sirve?", link al landing.
- Esperado: 30-100 visitas a landing por post, 2-5 trials, 1-2 conversiones a pago.
- Costo: $0.

**Canal 3 — LinkedIn personal**
Lautaro publicando 1 post semanal en LinkedIn sobre el journey de hacer la app: descubrimientos, decisiones de producto, problemas técnicos resueltos, validación con consultores.
- No es venta directa: es construcción de marca personal y autoridad.
- Capta especialmente a Diego (dueño de consultora) que está en LinkedIn.
- Esperado: 5-10 mensajes directos en 60 días, 1-2 conversiones a Team.
- Costo: $0.

**Canal 4 — Newsletter de colegios profesionales**
COPIME y CPHySA tienen newsletters mensuales que llegan a sus matriculados. Pagar una publicación auspiciada o sponsoring del evento mensual.
- Esperado: 50-200 visitas a landing, 5-15 trials, 2-4 conversiones.
- Costo: USD 100-500 por publicación.

**Canal 5 — Programa de referidos**
Activarlo desde el día uno. *"Referís un consultor que paga 3 meses, vos tenés el cuarto gratis."*
- Apalanca el boca a boca natural del rubro.
- Costo: 25% del trimestre del referido.

### NO usar en los primeros 60 días
- Ads pagos (Google, Meta) — caro y mal ROI hasta tener producto validado.
- Cold outreach masivo — quema la marca.
- Fairs/eventos grandes — caro y de alto compromiso de tiempo.

### Mensaje por canal

| Canal | Mensaje |
|-------|---------|
| Demo personal | "Mirá, te muestro 5 minutos cómo te genera el informe de ruido. Probalo gratis 90 días, me das feedback, y si te sirve seguís pagando USD 30." |
| WhatsApp profesional | Caso concreto + demo en video + link. Sin venta dura. |
| LinkedIn | Storytelling honesto de problemas y soluciones. Posicionamiento de Lautaro como builder. |
| Newsletter colegio | Mensaje formal: "Software argentino para consultores HyS, primer mes gratis." |
| Referidos | "Si te sirve, contale a tu colega: el cuarto mes lo pagás vos pero gratis." |

## Métricas de validación

### A 60 días después del lanzamiento Fase 1

| Métrica | Meta de éxito | Indicador de fracaso |
|---------|---------------|----------------------|
| Cuentas Pro pagas | 5 (USD 150 MRR) | < 2 |
| Conversion trial → Pro | 50% | < 25% |
| NPS | > 30 | < 0 |
| Churn mensual | < 10% | > 25% |
| Informes generados / mes | 100+ | < 30 |
| Tiempo medio del consultor en generar un informe | < 10 min | > 25 min |

Acción si fracaso: revisar producto + entrevistar a usuarios trial que no convirtieron.

### A 90 días

| Métrica | Meta | Fracaso |
|---------|------|---------|
| Cuentas Pro pagas | 8-10 (USD 240-300 MRR) | < 5 |
| Conversion trial → Pro | 60% | < 35% |
| NPS | > 40 | < 20 |
| Referrals orgánicos | 1-2 / mes | 0 |

Acción si fracaso: pivot de canal (probar canal 4 si Canal 1-2 no funcionaron).

### A 180 días

| Métrica | Meta | Fracaso |
|---------|------|---------|
| Cuentas Pro pagas | 25-30 (USD 750-900 MRR) | < 15 |
| Conversion trial → Pro | 65-70% | < 50% |
| NPS | > 50 | < 30 |
| Referrals orgánicos | 5+ / mes | < 2 |
| Cuentas Team activas | 1-2 (validar plan superior) | 0 |
| Churn mensual | < 5% | > 15% |

A 180 días con éxito → arrancar Fase 2 con confianza. Si fracaso → revisar foco de discovery, reentrevistar consultores, posiblemente pivot.

### Métricas de health continuas (siempre)

- **Costo unitario de IA por cuenta** (alerta si > USD 15 sostenido en plan Pro).
- **Tiempo de generación de informe extremo a extremo** (alerta si supera 30s p95).
- **Errores en generación de informes** (target: < 1 cada 100).
- **Soporte tickets / mes** (señal de fricción si > 1 por cada 10 cuentas activas).
- **Tasa de uso de versiones anteriores de normas** (info para entender cómo navegan los cambios normativos).

## Decisiones que cierra esta etapa

**D09 — Pricing público en home page.** Plan Pro USD 30, Plan Team USD 100, Plan Enterprise USD 250. Trial de 7 días o 5 informes sin tarjeta. Cancelación auto-servicio.

**D10 — Plan Team disponible desde Fase 2.** En Fase 1 solo se ofrece Plan Pro para mantener foco. Plan Team requiere features de coordinación que se desarrollan después.

**D11 — Plan Enterprise disponible desde Fase 4.** Requiere multi-establecimiento, API y SLAs de soporte que demandan equipo dedicado.

**D12 — Foco geográfico inicial AMBA + canales orgánicos.** No invertir en ads pagos hasta tener 25 cuentas pagas y conversion validada.

**D13 — Programa de referidos activo desde el día uno.** Referidor recibe el cuarto mes gratis cuando el referido paga 3 meses.

**D14 — Métricas de validación a 60/90/180 días con cláusulas de pivot.** Si a 90 días tenemos < 5 cuentas pagas o NPS < 20, paramos a revisar producto antes de seguir invirtiendo.

## Lo que viene después de Fase 1

Si las métricas a 180 días salen bien:

- **Fase 2 (mes 6-9):** lanzar Plan Team con dashboard de coordinación. Apuntar a 50 cuentas Pro + 5 cuentas Team (USD 2.000 MRR).
- **Fase 3 (mes 9-13):** lanzar PWA offline + permisos diarios + kit de jornada. Apuntar al perfil C (supervisor en obra). Sumar Plan Enterprise vendido a 1-2 empresas constructoras.
- **Fase 4 (mes 13-18):** repositorio documental, capacitaciones, accidentabilidad. Subir ARPU promedio.

Si las métricas no salen bien, paramos antes y revisamos. **No se invierte tiempo en features de Fase 2-4 si Fase 1 no validó.**

## Cierre del discovery

Con este documento se cierra el ciclo de descubrimiento de negocio. Los archivos `01-mercado.md`, `02-personas.md`, `03-competencia.md` y este `04-sintesis.md` son la fuente única de verdad sobre **por qué construimos esto**. El archivo `00-decisiones.md` es la fuente única de verdad sobre **qué decidimos**.

**Siguiente paso:** retomar la parte técnica con todo este contexto consolidado. Reescribir `docs/04-architecture.md` y `docs/05-roadmap.md` (los que se hicieron prematuramente y se archivaron) eliminando todo lo que ya no aplica y reflejando los requerimientos definitivos. Recién con eso abrimos Claude Code para empezar a construir Fase 1.
