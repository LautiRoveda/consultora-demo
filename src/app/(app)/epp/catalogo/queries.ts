import 'server-only';

import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CategoriaRow = Database['public']['Tables']['epp_categorias']['Row'];
export type ItemRow = Database['public']['Tables']['epp_items']['Row'];
export type PuestoRow = Database['public']['Tables']['puestos']['Row'];

export type ItemWithCategoria = ItemRow & {
  categoria_nombre: string;
};

export type CountCatalogoResult = {
  categorias: number;
  items: number;
  puestos: number;
};

type ListOptions = {
  includeArchived?: boolean;
};

/**
 * Lista categorías del tenant ordenadas alfabéticamente. RLS filtra cross-tenant.
 */
export async function listCategorias(
  supabase: SupabaseClient<Database>,
  options: ListOptions = {},
): Promise<CategoriaRow[]> {
  let query = supabase
    .from('epp_categorias')
    .select('*')
    .order('nombre', { ascending: true })
    .order('id', { ascending: true });

  if (!options.includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data } = await query;
  return data ?? [];
}

export async function getCategoriaById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<CategoriaRow | null> {
  const { data } = await supabase.from('epp_categorias').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

/**
 * Lista items del tenant con nombre de su categoría (JOIN epp_categorias).
 * Ordenado por categoría → item para agrupación visual natural en la UI.
 */
export async function listItemsConCategoria(
  supabase: SupabaseClient<Database>,
  options: ListOptions = {},
): Promise<ItemWithCategoria[]> {
  let query = supabase
    .from('epp_items')
    .select('*, categoria:epp_categorias!inner(nombre)')
    .order('nombre', { ascending: true })
    .order('id', { ascending: true });

  if (!options.includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data } = await query;
  if (!data) return [];

  return data.map((row) => {
    const { categoria, ...item } = row as ItemRow & { categoria: { nombre: string } | null };
    return {
      ...item,
      categoria_nombre: categoria?.nombre ?? '—',
    };
  });
}

export async function getItemById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<ItemRow | null> {
  const { data } = await supabase.from('epp_items').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

export async function listPuestos(
  supabase: SupabaseClient<Database>,
  options: ListOptions = {},
): Promise<PuestoRow[]> {
  let query = supabase
    .from('puestos')
    .select('*')
    .order('nombre', { ascending: true })
    .order('id', { ascending: true });

  if (!options.includeArchived) {
    query = query.is('archived_at', null);
  }

  const { data } = await query;
  return data ?? [];
}

export async function getPuestoById(
  supabase: SupabaseClient<Database>,
  id: string,
): Promise<PuestoRow | null> {
  const { data } = await supabase.from('puestos').select('*').eq('id', id).maybeSingle();
  return data ?? null;
}

/**
 * Cuenta filas ACTIVAS (no archivadas) de las 3 entidades del catálogo del
 * tenant. Usado por `/epp/catalogo` para decidir si renderear empty state vs
 * lista. RLS filtra cross-tenant; pasamos consultora_id solo para legibilidad.
 */
export async function countCatalogo(
  supabase: SupabaseClient<Database>,
  consultoraId: string,
): Promise<CountCatalogoResult> {
  const [catRes, itemRes, puestoRes] = await Promise.all([
    supabase
      .from('epp_categorias')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', consultoraId)
      .is('archived_at', null),
    supabase
      .from('epp_items')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', consultoraId)
      .is('archived_at', null),
    supabase
      .from('puestos')
      .select('*', { count: 'exact', head: true })
      .eq('consultora_id', consultoraId)
      .is('archived_at', null),
  ]);

  return {
    categorias: catRes.count ?? 0,
    items: itemRes.count ?? 0,
    puestos: puestoRes.count ?? 0,
  };
}
