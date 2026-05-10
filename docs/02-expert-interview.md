# 02 · Entrevista al experto

Charla por audio de WhatsApp con un profesional de HyS argentino que tiene 30 personas a cargo. Su jefe maneja 100 personas en obras civiles. La charla ocurrió tras mostrarle el prototipo Fase 0. La sintetizó en 8 audios cortos. **Las transcripciones están en español oral con errores de transcripción menores; el sentido se conserva**.

Las usamos como **fuente primaria de requerimientos del producto**.

## Audio 1 — 19:16:25 · Validación inicial

> "Como andás, la útil todavía. Está increíble, está increíble porque es súper fácil de entender. Las cosas que más se suelen hacer son esas: mediciones de ruido, de iluminación, cargas de fuego. Pasa que se te pone fino, le puedes agregar un millón de cosas sinceramente."

**Insight:**
Validación de la hipótesis core (los protocolos repetitivos son el primer dolor a atacar). El experto confirma que el alcance del MVP (ruido, iluminación, carga de fuego) cubre el grueso de su trabajo recurrente. Y abre la puerta: "le puedes agregar un millón de cosas". Esto define que el producto **no es vertical estrecho — es plataforma**.

## Audio 2 — 19:17:19 · Generador de checklists por especialidad

> "Otra cosa que hicimos mucho son documentos en blanco — checklists. De cosas muy en particular. Vos sabés que va a haber una excavadora, va a haber una planadora, va a haber una hormigonera, etcétera. Que vos puedas decir 'esto tengo que hacer obras viales' y te tire todos los checklists que podés llegar a usar, o todas las capacitaciones que te pueden servir."

**Insight clave: el "kit de tarea por especialidad".**

El consultor en obra usa decenas de checklists distintos según la maquinaria, la tarea o el riesgo presente. Hoy los tiene en Word o impresos. La idea: **input = tipo de obra/tarea**, **output = paquete completo de documentos relevantes** (checklists de cada equipo + capacitaciones asociadas + permisos).

Esta es una feature donde la IA brilla porque:
- El catálogo de equipos y tareas es amplio (cientos de combinaciones)
- Cada combinación requiere un mix distinto de documentos
- Los checklists se pueden generar dinámicamente desde una base de items normalizados

## Audio 3 — 19:19:42 · Índices de accidentabilidad y entrega de EPP (Res 299)

> "Otra cosa útil son los índices de accidentabilidad. Eso te da una jerarquía de controles, después eliminar, mitigar o minimizar el riesgo. Te da una estadística de razón de que los que más daños han sufrido son, no sé, gente que se ha caído a distinto nivel. ¿Cómo hacemos? Listo, con arnés. Es tener un checklist de arnés para hacer periódicamente. (...) Te dice que el riesgo más chico es la gente que pisa clavos. ¿Cómo? Que usen borceguíes. Que tengas la planilla de entrega de ropa, la 299, idea general que te ponga que tal día se le entregó tal borceguí a tal empleado, tal marca, que te lo firme el empleado."

**Dos features en un audio:**

**a) Análisis de accidentabilidad con IA.** El consultor sube su histórico de accidentes/incidentes y la IA produce:
- Ranking de riesgos por daño causado
- Sugerencia de **jerarquía de controles** (eliminar > sustituir > controles de ingeniería > administrativos > EPP) según ISO 45001
- Acciones concretas por riesgo (ej: "implementar checklist mensual de arneses", "exigir borceguíes con puntera en sector X")

**b) Entrega de EPP según Resolución SRT 299/11.** El consultor dispara:
- Empresa que da el EPP
- Empleado receptor (nombre, DNI, foto opcional)
- Items entregados (camisa, pantalón, borceguíes, marcas, talles)
- Firma del empleado (digital, en pantalla)
- Fecha

**Aquí la IA aporta menos generación pero mucha automatización: alertas de calendario, prevención de doble entrega, generación de planilla descargable conforme Res 299**.

## Audio 4 — 19:25:23 · Validación del valor

> "Esa forma está buenísima porque gran parte del trabajo de Higiene y Seguridad es informe, reporte y cosas que después tenés que darle a alguien más. Si vos tenés que estar haciendo trabajo de campo y para acordarte hacer informes es una paja. Más si no tenés un lugar como, pero muchas veces estás ahí en el día a día en el campo. En cambio si tenés algo que generele todo desde los datos, increíble."

**Insight de pitch:**

