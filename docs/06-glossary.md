# 06 · Glosario

Términos del rubro Higiene y Seguridad Laboral en Argentina, normativa específica y siglas técnicas. Pensado para que un agente de IA (o un dev nuevo) pueda entender el dominio sin contexto previo.

## Organismos

- **SRT** — Superintendencia de Riesgos del Trabajo. Regulador nacional argentino. Emite Resoluciones de cumplimiento obligatorio.
- **MTEySS** — Ministerio de Trabajo, Empleo y Seguridad Social.
- **ART** — Aseguradora de Riesgos del Trabajo. Cada empleador debe contratar una ART obligatoriamente. Ejemplos: Asociart, Provincia ART, Federación Patronal, Galeno ART, Prevención ART.
- **CPHySA** — Consejo Profesional de Higiene y Seguridad de Argentina (algunos colegios provinciales tienen otras siglas).
- **CIE** — Colegio de Ingenieros (provincias). Habilitan firma profesional en informes que requieren ingeniero.
- **IRAM** — Instituto Argentino de Normalización y Certificación. Emite normas técnicas (IRAM 11949 carga de fuego, IRAM 3610 calzado de seguridad, etc.).
- **AEA** — Asociación Electrotécnica Argentina. Emite la reglamentación AEA 90364 sobre instalaciones eléctricas.
- **OSHA** — Occupational Safety and Health Administration (EE.UU.). No regula en Argentina pero algunas grandes empresas la usan como referencia adicional.

## Marco normativo argentino

- **Ley 19.587** — Ley de Higiene y Seguridad en el Trabajo. De 1972. Pilar fundamental del sistema.
- **Decreto 351/79** — Decreto reglamentario de la Ley 19.587. Aplica a industria, comercio y servicios. Define con detalle qué hay que medir, capacitar, proveer en EPP, etc. Anexos clave:
  - **Anexo IV** — niveles mínimos de iluminación por tarea visual.
  - **Anexo V** — niveles máximos admisibles de exposición a ruido.
  - **Capítulo 14** — instalaciones eléctricas y puesta a tierra.
  - **Capítulo 18** — protección contra incendios y carga de fuego.
  - **Capítulo 19** — equipos y elementos de protección personal.
  - **Capítulo 21** — capacitación.
- **Decreto 911/96** — análogo al 351/79 pero específico para construcción.
- **Decreto 617/97** — análogo para actividad agrícola.
- **Ley 24.557** — Ley de Riesgos del Trabajo. Crea el sistema de ART.
- **Decreto 1338/96** — define las horas profesionales obligatorias de servicios de Higiene y Seguridad y de Medicina del Trabajo según cantidad de personal.

## Resoluciones SRT clave

- **Res SRT 84/12** — Protocolo para Medición de Iluminación. Validez 12 meses. Renovación obligatoria.
- **Res SRT 85/12** — Protocolo para Medición de Ruido. Validez 12 meses.
- **Res SRT 295/03** — establece los valores límite de exposición a contaminantes químicos y físicos.
- **Res SRT 299/11** — establece la **planilla obligatoria de entrega de EPP**. Una planilla por entrega, firmada por empleador y trabajador. **Renovación cada 6 meses.** Foco principal de la Feature 3.
- **Res SRT 463/09 mod. 529/09** — establece el RGRL (Relevamiento General de Riesgos Laborales). Anual, declaración jurada del empleador. Tres formularios según actividad (industrial, construcción, agro).
- **Res SRT 37/10** — Exámenes médicos obligatorios. Define el RAR (Relevamiento de Agentes de Riesgo).
- **Res SRT 51/97 y 35/98** — Programa de Seguridad para obras de construcción.
- **Res SRT 81/2019** — listado actualizado de agentes de riesgo (Anexo III).
- **Res SRT 905/15** — capacitación obligatoria de personal expuesto.
- **Res SRT 960/15** — capacitación en ergonomía y riesgos psicosociales.
- **Res SRT 5/2024** — modificaciones varias (verificar al implementar).

## Documentos y registros

- **RGRL** — Relevamiento General de Riesgos Laborales. Cuestionario tipo checklist que el empleador presenta a la ART una vez al año.
- **RAR** — Relevamiento de Agentes de Riesgo. Lista de personal expuesto a agentes (ruido, químicos, vibraciones, etc.) por CUIL, sector y puesto. Anual.
- **Programa de Seguridad** — documento por obra de construcción que detalla riesgos, controles, EPP, capacitación. Aprobado por la ART antes de iniciar obra.
- **Permiso de trabajo** — autorización del día para tareas de riesgo (altura, confinado, caliente, eléctrico). Firmado por supervisor + operario(s). Caduca al fin del día o de la tarea.
- **Acta de capacitación** — registro de capacitación dictada con tema, fecha, duración, asistentes con firma.
- **Encomienda Profesional** — documento del colegio profesional que habilita al matriculado a firmar un trabajo específico.

## Conceptos técnicos

