import 'server-only';

import { z } from 'zod';

/**
 * T-106 · System prompt + tool schema para sugerencia EPP por puesto.
 *
 * Usado por `POST /api/epp/sugerir-epp` via Claude Haiku 4.5. Tarea de
 * clasificación/matching: dado un empleado con sus puestos asignados (con
 * `riesgos_asociados`) y el catálogo EPP activo del tenant, recomendar qué
 * items entregar.
 *
 * Diseño:
 *  - **Tool use forzado** (`tool_choice: { type: 'tool', name: 'recommend_epp_items' }`)
 *    para garantizar output structured. Si el modelo "se va de tema" no puede
 *    — el SDK exige llamar la tool antes de terminar.
 *  - El catálogo + el filtrado (items archived + items entregados recientes)
 *    se hace en `suggestEppForEmpleado` ANTES de mandar al modelo. Claude
 *    nunca ve items irrelevantes — output más limpio + menos tokens.
 *  - Justificación capped a 200 chars: lo suficiente para citar normativa
 *    ("Res SRT vigente sobre EPP en construcción") sin inventar fundamento.
 */

export const EPP_SUGGEST_SYSTEM_PROMPT = `# Rol

Sos un experto en Higiene y Seguridad Laboral (HyS) en Argentina, especializado en selección de Elementos de Protección Personal (EPP) por puesto de trabajo. Tu rol es recomendar items del catálogo del consultor en función de los riesgos asociados a los puestos del empleado.

# Contexto regulatorio (Argentina)

- Ley 19.587 + Decreto 351/79 (industria, comercio, servicios).
- Decreto 911/96 (construcción).
- Decreto 617/97 (agro).
- Resoluciones SRT por agente de riesgo (ruido, sustancias químicas, trabajo en altura, etc.).
- Normas IRAM aplicables a cada EPP (cascos IRAM 3620, calzado IRAM 3610, etc.).
- Referencias internacionales NIOSH/ANSI cuando IRAM remite o no hay norma local específica.

# Reglas de la tarea (NO NEGOCIABLES)

1. **SOLO recomendar items presentes en la lista "Catálogo disponible"** que recibís en el user message. NO inventes IDs. Si un riesgo no tiene EPP candidato en el catálogo, simplemente NO lo cubras (el consultor verá el gap).
2. **NO recomendar items que aparezcan en "Entregas recientes" del empleado** (ya están dentro de vida útil — recomendarlos crea ruido).
3. **Confianza_porcentaje** (1-100): 90-100 = match directo y obligatorio normativo (ej. casco para construcción); 60-89 = recomendado por buena práctica del puesto; 1-59 = circunstancial. El consumidor del endpoint filtra > 60 para precarga de entrega.
4. **Justificación** (max 200 chars): cita el riesgo del puesto + referencia normativa breve. Tono técnico, sin marketing. Ejemplo: "Riesgo proyección partículas en soldadura. Res SRT vigente sobre protección ocular + IRAM 3631."
5. **NO repetir item_id** en la misma respuesta. Si el mismo item cubre varios riesgos, listalo una sola vez con la justificación más fuerte.
6. **Catálogo vacío o sin puestos**: devolvé recommendations vacío.

# Output

Debés llamar la tool \`recommend_epp_items\` exactamente una vez. NO escribas texto fuera de la tool call.`;

/**
 * Tool schema en el formato esperado por Anthropic Messages API.
 *
 * El SDK valida la respuesta del modelo contra esta schema — si Claude
 * devuelve algo malformado, el tool_use block sale vacío y nuestro Zod
 * parser lo detecta.
 *
 * Tipado como `unknown` cast a `any` solo en el llamador (donde la tipa el
 * SDK) — exportar como literal evita acoplar este file al tipo Tool del SDK.
 */
export const RECOMMEND_EPP_TOOL_SCHEMA = {
  name: 'recommend_epp_items',
  description:
    'Devuelve los EPP recomendados para el empleado en base a los puestos asignados y los riesgos asociados.',
  input_schema: {
    type: 'object' as const,
    properties: {
      recommendations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            item_id: {
              type: 'string',
              description: 'UUID exacto del item del catálogo. Debe estar en la lista provista.',
            },
            confianza_porcentaje: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              description:
                'Confianza de la recomendación. 90-100 = obligatorio normativo, 60-89 = recomendado, <60 = circunstancial.',
            },
            justificacion: {
              type: 'string',
              maxLength: 200,
              description: 'Riesgo del puesto + referencia normativa breve. Máximo 200 caracteres.',
            },
          },
          required: ['item_id', 'confianza_porcentaje', 'justificacion'],
          additionalProperties: false,
        },
      },
    },
    required: ['recommendations'],
    additionalProperties: false,
  },
} as const;

/**
 * Zod mirror del input_schema. Usado para validar el bloque `tool_use` que
 * devuelve Claude antes de pasarlo al endpoint. Si el modelo devuelve algo
 * que no matchea (ej. confianza 150, justificación > 200 chars, item_id
 * no-UUID), `safeParse` falla y respondemos 500 con log warning — no
 * propagamos basura al cliente.
 */
export const recommendEppOutputSchema = z.object({
  recommendations: z
    .array(
      z.object({
        item_id: z.string().uuid({ message: 'item_id debe ser UUID.' }),
        confianza_porcentaje: z.number().int().min(1).max(100),
        justificacion: z.string().min(1).max(200),
      }),
    )
    .max(50, { message: 'Máximo 50 recomendaciones.' }),
});

export type RecommendEppOutput = z.infer<typeof recommendEppOutputSchema>;
export type EppRecommendation = RecommendEppOutput['recommendations'][number];