El experto verbaliza espontáneamente el value prop principal: **informes/reportes son una paja, especialmente si estás en campo**. El consultor pasa el día en obra y la papelería se acumula. **La promesa de la app es: tomá los datos en campo, el informe se genera solo**.

Esto valida la decisión de PWA + offline + sync: hay que poder cargar datos en obra sin internet.

## Audio 5 — 19:26:28 · Detalle Resolución 299

> "Lo de la ropa es un poco más complejo porque eso suele ser a mano. Tengo la Resolución 299, que es una planilla básicamente de entrega de elementos de protección personal. La empresa que está dando, en este caso yo, la persona a la que se la das, su DNI, etcétera, si querés podés mandar con una foto del mismo. Cargás todo lo que se le ha dado: camisa, pantalón, borceguíes. Lo firma él. Tiene una fecha. Legalmente cada seis meses tenés que renovarle todo, esté roto o no. Cada seis meses. ¿Qué pasa? Muchas veces te pasás de los seis meses porque pasa rápido, no te das cuenta. Si lo diste a 9 meses te cabe la multa. O te puede pasar que le diste ropa dos veces en seis meses, no te diste cuenta y perdiste plata."

**Este es el feature más vendible del producto.**

Por qué:
- **Dolor económico cuantificable**: una multa por Res 299 desactualizada en una inspección de la SRT puede ser de varios cientos de USD por trabajador en infracción.
- **Dolor administrativo recurrente**: cada empleado, cada 6 meses, cada empresa cliente.
- **Hoy se hace 100% a mano**: papel, planilla en Excel, escaneo de firma, archivo en carpetas. **Nadie tiene un sistema decente para esto en consultoras chicas.**

Funcionamiento ideal:
1. El consultor carga el padrón del empleado del cliente (una vez).
2. Cuando entrega EPP, abre el celular en planta, selecciona empleado, ítems, talles, marcas, lote.
3. El empleado firma en la pantalla del celular.
4. Foto opcional de la entrega y/o del empleado con el EPP puesto.
5. La app guarda con timestamp + GPS.
6. **Calendario interno calcula vencimiento a 6 meses**.
7. **Notificación push 7 días antes del vencimiento**: "Vence el EPP de Pérez Juan el 15/11".
8. Si intenta cargar entrega antes de los 6 meses → warning ("ya entregaste hace 3 meses, querés sobrescribir o registrar adicional?").
9. Reporte mensual: lista de todos los empleados con estado (al día / por vencer / vencido).
10. Exporta planilla conforme a Resolución SRT 299/11 cuando llegue una inspección.

## Audio 6 — 19:27:11 · Generador de jornada (kit de tarea)

> "Por el lado que está haciendo ahora, sumarle lo de los checklists, o sea que te genere automáticamente un documento, está increíble. Que dos días le digas 'bueno hoy tengo que supervisar trabajo en altura' y te abra todo esto: te genera ya la charla de cinco minutos antes del trabajo, te genera la capacitación que tienes que dar con los temas, que te haga checklist de arnés, checklist de andamios, checklist de autoelevador, etcétera. Todo lo que vas a usar o te puedas llegar a usar. Está súper útil."

**Refuerza Audio 2 con la salida concreta esperada:**

Cuando el consultor dice "trabajo en altura hoy", la IA produce:
1. **Charla previa de 5 minutos** (texto preparado para que el supervisor la lea al equipo antes de empezar)
2. **Capacitación específica con los temas** (material didáctico generado según la tarea)
3. **Checklists múltiples** (uno por cada equipo o riesgo presente — arnés, andamios, autoelevador, herramientas eléctricas, etc.)
4. **Permiso de trabajo del día** (formulario firmable con fecha, condiciones, firmas, código)

Todo en un solo PDF descargable o en pantallas separadas para firmar individualmente.

## Audio 7 — 19:33:09 · Repositorio de manuales con vencimientos

> "Cada cosa tiene un período en el cual tenés que revisarlo. Hay períodos que te lo exige la ley, otros que tenés que hacerlo vos. Por ejemplo para un tránsito de arneses yo eso no lo hago todos los días, lo hago cada 2-3 meses por si tengo que reentrenar. Y eso es un manualito de 40 hojas que tengo yo en mi escritorio, que se me llega a agarrar fuego se me va todo. Si yo tuviese un lugar a donde poder volcar la información, olvidate las hojas, las prendo fuego, las dejo, y ya lo tengo ahí documentado."

**Feature: repositorio documental con vencimientos.**

