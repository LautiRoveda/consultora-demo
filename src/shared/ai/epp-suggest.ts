import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';

import { env } from '@/env';
import { logger } from '@/shared/observability/logger';

import { getAnthropicClient } from './anthropic';
import {
  EPP_SUGGEST_SYSTEM_PROMPT,
  RECOMMEND_EPP_TOOL_SCHEMA,
  recommendEppOutputSchema,
} from './prompts/epp-suggest';

/**
 * T-106 · `suggestEppForEmpleado` — orquesta la sugerencia IA de EPP por puesto.
 *
 * Flow:
 *  1. Carga el empleado (RLS-scoped — cross-tenant devuelve `not_found`).
 *  2. Carga puestos asignados con `riesgos_asociados` (excluye archivados).
 *  3. Carga catálogo EPP activo del tenant (filtra `archived_at IS NULL`).
 *  4. Carga últimas entregas del empleado por item; computa items "frescos"
 *     (`now - fecha_entrega < vida_util_meses`) y los filtra del catálogo.
 *  5. Llama Claude Haiku 4.5 con tool_use forzado.
 *  6. Valida output con Zod, filtra item_ids fuera del catálogo (defensa
 *     contra alucinación), enriquece con nombre + categoría.
 *  7. Loggea structured: tokens + cost estimado USD.
 *
 * **No persiste nada** — la sugerencia es runtime. Si el user crea entrega
 * después, queda registrada por el flow normal de `createEntregaAction`.
 *
 * Discriminated union de retorno → la route handler decide HTTP status sin
 * checks por reason string mágica.
 */

// Haiku 4.5 pricing (USD por 1M tokens). Hardcoded — si el env var override
// apunta a otro modelo, el cost estimate queda mid-low pero el cliente lo
// nota en el feedback del muestreo. Update cuando agreguemos otro lite model.
const HAIKU_INPUT_PRICE_PER_M = 1.0;
const HAIKU_OUTPUT_PRICE_PER_M = 5.0;

// Cap defensivo: si el empleado tiene > 10 puestos o el catálogo > 100 items,
// truncamos el prompt para no quemar tokens. Casos realistas están muy debajo.
const MAX_PUESTOS_EN_PROMPT = 10;
const MAX_ITEMS_EN_PROMPT = 100;

type EmpleadoBasic = {
  id: string;
  nombre: string;
  apellido: string;
  dni: string;
};

type PuestoConsiderado = {
  puesto_id: string;
  nombre: string;
  descripcion: string | null;
  riesgos: string[];
};

type CatalogoItem = {
  id: string;
  nombre: string;
  categoria_nombre: string;
  normativa: string | null;
  vida_util_meses: number;
  marca_default: string | null;
  modelo_default: string | null;
};

type EntregaReciente = {
  item_id: string;
  item_nombre: string;
  fecha_entrega: string;
  vida_util_meses: number;
  vence_aprox: string;
};

export type EnrichedSuggestion = {
  item_id: string;
  item_nombre: string;
  categoria_nombre: string;
  confianza_porcentaje: number;
  justificacion: string;
};

export type SuggestEppOk = {
  kind: 'ok';
  empleado: EmpleadoBasic;
  puestosConsiderados: PuestoConsiderado[];
  catalogoConsideradoCount: number;
  recientesExcluidos: EntregaReciente[];
  suggestions: EnrichedSuggestion[];
  tokens: { input: number; output: number; cost_usd: number };
  model: string;
};

export type SuggestEppResult =
  | SuggestEppOk
  | { kind: 'empleado_not_found' }
  | { kind: 'no_puestos'; empleado: EmpleadoBasic }
  | { kind: 'no_catalogo'; empleado: EmpleadoBasic; puestosConsiderados: PuestoConsiderado[] }
  | { kind: 'ai_parse_error'; empleado: EmpleadoBasic; usage: { input: number; output: number } };

