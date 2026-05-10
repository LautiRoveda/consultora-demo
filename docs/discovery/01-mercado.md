# Discovery 01 · El mercado de Higiene y Seguridad Laboral en Argentina

Este documento responde tres preguntas: **¿hay mercado?**, **¿cuán grande es?**, y **¿qué dinámica económica tiene?**. Las decisiones de producto, pricing y go-to-market que vengan después se sostienen sobre estos datos.

## Por qué existe este mercado

El mercado de servicios de Higiene y Seguridad Laboral (HyS) en Argentina **no es opcional para los empleadores**. Está creado y regulado por ley:

- **Ley 19.587 (1972)** — Ley de Higiene y Seguridad en el Trabajo. Obliga a todo empleador a velar por las condiciones de trabajo.
- **Ley 24.557 (1995)** — Ley de Riesgos del Trabajo. Crea el sistema de ART (Aseguradoras de Riesgos del Trabajo) y la SRT (Superintendencia de Riesgos del Trabajo).
- **Decreto 351/79** — reglamentario de la Ley 19.587 para industria/comercio/servicios.
- **Decreto 911/96** — análogo para construcción.
- **Decreto 617/97** — análogo para agro.
- **Decreto 1338/96** — define obligatoriamente la **cantidad de horas profesionales mensuales** que cada establecimiento debe destinar a HyS según cantidad de trabajadores y categoría de riesgo.

Consecuencia: cada empleador en Argentina **debe contratar un servicio de HyS** (interno o externo) o quedar fuera de la ley. **Demanda inelástica regulada por ley**. No depende de las preferencias del empleador.

## Tamaño del mercado

### TAM — Total Addressable Market

Datos oficiales de la Unión de Aseguradoras de Riesgos del Trabajo (UART) y de la SRT:

- **Trabajadores cubiertos por el sistema:** ~10,16 millones (promedio 2024, dato UART).
- **17 ART privadas** operativas en Argentina, todas obligadas a financiar prevención y reparación.
- **Siniestralidad 2024:** 532.808 casos reportados (5,24% sobre cubiertos).
- **Litigiosidad 2025:** 132,8 juicios por cada 10.000 trabajadores cubiertos. Alto.
- **Empleadores afiliados estimados:** datos públicos hablaban de >400.000 empleadores en 1998 (a 2 años del sistema). Con crecimiento de la economía y formalización, estimación realista hoy entre **700.000 y 900.000 empleadores afiliados**.

### Distribución sectorial (Feb 2022)

- 27,0 % — Administración Pública / Defensa / Seguridad Social Obligatoria
- 12,5 % — Comercio
- 12,4 % — Industria manufacturera
- 7,4 % — Educación
- 5,3 % — Transporte
- 5,1 % — Servicios administrativos y de apoyo
- 30,3 % — Otros sectores

**Insight:** la administración pública es el bloque más grande (27%), pero es comprado por licitación pública o convenio, no es accesible a una startup B2B. **El target real para nosotros es Industria + Comercio + Transporte + Servicios, que suma ~36% de los trabajadores cubiertos** y se accede vía consultoras y empresas privadas.

### Distribución geográfica (Feb 2022)

- 32,3 % — Provincia de Buenos Aires
- 22,5 % — CABA
- 6,4 % — Santa Fe
- 6,4 % — Córdoba
- 4,4 % — Mendoza
- 28,0 % — Otras provincias

**Insight:** AMBA (BsAs Prov + CABA) concentra el 54,8% del mercado. **Foco inicial obvio.** Córdoba y Rosario son siguientes. El resto del país es disperso, hay que llegar más adelante.

### SAM — Serviceable Addressable Market

Filtrando: empresas privadas medianas y grandes con obligación de profesional HyS asignado, en CABA + provincias top 5.

El Decreto 1338/96 establece que **establecimientos administrativos hasta 200 trabajadores** y **comerciales/servicios hasta 100 trabajadores** pueden estar exceptuados de profesional HyS asignado (aunque siguen obligados a la Ley 19.587). Por ende, la mayor demanda de servicio profesional asignado sale de:

- Industriales (todas)
- Comerciales > 100 trabajadores
- Construcciones (todas, vía Decreto 911/96)
- Servicios > 100 trabajadores
- Agropecuarios (vía Decreto 617/97)

