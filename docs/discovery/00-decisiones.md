# Discovery 00 · Registro de decisiones tomadas

Lista acumulativa de decisiones de producto y negocio que se van confirmando durante el discovery. Cada decisión queda con fecha y contexto. Si más adelante hay que revisarla, se actualiza con motivo.

---

## D01 · Cliente target: el consultor profesional, no el empleador final

**Fecha:** 2026-05-09
**Contexto:** Etapa 1 — análisis de mercado.
**Decisión:** El producto se vende al **profesional matriculado en HyS** o a la consultora que da el servicio, no al empleador final. El empleador es el cliente del consultor; nosotros somos la herramienta del consultor.
**Implicancia:** pricing pensado en la economía del consultor (USD 30-60/mes ≈ <1% de su facturación), no en la economía del empleador (que paga al consultor USD 250-800/mes).

## D02 · Foco geográfico inicial: AMBA

**Fecha:** 2026-05-09
**Contexto:** Etapa 1 — distribución del mercado argentino.
**Decisión:** Foco en CABA + Provincia de Buenos Aires (54,8% del mercado). Después Córdoba y Santa Fe. No diversificar provincias en los primeros 18 meses.
**Implicancia:** marketing y go-to-market focalizado en AMBA. Templates legales con prioridad CABA + PBA.

## D03 · Foco sectorial: industria + comercio + servicios privados + construcción

**Fecha:** 2026-05-09
**Contexto:** Etapa 1 — distribución del mercado argentino.
**Decisión:** Excluir Administración Pública del target (27% del mercado pero con licitaciones largas). Foco en privado: industria manufacturera, comercio, transporte, servicios, construcción.
**Implicancia:** templates legales y marketing dirigidos a esos rubros. Decreto 351/79 + 911/96 son los marcos prioritarios; 617/97 (agro) es secundario.

## D04 · Pitch principal: resguardo legal — pitch secundario: productividad

**Fecha:** 2026-05-09
**Contexto:** Etapa 1 — litigiosidad alta (132,8 juicios cada 10.000 trabajadores en 2025) + insights del experto del audio.
**Decisión:** El argumento de venta principal es **proteger al consultor de multas, juicios y responsabilidad civil**. El argumento secundario es ahorro de tiempo. La palabra clave que usa el experto, "resguardo", debe estar en el copy.
**Implicancia:** features de respaldo legal (firmas con timestamp, GPS, audit log inmutable, registro de versiones de normas usadas) son prioritarios sobre features de productividad pura.

## D05 · Versionado de normas SRT con libre elección

**Fecha:** 2026-05-09
**Contexto:** discusión sobre cómo manejar cambios normativos.
**Decisión:** El sistema mantiene **múltiples versiones** de cada protocolo normativo (ej: Res 85/12, eventual 85/26). Cuando el consultor genera un informe, elige libremente con cuál norma quiere generarlo. La app sugiere por defecto la última vigente, pero **no impone**. Cada informe queda guardado con la versión utilizada y la fecha de vigencia, dejando trazabilidad legal.
**Implicancia:** modelo de datos requiere tabla `template_versions` con `vigencia_desde` y `vigencia_hasta`. Cada `informe` guarda FK a la versión que usó. La UX siempre muestra qué versión está en uso. Si se elige una versión no vigente, la app advierte pero no bloquea.
**Trade-off aceptado:** mayor mantenimiento normativo (15-25 horas anuales) a cambio de flexibilidad real para el consultor durante períodos de transición o auditorías retrospectivas.

## D06 · Comparación de versiones de normativa con IA

**Fecha:** 2026-05-09
**Contexto:** consecuencia natural del versionado.
**Decisión:** Si tenemos múltiples versiones cargadas, le ofrecemos al consultor la posibilidad de **comparar dos versiones cualesquiera** y obtener un resumen de los cambios (qué artículo cambió, qué se agregó, qué se eliminó), generado por IA.
**Implicancia:** feature de altísimo valor percibido y costo casi nulo (un prompt sobre dos textos). Diferencial vs. competencia que probablemente tiene una sola versión hardcodeada.