export async function suggestEppForEmpleado(args: {
  empleadoId: string;
  consultoraId: string;
  supabase: SupabaseClient<Database>;
}): Promise<SuggestEppResult> {
  const { empleadoId, consultoraId, supabase } = args;

  // 1. Empleado (RLS scope). Sin select adicional, solo fields necesarios para
  // el prompt + identidad para los return shapes.
  const { data: empleadoRow } = await supabase
    .from('empleados')
    .select('id, nombre, apellido, dni')
    .eq('id', empleadoId)
    .is('archived_at', null)
    .maybeSingle();

  if (!empleadoRow) return { kind: 'empleado_not_found' };
  const empleado: EmpleadoBasic = empleadoRow;

  // 2 + 3 + 4 en paralelo (independientes; todas RLS-scoped al mismo user).
  const [puestosRes, catalogoRes, entregasRes] = await Promise.all([
    supabase
      .from('empleados_puestos')
      .select('puesto_id, puestos!inner(nombre, descripcion, riesgos_asociados, archived_at)')
      .eq('empleado_id', empleadoId),
    supabase
      .from('epp_items')
      .select(
        'id, nombre, normativa, vida_util_meses, marca_default, modelo_default, categoria:epp_categorias!inner(nombre)',
      )
      .eq('consultora_id', consultoraId)
      .is('archived_at', null)
      .order('nombre', { ascending: true }),
    supabase
      .from('epp_entregas')
      .select(
        'fecha_entrega, items:epp_entrega_items(item_id, epp_items!inner(nombre, vida_util_meses))',
      )
      .eq('empleado_id', empleadoId)
      .eq('consultora_id', consultoraId)
      .not('firmado_at', 'is', null),
  ]);

  // 2 — puestos activos. Filtramos archived in-code (el join inner los trae).
  type PuestoRow = {
    puesto_id: string;
    puestos: {
      nombre: string;
      descripcion: string | null;
      riesgos_asociados: string[] | null;
      archived_at: string | null;
    };
  };
  const puestosConsiderados: PuestoConsiderado[] = ((puestosRes.data ?? []) as PuestoRow[])
    .filter((r) => r.puestos.archived_at === null)
    .slice(0, MAX_PUESTOS_EN_PROMPT)
    .map((r) => ({
      puesto_id: r.puesto_id,
      nombre: r.puestos.nombre,
      descripcion: r.puestos.descripcion,
      riesgos: r.puestos.riesgos_asociados ?? [],
    }));

  if (puestosConsiderados.length === 0) {
    return { kind: 'no_puestos', empleado };
  }

  // 4 — items "frescos". Flatten entregas firmadas con sus items + vida útil,
  // reducimos a la última entrega por item; si `fecha + vida_util_meses`
  // todavía está en el futuro, el item está cubierto.
  type EntregaRow = {
    fecha_entrega: string;
    items: Array<{
      item_id: string;
      epp_items: { nombre: string; vida_util_meses: number } | null;
    }> | null;
  };
  type FlatItemEntrega = {
    item_id: string;
    fecha_entrega: string;
    item_nombre: string;
    vida_util_meses: number;
  };
  const flatItems: FlatItemEntrega[] = [];
  for (const ent of (entregasRes.data ?? []) as EntregaRow[]) {
    for (const it of ent.items ?? []) {
      if (!it.epp_items) continue;
      flatItems.push({
        item_id: it.item_id,
        fecha_entrega: ent.fecha_entrega,
        item_nombre: it.epp_items.nombre,
        vida_util_meses: it.epp_items.vida_util_meses,
      });
    }
  }
  const ultimaEntregaPorItem = new Map<string, FlatItemEntrega>();
  for (const row of flatItems) {
    const existing = ultimaEntregaPorItem.get(row.item_id);
    if (!existing || row.fecha_entrega > existing.fecha_entrega) {
      ultimaEntregaPorItem.set(row.item_id, row);
    }
  }
  const now = new Date();
  const recientesExcluidos: EntregaReciente[] = [];
  const itemsFrescosIds = new Set<string>();
  for (const row of ultimaEntregaPorItem.values()) {
    const fecha = new Date(row.fecha_entrega);
    const vence = new Date(fecha);
    vence.setMonth(vence.getMonth() + row.vida_util_meses);
    if (vence > now) {
      itemsFrescosIds.add(row.item_id);
      recientesExcluidos.push({
        item_id: row.item_id,
        item_nombre: row.item_nombre,
        fecha_entrega: row.fecha_entrega,
        vida_util_meses: row.vida_util_meses,
        vence_aprox: vence.toISOString().slice(0, 10),
      });
    }
  }

  // 3 — catálogo filtrado.
  type CatalogoRow = {
    id: string;
    nombre: string;
    normativa: string | null;
    vida_util_meses: number;
    marca_default: string | null;
    modelo_default: string | null;
    categoria: { nombre: string } | null;
  };
  const catalogoFiltrado: CatalogoItem[] = ((catalogoRes.data ?? []) as CatalogoRow[])
    .filter((r) => !itemsFrescosIds.has(r.id))
    .slice(0, MAX_ITEMS_EN_PROMPT)
    .map((r) => ({
      id: r.id,
      nombre: r.nombre,
      categoria_nombre: r.categoria?.nombre ?? '—',
      normativa: r.normativa,
      vida_util_meses: r.vida_util_meses,
      marca_default: r.marca_default,
      modelo_default: r.modelo_default,
    }));

  if (catalogoFiltrado.length === 0) {
    return { kind: 'no_catalogo', empleado, puestosConsiderados };
  }

  const catalogoIdsValidos = new Set(catalogoFiltrado.map((c) => c.id));
  const catalogoById = new Map(catalogoFiltrado.map((c) => [c.id, c]));

  // 5 — Claude call. Tool use forzado para garantizar output structured.
  const userMessage = buildUserMessage({
    empleado,
    puestos: puestosConsiderados,
    catalogo: catalogoFiltrado,
    recientes: recientesExcluidos,
  });

  const model = env.ANTHROPIC_EPP_SUGGEST_MODEL;
  const client = getAnthropicClient();
  const t0 = Date.now();
  // Cast del tool schema: lo declaramos `as const` para preservar literals en
  // tests, pero el SDK exige `Tool` mutable. El runtime es idéntico.
  const tool = RECOMMEND_EPP_TOOL_SCHEMA as unknown as Anthropic.Tool;
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: EPP_SUGGEST_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools: [tool],
    tool_choice: { type: 'tool', name: tool.name },
  });
  const ms = Date.now() - t0;

  const usage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
  };
  const cost_usd =
    (usage.input / 1_000_000) * HAIKU_INPUT_PRICE_PER_M +
    (usage.output / 1_000_000) * HAIKU_OUTPUT_PRICE_PER_M;

  // 6 — parse tool_use. Si Claude rompió el schema o se "negó" a llamar la tool
  // (no debería pasar con tool_choice forzado, pero defensa) → ai_parse_error.
  const toolBlock = response.content.find((b) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    logger.warn(
      { empleadoId, consultoraId, model, stopReason: response.stop_reason, ms },
      'epp_suggest_no_tool_block',
    );
    return { kind: 'ai_parse_error', empleado, usage };
  }

  const parsed = recommendEppOutputSchema.safeParse(toolBlock.input);
  if (!parsed.success) {
    logger.warn(
      {
        empleadoId,
        consultoraId,
        model,
        issues: parsed.error.issues.slice(0, 5),
        ms,
      },
      'epp_suggest_schema_drift',
    );
    return { kind: 'ai_parse_error', empleado, usage };
  }

  // Defensa contra alucinación: drop item_ids no presentes en el catálogo.
  // Dedup por item_id (la regla del prompt dice "no repetir" pero defensivo).
  const seen = new Set<string>();
  const suggestions: EnrichedSuggestion[] = [];
  for (const rec of parsed.data.recommendations) {
    if (!catalogoIdsValidos.has(rec.item_id)) continue;
    if (seen.has(rec.item_id)) continue;
    seen.add(rec.item_id);
    const cat = catalogoById.get(rec.item_id);
    if (!cat) continue;
    suggestions.push({
      item_id: rec.item_id,
      item_nombre: cat.nombre,
      categoria_nombre: cat.categoria_nombre,
      confianza_porcentaje: rec.confianza_porcentaje,
      justificacion: rec.justificacion,
    });
  }

  logger.info(
    {
      empleadoId,
      consultoraId,
      model,
      puestosCount: puestosConsiderados.length,
      catalogoCount: catalogoFiltrado.length,
      recientesCount: recientesExcluidos.length,
      suggestionsRaw: parsed.data.recommendations.length,
      suggestionsKept: suggestions.length,
      tokens_input: usage.input,
      tokens_output: usage.output,
      cost_usd,
      ms,
    },
    'epp_suggestion_generated',
  );

  return {
    kind: 'ok',
    empleado,
    puestosConsiderados,
    catalogoConsideradoCount: catalogoFiltrado.length,
    recientesExcluidos,
    suggestions,
    tokens: { input: usage.input, output: usage.output, cost_usd },
    model,
  };
}