Estimación gruesa SAM: **~250.000 establecimientos privados con obligación activa de servicio HyS profesional**.

### SOM — Serviceable Obtainable Market

Si capturamos **1% del SAM en 3 años** (objetivo realista para una startup B2B SaaS sin venture capital): 2.500 empresas usuarias finales. Pero nuestro modelo no le vende al empleador final — le vende al **consultor que lo atiende**.

### Cantidad de profesionales matriculados

No hay un dato oficial unificado nacional. Hay **14 Colegios y Consejos provinciales** que matriculan profesionales HyS. Los más grandes:

- **COPIME** (CABA + Buenos Aires)
- **COPHISEC** (Córdoba)
- **CPHySTCh** (Chaco)
- Consejo HyS San Juan
- Otros 10 consejos provinciales

**Estimación gruesa de profesionales activos a nivel país: 30.000–50.000 matriculados**, de los cuales una porción (~20-30%) ejerce activamente como consultor (los demás trabajan en relación de dependencia interna en empresas grandes o en educación).

**Universo de consultores activos potencialmente target: ~10.000–15.000 personas en todo el país.**

## Dinámica económica

### Lo que cobra el profesional

Tabla del Colegio HyS Argentina (referencias 2025):

- **Valor hora técnico (normal)**: $13.000 ARS (ene-mar 2025) → $14.000 ARS (abr-jun 2025).
- Al tipo de cambio promedio mayo 2026 (~$1.300 ARS/USD): ≈ **USD 11 por hora**.

Una visita típica a un cliente (relevamiento + medición + redacción de informe) lleva 4-8 horas → USD 45-90 facturable. Un consultor con 10-15 clientes activos genera ingresos brutos de USD 1.500–4.000/mes según tipo de atención.

### Asignación obligatoria de horas (Dec 1338/96)

El decreto define categorías de riesgo A, B, C con tablas que fuerzan al empleador a contratar tantas horas mensuales según cantidad de "trabajadores equivalentes" y categoría:

| Categoría | Riesgo | Ejemplos |
|-----------|--------|----------|
| A | Bajo | Comercio, oficinas, servicios |
| B | Medio | Hotelería, supermercados |
| C | Alto | Industria, construcción, química |

Personal técnico auxiliar:

- 150-450 trabajadores equivalentes → 1 técnico
- 451-900 → 2 técnicos
- +500 sobre 901 → 1 técnico adicional

Esta tabla **define la base de demanda mensual obligatoria** del mercado.

### Lo que cobra una consultora externa

Para una empresa industrial de 50-100 trabajadores en categoría B/C, el abono mensual de servicio HyS externo está aproximadamente entre **USD 250 y USD 800**. Depende fuertemente de la complejidad de la actividad y la cantidad de visitas mensuales.

Esto significa que **un consultor con 10 clientes industriales factura en el rango USD 2.500-8.000/mes**. La comisión que pagaría a una herramienta SaaS de gestión que le ahorre tiempo y le proteja de multas es **proporcionalmente baja** — USD 30-60/mes es < 1% de su facturación.

## Cómo se vende este servicio hoy

El consultor consigue clientes principalmente por:

1. **Recomendación entre empresas** (boca a boca tradicional)
2. **Convenio con ART** — algunas ART derivan consultores a sus afiliados con descuento
3. **Conexiones del colegio profesional**
4. **LinkedIn / web propia** (creciente pero minoritario)

**No hay marketplace central.** No hay equivalente argentino a Yelp para HyS. No hay agregador. Esto es importante: las herramientas que les llegan al consultor son las que sus colegas usan o las que les recomiendan en charlas y eventos del colegio.

## Tendencias del mercado

### A favor de un producto SaaS con IA

- **Litigiosidad alta y creciente** (132,8 juicios cada 10.000 cubiertos en 2025). Los empleadores tienen miedo de juicios laborales por negligencia. Necesitan respaldo documental impecable. Una herramienta que dé "resguardo" tiene tracción emocional.
- **Inflación obliga a digitalizar costos.** Las consultoras pequeñas pierden plata cuando un técnico hace papeleo durante 4 horas pagado a USD 11/h.
- **Adopción incipiente de IA en otros rubros profesionales** (contadores, escribanos, abogados con ChatGPT). Crea aceptación social del concepto.
- **Pandemia normalizó software remoto / multi-dispositivo**. La barrera "no entiende computadoras" cayó fuerte 2020-2024.