## D08 · Foco del producto: generación de informes + calendario de vencimientos

**Fecha:** 2026-05-09
**Contexto:** consulta directa al dueño del proyecto sobre qué dolor priorizar.
**Decisión:** El producto no se construye como una suite EHS genérica. **Se construye como dos pilares core**:

1. **Generación de informes asistida por IA** — protocolos legales (ruido, iluminación, PAT, RGRL, carga de fuego, etc.), con versionado de normas y elección libre de versión.
2. **Calendario inteligente de vencimientos** — alertas proactivas antes de que algo se venza. Ejemplos:
   - Protocolos anuales que vencen a los 12 meses.
   - Entregas de EPP que se renuevan obligatoriamente cada 6 meses (Resolución SRT 299/11) — alerta a los 5 meses.
   - Capacitaciones obligatorias periódicas.
   - Calibración de instrumental.
   - Cualquier evento recurrente que el consultor decida cargar manualmente.

Ambos pilares se cruzan: cuando un informe se firma, se programa automáticamente su próxima renovación en el calendario. Cuando una entrega de EPP se registra, idem.

**Implicancia para Fase 1:** las features prioritarias son únicamente esos dos pilares + auditoría defensible (timestamp, GPS, firma, versión de norma). Lo demás se posterga:
- ❌ **Postergado** — Permisos de trabajo diarios (Sergio), kit de jornada multi-documento, dashboard de equipo (Diego), repositorio documental con OCR, capacitaciones automáticas, análisis de accidentabilidad, visión computacional, asistente conversacional.
- ✅ **Incluido en Fase 1** — Generación de informes (refinada), tracking de EPP con alertas a 6 meses, calendario unificado de vencimientos de protocolos, libre elección de versión normativa, auditoría defensible básica (firma + timestamp).

**Por qué esta decisión es estratégica:** los competidores que vimos (SGO Suite, Genesis, Vector EHS) son CRM/SaaS pesados que intentan cubrir 50 features y resultan caros y complejos. Apuntar a dos features hechas mejor que nadie da diferencial claro y producto vendible más rápido.

**Pitch resultante:** "tu app que escribe los informes en 5 minutos y te avisa antes de que se te venza algo".

## D07 · Monitoreo normativo incluido en todos los planes pagos, diferenciado por nivel

**Fecha:** 2026-05-09 (pendiente de confirmación final)
**Contexto:** consecuencia del versionado + necesidad del consultor de enterarse cuando cambia algo.
**Decisión propuesta:**
- **Plan Pro (USD 30):** notificación general semanal — "estas resoluciones cambiaron en tu rubro esta semana".
- **Plan Team y Enterprise:** notificación inmediata con diff explícito (qué frase cambió en la norma anterior) y flag automático en informes históricos que quedaron generados con norma desactualizada.
**Implicancia:** facilita venta del Pro (no es feature pago aparte), y el monitoreo activo + flagging automático justifica el upgrade a Team/Enterprise.
**Estado:** pendiente de confirmación final cuando lleguemos a Etapa 4 (pricing).

---

## Decisiones técnicas tomadas (válidas pero subordinadas a discovery final)

Estas se tomaron en una iteración previa antes del reset de enfoque. Se mantienen como **propuestas técnicas vigentes** mientras no aparezca evidencia que las contradiga durante el discovery.

- **PWA web instalable, no app nativa.** Justificación en docs/04-architecture.md (versión previa al reset).
- **Stack Next.js + Supabase + Vercel.** Idem.
- **Multi-tenancy con RLS desde día cero.** Idem.
- **IA siempre desde el backend, nunca del cliente.** Idem.
- **Mercado Pago para suscripciones recurrentes.** Idem.

Estas decisiones se reconfirman al cerrar Etapa 4 con los requerimientos definitivos.