function buildUserMessage(args: {
  empleado: EmpleadoBasic;
  puestos: PuestoConsiderado[];
  catalogo: CatalogoItem[];
  recientes: EntregaReciente[];
}): string {
  const { empleado, puestos, catalogo, recientes } = args;

  const puestosBlock = puestos
    .map((p) => {
      const riesgos =
        p.riesgos.length > 0 ? p.riesgos.join(', ') : '(sin riesgos cargados en el catálogo)';
      const desc = p.descripcion ? `\n  Descripción: ${p.descripcion}` : '';
      return `- **${p.nombre}**${desc}\n  Riesgos asociados: ${riesgos}`;
    })
    .join('\n');

  const catalogoBlock = catalogo
    .map((c) => {
      const norm = c.normativa ? ` | normativa: ${c.normativa}` : '';
      const marca =
        c.marca_default || c.modelo_default
          ? ` | default: ${c.marca_default ?? '—'} ${c.modelo_default ?? ''}`.trim()
          : '';
      return `- \`${c.id}\` **${c.nombre}** (categoría: ${c.categoria_nombre}; vida útil: ${c.vida_util_meses} meses${norm}${marca})`;
    })
    .join('\n');

  const recientesBlock =
    recientes.length === 0
      ? '(ninguna)'
      : recientes
          .map(
            (r) =>
              `- ${r.item_nombre} — entregado ${r.fecha_entrega}; vence aprox ${r.vence_aprox}`,
          )
          .join('\n');

  return [
    `## Empleado`,
    `${empleado.apellido}, ${empleado.nombre} (DNI ${empleado.dni})`,
    ``,
    `## Puestos asignados (${puestos.length})`,
    puestosBlock,
    ``,
    `## Catálogo EPP disponible (${catalogo.length}; ya filtrado de items archivados y de entregas recientes vigentes)`,
    catalogoBlock,
    ``,
    `## Entregas recientes excluidas (dentro de vida útil)`,
    recientesBlock,
    ``,
    `## Tarea`,
    `Recomendá los EPP del catálogo necesarios para este empleado en base a los riesgos de sus puestos. Llamá la tool \`recommend_epp_items\` con el array de recomendaciones. NO recomiendes items fuera del catálogo. NO inventes IDs.`,
  ].join('\n');
}