### En contra

- **Heterogeneidad de cumplimiento** entre regiones y rubros. Muchas empresas chicas operan informalmente o cumplen mínimo.
- **Empleo informal alto** (~35-40% de la economía argentina). Esos trabajadores quedan fuera del sistema ART y por lo tanto fuera del mercado HyS formal.
- **PYMEs con poco presupuesto** para herramientas profesionales.
- **Resistencia tradicional al pago por software** en consultores formados antes de 2010.
- **Conservadurismo del sector regulado**: las herramientas se adoptan despacio. Hay que demostrar que la herramienta cumple normativa antes de que la usen.

### Riesgo regulatorio

La SRT cambia regulaciones con cierta frecuencia (Resoluciones 41/2025, 34/2025, 12/2026 son ejemplos recientes). Una herramienta que genere informes debe tener un proceso de actualización ágil cuando cambia la norma. Si nuestro template de Res 85/12 queda desactualizado, el cliente firma un informe inválido. **Riesgo de producto: alto. Mitigable con monitoreo activo de boletines SRT.**

## Mapa del valor en la cadena

```
Empleador (paga obligatoriamente, USD 250-800/mes)
    │
    ▼
Consultora HyS o profesional freelance (factura USD 250-800 por cliente)
    │ usa hoy: Excel + WhatsApp + Word + papel
    │
    ▼
ConsultoraDemo (cobra USD 30-60/mes al consultor)
    │
    ▼
Infraestructura técnica (Vercel + Supabase + Claude API)
```

**Donde está la plata: en el consultor**, no en el empleador. El empleador no es nuestro cliente. **Nuestro cliente es el profesional o consultora que provee el servicio.** Esto define enormemente cómo construimos el producto: tiene que multiplicar la productividad del consultor, no reemplazar al empleador.

## Conclusiones para el producto

1. **Mercado existe y es grande.** El TAM son ~10 millones de trabajadores cubiertos en >700.000 empleadores. El SAM target son ~250.000 establecimientos. Llegar al 1% es realista en 3 años.

2. **Demanda regulada e inelástica.** No hay que convencer a nadie de que necesita HyS — la ley lo obliga. Solo competimos por **cuál herramienta usa el consultor para hacer el trabajo**.

3. **Foco geográfico inicial: AMBA** (54,8% del mercado). Después Córdoba y Rosario. No diversificar provincias en los primeros 18 meses.

4. **Foco sectorial inicial: industria + construcción + servicios privados**. Evitar administración pública (licitaciones largas y opacas) hasta tener tracción privada.

5. **El cliente es el consultor profesional**, no el empleador final. Producto B2B SaaS dirigido al matriculado. Pricing pensado en su poder adquisitivo (USD 30-60/mes es menos del 1% de su facturación, sweet spot).

6. **El pitch es resguardo legal y ahorro de tiempo, en ese orden.** La litigiosidad alta y las multas son el dolor económico real. La productividad es el plus.

7. **Riesgo regulatorio mitigable.** Tenemos que monitorear cambios SRT mensualmente y actualizar templates con prioridad. Esto puede ser un servicio diferenciado (USD adicional para "siempre actualizado") o un commitment incluido en el plan Pro.

## Preguntas de discovery que esto deja abiertas

Las contestamos en las etapas siguientes:

- **¿Qué porción de los consultores hoy ya pagan por algún software de gestión?** (Etapa 3 — competencia)
- **¿Cuáles son las objeciones específicas que pondrían a pagar USD 30/mes?** (Etapa 2 — entrevistas adicionales)
- **¿Cómo prefieren descubrir software nuevo?** Newsletter del colegio, charlas, recomendación de pares, LinkedIn. (Etapa 4 — go-to-market)
- **¿La diferenciación con IA generativa es percibida como valor o como gimmick?** Necesita validación con 5-10 entrevistas más.

## Fuentes

Datos de este documento provienen de:
- Sitios oficiales SRT y argentina.gob.ar
- Boletines y comunicados UART (Unión de Aseguradoras de Riesgos del Trabajo)
- Tablas de honorarios mínimos del Colegio HyS Argentina (2025)
- Decreto 1338/96 anexo (carga horaria por trabajador equivalente)
- Reportes de TodoRiesgo y Tiempo de Seguros sobre el sector ART