- **EPP** — Elementos de Protección Personal. Casco, anteojos de seguridad, protección auditiva, mascarilla, guantes, ropa de trabajo, calzado, arnés, etc.
- **NRR** — Noise Reduction Rating. Capacidad de atenuación en dB de un protector auditivo.
- **Leq** — Nivel sonoro continuo equivalente. La métrica clave en mediciones de ruido.
- **Lmax** — Nivel sonoro máximo registrado.
- **Lux** — unidad de iluminancia. Lo que mide un luxómetro.
- **Ohm (Ω)** — unidad de resistencia eléctrica. Lo que mide un telurómetro en puesta a tierra.
- **Carga de fuego (q)** — densidad de combustible expresada en kg de madera equivalente por m². Determina la categoría de riesgo.
- **Riesgo R** — clasificación de R1 (muy bajo) a R7 (muy alto) según q y tipo de actividad. Define la resistencia al fuego F30/F60/F90/F120/F180 exigida.
- **Anemómetro** — instrumento para medir velocidad de viento. Obligatorio antes de trabajo en altura.
- **Telurómetro** — instrumento para medir resistencia de puesta a tierra.
- **Sonómetro** — instrumento para medir nivel sonoro instantáneo.
- **Dosímetro** — sonómetro personal que registra exposición acumulada durante toda la jornada.
- **Luxómetro** — instrumento para medir iluminancia en lux.
- **Multigás (4-en-1)** — instrumento que mide concentración simultánea de O₂, CO, CO₂ y H₂S. Obligatorio en espacios confinados.
- **Calibración** — verificación contra patrón trazable. Obligatoria, con certificado vigente. Sin calibración el informe no es legal.

## Tipos de tarea con riesgo elevado

- **Trabajo en altura** — toda tarea por encima de 2 metros. Requiere arnés, líneas de vida, capacitación específica, permiso del día, medición de viento previa.
- **Espacios confinados** — recintos de acceso limitado y ventilación deficiente (silos, tanques, cámaras). Requiere medición de gases previa, sistema de rescate, comunicación.
- **Trabajo eléctrico** — tareas sobre instalaciones energizadas. Requiere bloqueo (LOTO), EPP dieléctrico, calificación específica.
- **Trabajo caliente** — soldadura, corte, esmerilado en presencia de combustibles. Requiere permiso, vigilante de fuego, extintor a la mano.
- **Trabajo en izaje** — uso de grúas, autoelevadores, polipastos. Requiere operador calificado (ej: Res SRT 503/14), inspección previa del equipo.

## Equipos comunes en obra

- **Andamio** — estructura temporaria para acceso. Tipo tubular, modular, colgante, eléctrico. Cada uno con norma específica (IRAM 11906 series).
- **Autoelevador** — vehículo de manejo de cargas. Categorías I a IV según peso. Requiere licencia interna del operador y inspección previa al uso.
- **Arnés** — equipo de protección anticaídas. Norma EN 361 / IRAM 3605. Vida útil declarada por fabricante; inspección visual antes de cada uso.
- **Línea de vida** — sistema horizontal o vertical que asegura el arnés. Requiere cálculo y certificación de instalación.
- **Hidrante** — boca de incendio. Vinculada a red de agua propia o pública.
- **Matafuego (extintor)** — clase ABC, BC, K. Recarga anual obligatoria. Inspección visual mensual.

## Términos de gestión

- **HyS** — Higiene y Seguridad. A veces escrito SyS (Seguridad e Higiene), HSE (en empresas internacionales), QHSE (con calidad agregada).
- **EHS** — equivalente anglo (Environment, Health, Safety).
- **SST** — Seguridad y Salud en el Trabajo (terminología más moderna, alineada a OIT).
- **ISO 45001** — norma internacional de sistemas de gestión SST. Reemplazó a OHSAS 18001 desde 2018.
- **Jerarquía de controles** — orden de prioridad para mitigar un riesgo: 1) Eliminación, 2) Sustitución, 3) Controles de ingeniería, 4) Controles administrativos, 5) EPP. **Siempre intentar primero los superiores.** Lo menciona el experto en el audio 3.
- **Matriz de riesgo** — herramienta para evaluar riesgos cruzando probabilidad × consecuencia.
- **Cuasi accidente** — evento que pudo causar daño pero no lo causó (near miss). Importante registrarlos.

## Índices de accidentabilidad

- **Índice de Frecuencia (IF)** = (cantidad de accidentes con baja × 1.000.000) / horas-hombre trabajadas.
- **Índice de Gravedad (IG)** = (días perdidos × 1.000) / horas-hombre trabajadas.
- **Índice de Duración Media** = días perdidos / cantidad de accidentes con baja.
- **Tasa de Incidencia** = accidentes / cantidad de trabajadores expuestos.

## Términos colombiados (frecuentes en la región pero no en Argentina)

- **SG-SST** — Sistema de Gestión de Seguridad y Salud en el Trabajo. Es el término colombiano (Decreto 1072/2015). En Argentina se usa más "Sistema de Gestión HyS" alineado a ISO 45001.

## Acrónimos comunes en informes

- **CUIT** — Clave Única de Identificación Tributaria (empresa).
- **CUIL** — Clave Única de Identificación Laboral (trabajador).
- **DNI** — Documento Nacional de Identidad.
- **DDJJ** — Declaración Jurada.
- **APRA** — Agencia de Protección Ambiental, CABA.
- **OPDS** — Organismo Provincial para el Desarrollo Sostenible, Provincia de Buenos Aires.
- **AGC** — Agencia Gubernamental de Control, CABA.
- **PCI** — Protección Contra Incendio.
- **PAT** — Puesta a Tierra.
- **RCD** — interruptor diferencial residual.
- **TGBT** — Tablero General de Baja Tensión.
- **PTS** — Procedimiento de Trabajo Seguro.
- **ART de Autoseguro** — empresas grandes habilitadas a autoasegurarse en lugar de contratar ART.

## Frases que el experto usa (importantes para copy)

- **"Quedar resguardado"** — el objetivo legal de muchos registros. La app vende resguardo.
- **"Te cabe la multa"** — consecuencia económica del olvido. Leverage emocional para el pitch.
- **"Es una paja"** — describe el dolor de las tareas administrativas repetitivas.
- **"Se me llega a agarrar fuego, se me va todo"** — el dolor de la documentación en papel.
- **"De lleno, ya lo tengo ahí documentado"** — la promesa que la app cumple.
