# 03 · Oportunidades de IA · Catálogo completo

Este documento mapea **cada dolor del usuario a una feature potenciada por IA**. Es la tesis del producto. Si la app fuera solo un CRM con base de datos, valdría USD 5/mes. La IA es lo que la hace valer USD 30-100/mes.

Cada feature tiene: **dolor**, **solución**, **input/output**, **rol de la IA**, **contexto que necesita**, **prompt template** (cuando aplique), y **prioridad de implementación**.

---

## Feature 1 · Generación de informes técnicos protocolarios

**Dolor:** redactar informes de medición (ruido, iluminación, PAT, RGRL, carga de fuego) lleva 2-4 horas cada uno. Recurrentes, anuales, repetitivos. Validado en Fase 0 actual.

**Solución:** el consultor carga datos crudos (CSV del instrumento o tabla manual). La IA arma el informe completo conforme a la normativa aplicable.

**Input:**
- Datos del establecimiento (empresa, CUIT, domicilio, actividad)
- Instrumental con calibración
- Tabla de mediciones por punto
- Profesional firmante

**Output:** documento técnico estructurado (HTML → PDF) con marco normativo, metodología, resultados, análisis, conclusiones por punto (cumple/no cumple) y recomendaciones específicas.

**Rol de la IA:**
- Redacción del marco normativo citando artículos
- Análisis comparativo contra valores límite
- Conclusiones por punto con criterio profesional
- Recomendaciones jerarquizadas (eliminación → controles → EPP)

**Contexto necesario:**
- Plantilla de prompt por tipo de protocolo (Res SRT 85/12, 84/12, etc.)
- Tabla de valores límite normativos
- Histórico de informes previos del cliente (para detectar tendencias)

**Prompt template (extracto):**
```
Sos un Lic. en Higiene y Seguridad matriculado. Generá un informe técnico
de medición de [TIPO] conforme [NORMATIVA]. Considerá los datos siguientes
y emití conclusiones por punto y recomendaciones jerarquizadas.

[DATOS_JSON]

Formato: HTML con secciones marco normativo, instrumental, metodología,
resultados, conclusiones, recomendaciones, firma. Tono técnico, formal,
español de Argentina.
```

**Estado:** ✅ Implementado en Fase 0. Iterar en Fase 1 con persistencia, branding del cliente y selector de modelo.

**Prioridad:** Alta (ya hecho). Es la puerta de entrada del producto.

---

## Feature 2 · Generador de "kit de jornada" por tipo de tarea

**Dolor:** el consultor tiene que armar a mano cada día el paquete documental para una tarea: charla previa, capacitación, checklists de cada equipo, permiso de trabajo. Cada combinación de tarea/equipo requiere documentos distintos. Hoy se hace con copy-paste de Word.

**Solución:** el consultor escribe en lenguaje natural "hoy supervisión de trabajo en altura con andamios y autoelevador". La IA genera todo el paquete.

**Input:** descripción de la tarea + ubicación + cantidad de operarios + nivel de riesgo declarado.

**Output (todo en un solo flujo):**
- **Charla de seguridad de 5 minutos** (texto formateado para que el supervisor lea al equipo).
- **Capacitación específica** con 3-5 puntos clave de formación.
- **Checklist de cada equipo presente** (uno por andamio, uno por arnés, uno por autoelevador, etc.) en formato firmable.
- **Permiso de trabajo del día** con campos para mediciones (viento si es altura, gas si es confinado), firmas y código único.
- **Capacitación complementaria sugerida** según historial del operario (si la app sabe quién va a estar).

**Rol de la IA:**
- Razonar qué documentos son relevantes según la tarea descripta.
- Redactar la charla previa en tono apto para lectura oral (frases cortas, claras).
- Generar items de checklist específicos a cada equipo (no genéricos).
- Sugerir capacitaciones según riesgos detectados.

**Contexto necesario:**
- Catálogo de equipos común en obras argentinas (andamios IRAM 11906, autoelevadores categoría I/II, arneses, escaleras, herramientas eléctricas, etc.)
- Plantillas base de checklists por equipo
- Histórico de capacitaciones del operario (si está en sistema)
- Mediciones ambientales de la jornada