Datos por documento:
- Tipo (manual de equipo, certificado de calibración, plano, póliza, etc.)
- Equipo/sujeto al que aplica (arnés modelo X, autoelevador placa Y)
- Fecha de emisión
- Frecuencia de revisión (legal o autoimpuesta)
- Próximo vencimiento (calculado automáticamente)
- Archivo (PDF, foto, lo que sea — al storage)
- Notas

Beneficios:
- **Backup digital frente a pérdida física**.
- **Búsqueda rápida**: "muéstrame el manual del arnés modelo Petzl Falcon" → resultado en un toque.
- **Alertas de revisión próxima**: "esta semana toca revisar arneses (cada 2 meses)".
- **OCR opcional** sobre las páginas escaneadas para que la IA pueda responder preguntas: "¿cuál es el rango de carga máxima de este arnés?" → respuesta extraída del manual.

## Audio 8 — 19:34:14 · Mediciones diarias y permisos de trabajo

> "Otra medición que se usa mucho es la medición de viento, que se hace con un anemómetro. Esa medición se hace todos los días antes de la tarea cuando se van a hacer trabajos en altura. A partir del primer piso ya cambia el viento. Si tenés algo de no sé, 30 km/h de viento, eso se deja sentado en un informe — el permiso de trabajo en altura de ese día — y se sube. Si por ejemplo ellos quieren seguir trabajando ese día por más que vos avisaste que hay 30 km/h y lo informaste, quedás resguardado. O puedes inclusive sufrir de tu forma en la tarea. Otra medición que se suele hacer es la de contaminación del aire en empresas que trabajan con agentes químicos."

**Feature: mediciones diarias rápidas + permisos de trabajo.**

Diferencia con los protocolos anuales:
- Los **protocolos** (ruido SRT 85/12, iluminación SRT 84/12) son anuales, formales, firmados por matriculado, presentados a ART.
- Las **mediciones diarias** son operativas, cortas, asociadas a un permiso de trabajo del día.

Tipos comunes:
- Viento (anemómetro) antes de trabajo en altura. Umbral 30 km/h.
- Calidad del aire (multigas) en espacios confinados o ambientes con químicos. Umbrales por componente.
- Iluminación puntual en una tarea específica.
- Temperatura/humedad en condiciones extremas.

**Frase clave del experto: "quedás resguardado"**. La función legal de estas mediciones es **registrar la decisión de habilitar/no habilitar la tarea** con timestamp y firma. Si pasa algo y la SRT investiga, la app es la prueba.

Funcionamiento ideal:
1. Consultor abre app → "nuevo permiso de trabajo en altura".
2. Selecciona empleados involucrados, ubicación, tipo de tarea.
3. Toma medición de viento (manual: ingresa valor; futuro: integración Bluetooth con anemómetro).
4. App evalúa contra umbral.
5. Si OK → genera permiso firmable, todos los involucrados firman digitalmente.
6. Si NO OK → app dice "tarea no habilitada", emite acta de imposibilidad firmada.
7. Todo queda con GPS y timestamp.

## Insights transversales (los más importantes)

**1. La palabra clave es "resguardo".** El experto la usa varias veces. El producto vende **resguardo legal**, no productividad. Tenelo presente cuando escribas copy.

**2. Recurrencia > one-shot.** Las features de mayor valor tocan tareas que se hacen **diariamente** (permisos), **mensualmente** (mediciones, capacitaciones), **cada 2-3 meses** (revisiones), **cada 6 meses** (EPP), **anualmente** (RGRL, RAR, protocolos). El one-shot (informe único) es la puerta de entrada, no el corazón.

**3. La IA es el conector.** Sola no es nada — pegada a una tabla de empleados, una agenda con vencimientos, un repositorio de docs y un generador de PDFs, **multiplica el valor de cada uno**. La tesis del producto es: *cada tarea administrativa que el consultor hace hoy a mano puede ser asistida o ejecutada por IA si tiene el contexto adecuado*. Por eso multi-tenancy con datos persistentes desde día cero — sin contexto, la IA es chatbot genérico.

**4. El feedback loop es físico.** La app vive en el bolsillo del consultor en planta. Las features ganadoras son las que se usan **estando parado en la obra** (firmar EPP, sacar permiso de altura, abrir checklist). Las que se usan en oficina (redactar informe anual, leer manuales) son secundarias.

**5. Hay una segmentación natural.**
- Tipo A (freelancer): le importa más generar informes y agenda de vencimientos.
- Tipo B (consultora chica): le importa coordinar técnicos.
- Tipo C (supervisor en obra): le importa firmas EPP y permisos diarios.

La app debe permitir a cada uno apagar/encender módulos según su perfil.
