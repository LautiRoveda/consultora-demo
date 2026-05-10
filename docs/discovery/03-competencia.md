# Discovery 03 · Análisis de competencia

Análisis de quién compite específicamente con nuestros dos pilares core (D08): **generación de informes asistida por IA + calendario de vencimientos con alertas**. Excluimos suites EHS pesadas que cubren 50 features porque no son el mismo producto que el nuestro.

## Cómo segmentamos a la competencia

Los dividimos en cuatro categorías según contra qué de nuestro producto compiten directamente:

1. **Suites EHS internacionales** — cubren todo, son caros, target enterprise.
2. **Suites EHS regionales LATAM** — versión más accesible, target mid-market.
3. **Apps verticales de gestión EPP/formularios** — más cerca de nosotros, foco PYME.
4. **La "no-solución"** — Excel + Drive + WhatsApp + papel. Es lo que la mayoría usa hoy.

## Competidores directos identificados

### ZYGHT (Chile, opera en LATAM)

- Plataforma HSE multi-país. 10+ años en el mercado.
- Clientes en Chile, Perú, Argentina, Colombia, México, Ecuador, Panamá.
- Tiene módulo de **control de EPP con alertas automáticas de vencimiento** y certificaciones, lo cual es competencia directa para nuestro pilar 2.
- También tiene generación de informes pero NO IA generativa.
- Pricing: estimado USD 2.000-10.000/mes según número de usuarios y módulos. **No publica precios** ("contactanos para cotizar"). Target enterprise grande.
- **Debilidad para nosotros:** caro, complejo, target enterprise. Ningún freelancer argentino paga eso.

### Vector EHS Management (USA, internacional)

- Software web altamente configurable.
- Genera tendencias y reportes, sin IA generativa.
- Target enterprise multinacional. Pricing similar a ZYGHT (no público, USD 2.000-10.000/mes estimado).
- **Debilidad:** no tiene normativa argentina específica (no maneja Res 299, Res 84/12, 85/12, ni los decretos 351/79, 911/96, 617/97).

### SGO Suite (Argentina)

- Especializado en sistemas de gestión ISO 9001, ISO 14001, ISO 45001.
- Foco en gestión documental y procesos, no en generación.
- Target medium-enterprise argentino con sistemas certificados.
- Pricing estimado USD 500-3.000/mes. No público.
- **Debilidad para nosotros:** se posiciona como "software para implementar ISO", no para el día a día del consultor. Le hablan al departamento de calidad de la empresa, no al consultor de HyS.

### Binaps Suite (multi-país, presencia Argentina)

- Software para múltiples sistemas de gestión (ISO 45001, 9001, 14001, 27001, etc.).
- Pricing personalizado, no público.
- Foco amplio en sistemas de gestión, no específico HyS argentino.

### Safetynova (Argentina)

- Plataforma para digitalizar inspecciones, auditorías, formularios.
- Convierte Excel/papel en formularios inteligentes.
- Modelo freemium / gratis con upsell.
- **Más cercano a nosotros pero foco distinto:** ellos son una herramienta de captura de datos en campo, no un generador de informes con IA ni un sistema de alertas de vencimiento. Sus formularios reemplazan el papel pero el consultor sigue redactando informes a mano.

### Kizeo Forms (LATAM/Francia)

- App de formularios digitales con automatización.
- Tiene plantillas de **entrega de EPP** con firma digital, foto, reportes automáticos.
- Pricing USD 12-30 por usuario/mes (público y accesible — único de la lista).
- **El competidor más cercano a nuestro pilar 2.** Pero es genérico (forms para cualquier industria), no específico HyS argentino. No genera informes con IA.

### WiiProt

- Plataforma vertical de gestión EPP, foco LATAM.
- Tiene tracking, vencimientos, registro de entregas.
- Pricing no público.

## La "no-solución" — qué usa hoy el 80% del mercado

El ecosistema real de Marina (Persona A) y la mayoría de los consultores chicos:

- **Excel** para listas, mediciones, agendas.
- **Word** para informes y plantillas.
- **Google Drive / OneDrive** para almacenar.
- **WhatsApp** para comunicación con clientes y entre el equipo.
- **Calendar** (Google) para agendarse visitas.
- **Cámara del celular** para evidencia fotográfica.
- **Papel** para mediciones en campo y firmas de EPP.

Esta combinación **no cuesta nada** y **no avisa nada**. Es la competencia más fuerte que tenemos: no porque sea buena, sino porque es lo que la gente ya conoce y usa, y "lo gratis" siempre tiene fricción cero.

**El verdadero argumento de venta no es "somos mejor que ZYGHT" — es "te liberás del Excel y nunca más se te pasa una fecha".**

## Tabla comparativa

| | ZYGHT | Vector EHS | SGO Suite | Binaps | Kizeo Forms | Safetynova | Excel+WhatsApp | **ConsultoraDemo (propuesto)** |
|--|--|--|--|--|--|--|--|--|
| Origen | Chile | USA | Argentina | Multi | Francia | Argentina | — | Argentina |
| Generación informes con IA | No | No | No | No | No | No | No | **Sí (core)** |
| Versionado de normas | Limitado | Limitado | Limitado | Limitado | No | No | No | **Sí, libre elección** |
| Tracking EPP con alertas | Sí | Limitado | Limitado | Limitado | Sí | No | No | **Sí (core)** |
| Calendario de vencimientos protocolos | Limitado | Sí | Limitado | Limitado | No | No | No | **Sí (core)** |
| Normativa argentina específica | Parcial | No | Sí | Parcial | No | Sí | — | **Sí, foco** |
| Foco en consultor freelance/PYME | No | No | No | No | Parcial | Sí | — | **Sí, foco** |
| Pricing público | No | No | No | No | **Sí** | Freemium | — | **Sí (decisión)** |
| Pricing estimado/mes | USD 2.000-10.000 | USD 2.000-10.000 | USD 500-3.000 | USD 500-3.000 | USD 12-30/user | Free + upsell | $0 | USD 30-300 |
| PWA / funciona offline | No | Limitado | No | No | Sí | Sí | — | **Sí (Fase 3)** |