**Prompt template (extracto):**
```
Generá el paquete documental completo para una jornada de trabajo HyS.

Tarea: [TAREA_DESCRITA]
Equipos involucrados: [EQUIPOS]
Ubicación: [UBICACION]
Operarios: [LISTA_NOMBRE_FUNCION]

Producí en JSON:
1. charla_5min: string con la charla previa para leer al equipo
2. capacitacion: { titulo, objetivos, contenido_breve }
3. checklists: [{ equipo, items: [{ pregunta, criterio_aprobacion }] }]
4. permiso_trabajo: { tipo, mediciones_requeridas, firmas_requeridas }
5. capacitacion_sugerida: string opcional según riesgos detectados

Tono: técnico operativo, español Argentina, citá Decreto 351/79 cuando aplique.
```

**Estado:** Pendiente. Es el sexto tipo de informe a sumar al selector. Fase 1.

**Prioridad:** Alta. Fue lo que más entusiasmó al experto.

---

## Feature 3 · Tracking inteligente de entrega de EPP (Resolución 299/11)

**Dolor:** **el más caro económicamente.** Multas por EPP no actualizado o doble entrega por descontrol.

**Solución:** sistema de gestión de entrega con firma digital, calendario automático y prevención de duplicados.

**Input:**
- Padrón de empleados del cliente (CUIL, nombre, puesto, talles)
- Catálogo de EPP disponible (camisa, pantalón, borceguíes, arnés, etc. con marcas y talles)
- Evento de entrega (empleado, items, lote, foto opcional, firma digital)

**Output:**
- **Planilla Resolución 299/11** descargable (PDF firmado conforme normativa).
- **Calendario de vencimientos** (cada empleado tiene una fecha de próxima entrega obligatoria, 6 meses).
- **Notificaciones push**: "Vence el EPP de Pérez Juan en 7 días".
- **Reporte mensual** del estado del padrón (al día / por vencer / vencido).
- **Detección de doble entrega**: warning antes de registrar una entrega si la última fue hace menos de 5 meses.

**Rol de la IA:**
- **Sugerir EPP por puesto/riesgo**: el consultor crea un empleado nuevo, declara puesto "soldador", la IA propone el kit estándar (mascarilla, careta, guantes de cuero, calzado dieléctrico, etc.) según la matriz de riesgo y normativa IRAM aplicable.
- **Resumir el estado** en lenguaje natural: "esta semana tenés 3 entregas que vencen, todas en la planta de Avellaneda. ¿Te armo la salida del lunes?"
- **Detectar anomalías**: "el empleado X tuvo 2 entregas en 4 meses, parece error".
- **Generar acta de incumplimiento** si un empleado se niega a firmar (con texto legal apropiado).

**Contexto necesario:**
- Tabla `empleados` con puesto y matriz de riesgo
- Tabla `epp_catalogo` con items, marcas, talles, vida útil esperada
- Histórico de entregas
- Texto de la Resolución 299/11

**Estado:** Pendiente. Fase 2.

**Prioridad:** Alta. Es el feature más vendible.

---

## Feature 4 · Repositorio documental con vencimientos y búsqueda IA

**Dolor:** manuales de equipos, certificados de calibración, planos en papel sobre el escritorio. "Si se prende fuego, perdí todo". Sin búsqueda.

**Solución:** repositorio en cloud con OCR + búsqueda semántica + alertas de vencimiento.

**Input:**
- Subida de archivo (PDF, foto, escaneo)
- Tipo de documento, equipo asociado, fecha de emisión, frecuencia de revisión

**Output:**
- Archivo guardado, accesible desde celular.
- **OCR automático** sobre el contenido para hacerlo buscable.
- **Vencimientos calculados** y alertas push.
- **Q&A sobre el documento**: el consultor pregunta "¿cuál es la carga máxima del arnés Petzl Falcon?" y la IA responde con cita del manual.

**Rol de la IA:**
- Extracción automática de metadatos al subir un documento (la IA lee el PDF y propone tipo, equipo, fecha).
- Search semántico ("encontrá manuales de arneses con norma EN 361").
- Q&A contextual sobre el contenido.
- Resumen de manuales largos en tarjetas de 1 página.

**Contexto necesario:**
- Storage para los archivos (Supabase Storage)
- OCR (servicio externo o Claude con vision)
- Embeddings para search semántico (pgvector en Supabase)

