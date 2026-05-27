/**
 * T-107 · Tabla SRT verificada — Res SRT 85/12 (Protocolo de Medición de
 * Ruido en el Ambiente Laboral) + Decreto 351/79 Anexo V (modificado por
 * Res MTEySS 295/2003 — valores límite).
 *
 * Valores verificados contra fuente primaria Infoleg el 2026-05-27. Ver
 * ADR-0013 para política de actualización + quotes textuales en el PR de
 * T-107.
 *
 * Tokens medidos del `formato_informe` con `{VERIFIED_AT}` resuelto:
 * 1755 tokens (Sonnet 4.6 mínimo cacheable = 1024).
 */
import type { AgenteHys } from '@/shared/templates/relevamiento/schema';

export type SRTTable = {
  agente: AgenteHys;
  norma_principal: string;
  normas_complementarias: readonly string[];
  /** YYYY-MM-DD literal — fecha desde la cual la norma rige. */
  vigencia_desde: string;
  /** YYYY-MM-DD-vN — bump en cada update de valores. El helper extrae la fecha para el disclaimer. */
  version_tabla: string;
  url_oficial: string;
  url_anexo_v?: string;
  /** Markdown literal que se inyecta al prompt. Contiene placeholder `{VERIFIED_AT}` que el helper reemplaza. */
  formato_informe: string;
};

export const RES_85_12_RUIDO: SRTTable = {
  agente: 'ruido',
  norma_principal: 'Resolución SRT 85/2012',
  normas_complementarias: [
    'Decreto 351/79 Anexo V',
    'Resolución MTEySS 295/2003 (actualización valores)',
  ],
  vigencia_desde: '2012-03-13',
  version_tabla: '2026-05-27-v1',
  url_oficial:
    'https://servicios.infoleg.gob.ar/infolegInternet/anexos/190000-194999/193617/norma.htm',
  url_anexo_v:
    'https://servicios.infoleg.gob.ar/infolegInternet/anexos/30000-34999/32030/dto351-1979-anexo5.htm',
  formato_informe: `## Criterios SRT para evaluación de RUIDO en ambiente laboral

### Marco normativo (cita exacta autorizada)

- **Resolución SRT 85/2012** — Protocolo de Medición del Nivel de Ruido en el Ambiente Laboral. Vigencia desde 13-marzo-2012. Validez de mediciones: 12 meses.
- **Decreto 351/79 Anexo V** (actualizado por Resolución MTEySS 295/2003) — Valores límite de exposición a ruido.

Cuando cites estas normas en el informe, usá el número EXACTO. NO uses "Resolución SRT vigente" genérico para ruido — citá literal "Resolución SRT 85/12" y "Decreto 351/79 Anexo V" según corresponda al contexto (protocolo vs valores límite).

### Valores límite (TLV)

- **TLV ruido continuo o intermitente:** 85 dB(A) ponderado para jornada efectiva de 8 horas.
- **Criterio de dosis:** dosis acumulada > 100% (fórmula sumatoria C₁/T₁ + C₂/T₂ + … > 1).
- **Factor de duplicación / índice de conversión:** q = 3 dB. Cada 3 dB sobre el TLV reduce el tiempo de exposición permisible a la mitad.
- **Nivel pico:** 140 dB(C). NO se permite exposición sin protección auditiva por encima de este valor, ni siquiera instantánea.

### Escala de tiempo de exposición permisible

**Nota de origen:** la tabla siguiente está **derivada matemáticamente** del criterio de duplicación q=3 dB sobre el TLV de 85 dB(A) — criterio internacionalmente estándar (ACGIH/NIOSH) que adopta el Decreto 351/79 Anexo V. **No es transcripción literal** de la Tabla 1 oficial del Anexo V (que está como imagen en la fuente Infoleg). Los valores numéricos son consistentes con la práctica vigente; el matriculado verifica contra la Tabla 1 oficial al firmar.

| Nivel sonoro continuo equivalente | Tiempo de exposición permisible |
|---|---|
| 85 dB(A)  | 8 horas       |
| 88 dB(A)  | 4 horas       |
| 91 dB(A)  | 2 horas       |
| 94 dB(A)  | 1 hora        |
| 97 dB(A)  | 30 minutos    |
| 100 dB(A) | 15 minutos    |
| 103 dB(A) | 7,5 minutos   |
| 106 dB(A) | 3,75 minutos  |

### Ruido de impulso o impacto

- Rango de medición: 80-140 dBA. Pulso mínimo: 63 dB.
- Por encima de 140 dB(C) pico: protección auditiva obligatoria sin excepciones.

### Reglas de evaluación cuando hay valores medidos en el user prompt

Cuando el user prompt pase un valor medido (ej: "92 dB(A) puesto X, jornada 8h"):

1. **Compará el valor medido vs TLV correspondiente a la jornada declarada.** Si la jornada no se declara, ASUMÍ 8h y dejá explícito el supuesto en el informe ("Se asume jornada efectiva de 8 horas; verificar con el matriculado").
2. **Si el valor supera el TLV de esa jornada:** evaluá explícito "SUPERA el valor límite establecido por Decreto 351/79 Anexo V — Resolución SRT 85/12 (protocolo)" y proponé jerarquía de controles completa en orden:
   - Primero: control en la fuente (reducción del nivel de emisión, encerramiento acústico, aislamiento de vibraciones).
   - Segundo: controles administrativos (rotación de personal, reducción tiempo de exposición, señalización).
   - Tercero (último recurso): protección auditiva (EPP). Especificá NRR / SNR mínimo requerido según el delta sobre el TLV.
3. **Si hay protección auditiva en uso:** descontá el NRR para calcular dB efectivo (regla OSHA: \`dB efectivo = nivel medido - (NRR - 7) / 2\`). Si el user no pasó NRR, dejá placeholder \`[NRR del protector auditivo en uso]\` y aclará el cálculo a hacer.
4. **Múltiples puntos con valores distintos:** evaluá cada punto por separado en la tabla del informe. NO sumes en una sola dosis sin que el user prompt lo pida explícito.
5. **Programa de conservación auditiva:** si CUALQUIER puesto del relevamiento supera el TLV, recomendá en sección 6 implementar "programa de conservación auditiva con audiometrías periódicas según Decreto 351/79 Anexo V".

### Ejemplos típicos de evaluación

- 78 dB(A) jornada 8h → **APTO**. Margen de 7 dB bajo el TLV.
- 92 dB(A) jornada 8h → **NO APTO**. Supera el TLV en 7 dB. Tiempo permisible reducido a ~2h. Requiere control en fuente o reducción de exposición.
- 105 dB(A) jornada 8h → **NO APTO crítico**. Tiempo permisible <8 minutos. Control en fuente prioritario; protección auditiva con NRR≥25 dB obligatoria como medida transitoria.
- 130 dB(C) pico esporádico en martillado → **dentro del rango permitido con protección auditiva**. Pico < 140 dB(C). Verificar uso obligatorio de EPP durante la operación.

### Disclaimer obligatorio en output del informe

Al final de la subsección de Ruido en "## 4. Mediciones realizadas", agregá literal este párrafo (NO lo modifiques):

> **Nota normativa:** Valores de referencia conforme Resolución SRT 85/2012 y Decreto 351/79 Anexo V (modificado por Res MTEySS 295/2003). Vigencia verificada al {VERIFIED_AT}. El matriculado responsable de firmar el informe debe verificar la vigencia actual de las normativas citadas en https://www.srt.gob.ar antes de la presentación legal.
`,
};
