# 01 · Contexto de negocio

## Quién es el usuario

El usuario primario es un **consultor de Higiene y Seguridad Laboral** que trabaja en Argentina. Es un profesional matriculado (Lic. en HyS, Ing. con especialización, técnico habilitado) que firma informes técnicos legales. Tres perfiles típicos:

**Tipo A — Consultor freelance multi-cliente.** Atiende 5-15 empresas en simultáneo. Gestiona los protocolos anuales obligatorios de cada una (RGRL, RAR, mediciones), entrega EPP, hace capacitaciones, redacta programas de seguridad. No tiene oficina propia — labura desde el auto, la planta del cliente o su casa. Ingresos: USD 1500-4000/mes según cartera.

**Tipo B — Empleado interno de una consultora chica.** Equipo de 2 a 10 técnicos que rotan entre clientes. Hay un dueño/director técnico que firma todo y delega visitas. Necesitan **coordinación** entre técnicos y trazabilidad de quién hizo qué.

**Tipo C — Supervisor de HyS en obra grande o empresa con personal propio.** El experto que entrevistamos cae acá: tiene 30 personas a cargo. Su jefe maneja 100 personas en obras civiles. La realidad acá es operativa, no consultora: entregan EPP a los 30/100 operarios, hacen capacitaciones diarias antes de cada tarea, generan permisos de trabajo en altura todos los días, firman actas. **Acá la app deja de ser "informes one-shot" y se vuelve sistema de gestión continua.**

ConsultoraDemo apunta principalmente al tipo A y B. El tipo C es el upmarket: cuando un consultor crece o un consultor freelancer empieza a manejar una cuenta grande con personal propio del cliente, las features de gestión de EPP y capacitaciones diarias se vuelven críticas.

## El día típico del usuario

Levantarse 6:30. Visita programada en una metalúrgica de Avellaneda a las 8. Salir, manejar 40 minutos. En la planta: medir ruido en 8 puestos con un dosímetro Quest, completar planilla en libreta. A las 10:30 ir a una constructora en Pilar: recorrer obra, anotar incumplimientos, hablar con el capataz, entregar 3 borceguíes a operarios nuevos y hacerles firmar la planilla de EPP en papel. A las 13 volver a casa y comer rápido. De 14 a 18 redactar:

- El informe de ruido de la metalúrgica (3 horas: pasar mediciones de la libreta a Excel, calcular Leq, comparar con norma, redactar conclusiones, armar PDF, firmar, enviar por mail).
- Cargar las 3 entregas de EPP de la constructora a una planilla maestra de Excel (10 minutos por persona, hay que escanear las firmas).
- Generar la charla de seguridad para el día siguiente que el capataz va a dictar (búsqueda en internet, copy-paste, adaptación, 40 minutos).
- Recordar que el viernes hay que renovar el RGRL anual de la ART de un cliente (lo anota en agenda papel).

A las 18 termina, agotado. Repite cinco días por semana.

**Dolor real:** el 60-70% del tiempo se le va en tareas administrativas que **no agregan valor profesional**. La parte donde el consultor hace lo que estudió (ir a la planta, evaluar el riesgo, decidir el control) es el 30-40% restante.

## Qué le duele al usuario, ordenado por intensidad

1. **Multas por olvidos.** El experto repite tres veces en los audios: "se te pasa de los 6 meses, te cabe la multa", "se me llega a agarrar fuego, se me va todo", "quedás resguardado o sufrís de tu forma". El dolor más concreto y económico es **multa o juicio laboral por no tener al día algo que ya hizo pero no registró**. Una entrega de EPP no documentada vale más que un mes de la app.

2. **Plata tirada por errores administrativos.** "Le diste ropa dos veces en seis meses, perdiste plata". Doble compra por no chequear lo que ya se entregó. Pasa cuando hay 30 personas y 5 obras.

3. **Tiempo de redacción de informes.** Es el dolor más obvio pero no el más caro. Compite con commodities (un Excel bien hecho, un becario, ChatGPT genérico). El experto lo reconoce: "es una paja", pero acepta que se hace.

4. **Memoria operativa.** El consultor mantiene en la cabeza decenas de fechas (vencimiento de calibración del telurómetro, próxima medición anual de ruido, cuándo dar EPP a Pérez, cuándo se vence el plan de evacuación). Cuando hay 5 clientes la cabeza no alcanza. Acá la app **no es generador, es agenda con cerebro**.

5. **Generación de material didáctico.** Las capacitaciones obligatorias son repetitivas pero no se pueden automatizar mal: tienen que estar adaptadas a la industria del cliente (no es lo mismo capacitar un frigorífico que una imprenta). Hoy se hace copy-paste.