**Estado:** Pendiente. Fase 4.

**Prioridad:** Media. Importante pero no bloqueante para vender.

---

## Feature 5 · Mediciones diarias rápidas + permisos de trabajo

**Dolor:** medir viento antes de cada trabajo en altura, gases en confinados, etc. Generar permisos de trabajo. Hoy en papel.

**Solución:** plantillas de permisos por tipo de trabajo, con campos de medición integrados, evaluación contra umbrales y firma digital de los involucrados.

**Input:**
- Tipo de trabajo (altura, confinado, caliente, eléctrico, etc.)
- Empleados involucrados
- Mediciones (viento, gas, etc.)

**Output:**
- Permiso firmable en pantalla por todos los involucrados (consultor + supervisor + operarios).
- Decisión binaria habilitado/no habilitado según umbrales.
- En caso de no habilitado, **acta legal automática** explicando la causa.
- Todo con GPS y timestamp para resguardo.

**Rol de la IA:**
- **Generación del texto del permiso adaptado a la situación** (ej: si es altura > 4m con viento al límite, agrega cláusulas específicas).
- **Análisis de tendencias**: "este sitio tuvo vientos críticos 3 de los últimos 5 días".
- **Sugerencia de medidas adicionales**: "con 28 km/h estás cerca del límite, sugerimos suspender en 30 minutos si sigue subiendo".

**Contexto necesario:**
- Catálogo de tipos de permisos legales argentinos
- Tabla de umbrales por tipo de medición
- Geolocalización del usuario

**Estado:** Pendiente. Fase 3.

**Prioridad:** Alta para perfil tipo C (supervisor en obra grande).

---

## Feature 6 · Análisis de accidentabilidad y jerarquía de controles

**Dolor:** los índices de accidentabilidad se calculan a mano si es que se hacen. La jerarquía de controles se aplica con criterio profesional, no sistemático.

**Solución:** el consultor sube su histórico de incidentes, la IA computa índices estándar (Frecuencia, Gravedad, Duración) y produce un plan de mitigación jerarquizado.

**Input:**
- Tabla de eventos: fecha, tipo, gravedad, días perdidos, sector, causa raíz, EPP involucrado.
- Padrón de horas trabajadas por sector (denominador para los índices).

**Output:**
- **Índice de Frecuencia** (incidentes × 1M / horas-hombre).
- **Índice de Gravedad** (días perdidos × 1k / horas-hombre).
- **Ranking de riesgos** por daño causado.
- **Plan de mitigación jerarquizado** según ISO 45001:
  1. Eliminación
  2. Sustitución
  3. Controles de ingeniería
  4. Controles administrativos
  5. EPP
- **Acciones concretas** por riesgo (con responsable y plazo sugerido).

**Rol de la IA:**
- Análisis estadístico narrado.
- Identificación de patrones (ej: "el 60% de los accidentes graves involucran caídas a distinto nivel y ocurren en planta Pilar entre las 14 y 16").
- Sugerencia de controles según jerarquía y caso.
- Generación de informe ejecutivo en lenguaje natural para presentación a la dirección.

**Contexto necesario:**
- Tabla `incidentes` con histórico
- Tabla `horas_trabajadas` por sector
- Texto de ISO 45001 cláusula 8 (jerarquía de controles)

**Estado:** Pendiente. Fase 4.

**Prioridad:** Media. Más estratégico que operativo.

---

## Feature 7 · Capacitaciones automáticas adaptadas

**Dolor:** capacitaciones obligatorias repetitivas pero hay que adaptarlas a la industria de cada cliente.

**Solución:** generador con input "industria + tema + duración" y output material didáctico completo.

**Input:**
- Industria (frigorífico, metalúrgica, construcción, oficina, etc.)
- Tema (riesgo eléctrico, manejo de cargas, primeros auxilios, espacios confinados, etc.)
- Duración objetivo (15, 30, 60, 90 minutos)
- Audiencia (operarios, mandos medios, administrativos)

**Output:**
- **Plan de clase** con objetivos, contenido por bloque, dinámicas, ejemplos.
- **Material para proyectar** (slides en HTML/PDF).
- **Material para imprimir** (handout para llevar).
- **Evaluación final** con preguntas de opción múltiple.
- **Lista de asistentes** para firmar (genera certificado individual).