## Hueco de mercado identificado

Cruzando las dimensiones, hay un hueco muy claro:

**Producto vertical, especializado en Argentina, con IA generativa core, pricing público y bajo, target consultor freelance / consultora chica.**

Nadie hace exactamente eso hoy. Los competidores se distribuyen así:
- ZYGHT, Vector → enterprise grande, pricing alto, sin IA, generalistas LATAM.
- SGO Suite, Binaps → medium enterprise argentino, foco ISO, sin IA, complejos.
- Kizeo Forms → más accesible pero genérico (forms), no HyS específico, sin IA.
- Safetynova → freemium, foco captura, no generación.
- Excel+WhatsApp → todo el resto del mercado.

**El consultor freelance argentino con 10 clientes hoy no tiene opción real**. ZYGHT es 50 veces lo que puede pagar; SGO es para empresas; Kizeo es genérico y no entiende argentina; Safetynova no le genera informes; Excel le come el día.

## Tres ventajas competitivas defendibles

Si construimos bien, tenemos tres ventajas que el competidor no puede copiar fácilmente:

**1. IA generativa de informes específica argentina.** Requiere prompts curados con normativa local, mantenimiento mensual de templates cuando cambian las resoluciones SRT, y feedback loop con consultores reales. Una empresa internacional como ZYGHT puede agregar "IA" como feature, pero les llevaría años entender las particularidades de Res 84/12 vs Res 85/12 vs decreto 351/79. Para nosotros es el día uno.

**2. Versionado de normas con elección libre.** Decisión D05. Los competidores generalmente tienen una sola versión hardcodeada. Nuestro versionado + IA que compara versiones es feature wow + diferenciador real.

**3. Pricing transparente y bajo.** Decisión que aún no tomamos formalmente pero todo el discovery la sugiere. Si publicamos USD 30/mes en home page mientras ZYGHT requiere "contactar comercial" para enterarse del precio, ganamos en el funnel desde el primer día.

## Lo que NO hay que confundir

- **No competimos con ZYGHT por sus clientes enterprise.** Sus clientes son grandes, están atados a SAP, tienen director de seguridad full-time. No es nuestro target. Solo nos interesa que ZYGHT exista para mostrar que el mercado es real y que enterprise paga por esto.

- **No competimos con consultoras locales (Previnnova, Inpresma, MLC).** Esas son consultoras de HyS, no software. Si las miramos como cliente potencial: Diego (Persona B) podría ser una de ellas. Si las miramos como competidor: solo si ofrecen su propio software a clientes externos, lo cual algunas hacen pero como upsell de su servicio principal.

- **Cuidado con Safetynova.** Es el competidor más cercano en filosofía (foco PYME argentino, accesible). Si ven que crecemos pueden entrar al segmento. Pero hoy su producto no genera informes ni alerta vencimientos — está limitado a captura. Nuestro foco en IA + calendario es defendible mientras seamos los primeros en hacerlo bien.

## Estrategia de posicionamiento recomendada

**Mensaje único:**
> "El asistente argentino que escribe los informes y se acuerda de tus vencimientos. Para consultores HyS que no pueden pagar SAP."

**Tres puntos de venta visibles desde la landing page:**
1. *"Informes técnicos generados con IA en 5 minutos."*
2. *"Calendario que avisa antes de la multa, no después."*
3. *"USD 30/mes, sin llamar a un comercial."*

Eso lee distinto a la competencia y se posiciona en un hueco real.

## Preguntas que esto deja para Etapa 4

- **¿Qué pricing público publicamos?** USD 30 (Pro), USD 100 (Team), USD 250 (Enterprise) parece la dirección correcta pero hay que confirmar.
- **¿Cuándo vamos a un freemium para destrabar adopción?** Los grupos de WhatsApp del rubro funcionan con boca a boca; un freemium puede acelerar.
- **¿Tenemos que prepararnos para que ZYGHT o SGO bajen el precio para competir?** Probablemente no en los primeros 12-18 meses; ellos no nos van a ver como amenaza hasta que crezcamos. Tiempo suficiente para hacer fortaleza de marca.

Sources:
- [ZYGHT — Software HSE en Argentina](https://somos.zyght.com/software-hse-argentina)
- [ZYGHT — Control digital de EPP](https://zyght.com/blog/es/control-de-elementos-de-proteccion-personal-epp-con-tecnologia-digital-2/)
- [Capterra — ZYGHT pricing y comparativas](https://www.capterra.com/p/165637/ZYGHT-HSEQ-technology/)
- [SGO Suite Consultora](https://sgoconsultora.com.ar/service/sgo-suite/)
- [Binaps Suite — features](https://ayudas.binaps.com/qu%C3%A9-es-binaps-suite)
- [Safetynova — digitalización inspecciones](https://safetynova.com/digitalizacion/)
- [Kizeo Forms — app entrega EPP](https://www.kizeo-forms.com/lat/plantillas-formularios/app-para-entrega-de-epp/)
- [WiiProt — gestión EPP](https://www.wiiprot.com/es/post/beneficios-digitalizar-procesos-de-entrega-de-epps)
- [Comparasoftware — 10 mejores SG-SST Argentina](https://www.comparasoftware.com.ar/software-sg-sst)