6. **Manejo de papeles físicos.** Manuales de equipos, certificados, planos. "Manualito de 40 hojas en mi escritorio que se me llega a agarrar fuego, se me va todo". Falta de digitalización segura.

7. **Coordinación entre técnicos.** En consultoras de 3+ personas hay falta de visibilidad. Quién visitó qué cliente, qué se entregó, qué quedó pendiente. Se resuelve con WhatsApp y termina mal.

## Cómo se vende esto

El pitch NO es "ahorrá tiempo redactando informes". Eso vale poco y compite con commodities. **El pitch es "no te multen ni pierdas plata por errores administrativos, y dejá la libreta en el auto"**.

- Pitch a un freelancer (tipo A): "tu app que te avisa antes de que se venza algo, te genera el informe en 5 minutos en lugar de 2 horas, y guarda todas las firmas de EPP en la nube por si te auditan".
- Pitch a una consultora (tipo B): "el dueño ve qué hizo cada técnico esta semana, los técnicos cargan desde el celular en planta, los informes salen con la marca de la consultora, y nadie pierde un vencimiento".
- Pitch a un supervisor (tipo C): "tu equipo de 30 firma EPP digital, el sistema te avisa los 6 meses, el permiso de altura sale del celular en 1 minuto antes de empezar la tarea, y en una multa tenés todo respaldado con timestamp".

## El mercado

Hay competencia: SGO Suite, Genesis Broker, ZYGHT, Binaps, Vector EHS, Alcumus eCompliance. La mayoría son pesados, caros (USD 80-200/mes mínimo), pensados para empresas grandes con director de seguridad propio, no para el consultor freelance argentino.

**Hueco de mercado:** consultores y consultoras chicas/medianas argentinas que hoy usan Excel + WhatsApp + papel. Hay miles. El precio sweet spot es **USD 25-50/mes por consultor**, con plan team a USD 100-200/mes para consultoras de 5+ personas.

Diferenciador clave que ningún competidor tiene: **IA generativa de informes y planificación de jornada en lenguaje natural**. La mayoría de los competidores son CRM glorificados. Nosotros damos un asistente que escribe, no solo guarda.

## Modelo de monetización propuesto

- **Plan Free:** 1 consultora, 1 usuario, 5 informes/mes generados con IA. Captura para validar y dar de probar.
- **Plan Pro:** USD 30/mes por consultor. Informes ilimitados, gestión de EPP, vencimientos, repositorio. Apunta al freelancer tipo A.
- **Plan Team:** USD 100/mes hasta 5 usuarios. Apunta a consultoras tipo B.
- **Plan Enterprise:** USD 250/mes hasta 20 usuarios + soporte directo. Apunta a tipo C y consultoras grandes.

Cobro vía Mercado Pago en pesos al tipo de cambio del día.

Cálculo grueso: para alcanzar USD 5.000/mes de MRR (objetivo razonable para validar el modelo) hace falta una mezcla tipo 100 cuentas Pro + 10 Team + 5 Enterprise. Mercado de consultoras HyS solo en Argentina: estimado en miles, no es un techo cercano.

## Por qué esto es vendible ya

Tres señales fuertes:

1. **El experto del audio dijo "está increíble" antes de que le pidiéramos venderlo.** Validación orgánica.
2. **El dolor está bien instalado.** Las multas por Res 299 desactualizada son un caso real, repetido, costoso.
3. **La normativa argentina es relativamente estable** (Ley 19.587 es de 1972, Decreto 351/79 sigue vigente). Una vez que generamos buenos prompts y plantillas, no hay que reescribir cada año.

## Por qué esto puede fallar

1. **Mercado fragmentado.** No hay un canal único para llegar a consultores HyS argentinos (no son LinkedIn-natives mayoritariamente). Hay que ir a foros, colegios profesionales (CPHySA, CIE), grupos de WhatsApp y eventos.
2. **Adopción lenta del rubro.** El consultor freelance promedio es resistente al software pago. Hay que probar con free trial y dogfooding.
3. **Riesgo legal.** Si la app genera un informe con un dato mal calculado y eso causa un accidente, ¿quién es responsable? Hay que ser claros: la app es un asistente, **el profesional firma y es responsable**. El disclaimer ya está en el HTML actual.
4. **Costo de IA si crece rápido.** Un cliente Pro generando 200 informes/mes con Sonnet cuesta USD 6-10 en API. Margen sano pero hay que vigilar.