**Rol de la IA:**
- Generación del contenido didáctico adaptado.
- Ejemplos específicos a la industria del cliente.
- Preguntas de evaluación con justificación de respuesta correcta.
- Pequeñas dinámicas grupales sugeridas.

**Contexto necesario:**
- Lista de capacitaciones obligatorias según Decreto 351/79 capítulo 21 y Res SRT 905/15.
- Información de la industria del cliente (de su perfil).

**Estado:** Pendiente. Fase 4.

**Prioridad:** Media-alta. Es vendible como módulo aparte.

---

## Feature 8 · Asistente conversacional contextual ("ChatHyS")

**Dolor:** el consultor consulta en Google o pregunta a colegas cuestiones normativas o técnicas que pierden tiempo.

**Solución:** chat embebido en la app con contexto de los datos del usuario y conocimiento normativo cargado.

**Input:** pregunta en lenguaje natural.

**Output:** respuesta con citas a normativa + datos del propio usuario cuando relevante.

Ejemplos de preguntas:
- "¿Cuál es el límite de exposición a ruido para 6 horas?"
- "Mostrame todas las entregas de EPP del cliente Acme de este mes."
- "¿Qué capacitaciones le debo a un empleado nuevo en frigorífico?"
- "¿Tengo algún protocolo por vencer este mes?"

**Rol de la IA:**
- Entender intención (pregunta normativa vs query a base de datos vs acción).
- Si es query, generar SQL apropiada (con guardrails de seguridad).
- Si es normativa, responder con cita.
- Si es acción ("agendame visita el martes"), proponer la acción y pedir confirmación.

**Contexto necesario:**
- Acceso de solo lectura a las tablas del usuario
- RAG sobre corpus normativo argentino HyS
- Function calling para acciones

**Estado:** Pendiente. Fase 5+.

**Prioridad:** Media. Es el "wow" sostenido del producto.

---

## Feature 9 · Visión computacional para auditorías

**Dolor:** auditar una planta requiere caminarla, sacar fotos, anotar incumplimientos. Lleva tiempo y es subjetivo.

**Solución:** consultor saca fotos del recorrido, la IA detecta incumplimientos automáticamente.

**Input:** fotos de la planta o de equipos.

**Output:** reporte con incumplimientos detectados, ubicación en la imagen, sugerencia de corrección.

Ejemplos de detección:
- Persona sin casco
- Persona sin arnés en altura
- Matafuego mal señalizado
- Tablero eléctrico abierto
- Carga mal estibada
- Falta de barandas
- Cables expuestos

**Rol de la IA:**
- Visión multimodal (Claude Sonnet con imágenes).
- Localización en la imagen del incumplimiento.
- Severidad y normativa infringida.

**Estado:** Pendiente. Fase 5+.

**Prioridad:** Baja para arrancar (caro de evaluar bien), pero feature wow para demos. Considerar para ventas.

---

## Resumen: cómo se encadenan las features

```
Datos del usuario (consultora, clientes, empleados, EPP, equipos, mediciones)
    ↓
La app los almacena multi-tenant con RLS
    ↓
Cada feature de IA toma un subconjunto del contexto y genera un output útil
    ↓
El output se persiste, se firma, se descarga, se envía
    ↓
Las features se cruzan: las entregas de EPP alimentan capacitaciones, las
mediciones alimentan permisos, los manuales alimentan el chat normativo
```

**Sin contexto, la IA es un chatbot.** Con contexto multi-tenant persistente, es un colega que tiene memoria de cada cliente y nunca olvida un vencimiento.

## Costos de IA estimados (Claude Sonnet 4.6)

- Generar un informe técnico (~3k tokens out): USD 0.05-0.10
- Generar kit de jornada (~5k tokens out): USD 0.10-0.15
- Q&A sobre manuales (~1k tokens out): USD 0.02
- Análisis de accidentabilidad (~4k tokens out): USD 0.08

Un usuario Pro promedio que use intensivo (50 informes + 100 kits + 200 chats al mes): **USD 8-12 en API**. Sobre suscripción de USD 30, margen del 60-70%. Saludable.
