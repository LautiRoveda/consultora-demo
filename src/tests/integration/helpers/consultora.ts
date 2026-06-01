/**
 * F1.2 · Helper compartido para crear consultoras de test con trial VIGENTE.
 *
 * POR QUÉ: la tabla `consultoras` tiene default `plan='trial'` y `trial_hasta`
 * queda NULL si no se pasa. Con el billing-gate enforced (BILLING_GATE_DISABLED
 * cae al default Zod 'false' en el job local T-111 + en CI), una consultora con
 * `plan='trial'` + `trial_hasta=null` da `TRIAL_EXPIRED` en `getBillingStatus`
 * (src/shared/billing/access.ts) → cualquier acción/route gated (CREATE/EXPORT/
 * GENERATE) que el test ejercite corta con BILLING_GATED/402 y el test falla.
 *
 * Este helper inserta la consultora con `trial_hasta = now + 30d` por DEFAULT,
 * así el gate no bloquea. Para tests que SÍ quieren probar el gate (billing-gate,
 * epp-pdf-route), pasar override explícito:
 *   createTestConsultora(admin, { name, slug, plan: 'trial', trialHasta: <pasado> })
 *   createTestConsultora(admin, { name, slug, trialHasta: null })  // fuerza expirado
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

type ConsultoraInsert = Database['public']['Tables']['consultoras']['Insert'];

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreateTestConsultoraInput {
  name: string;
  slug: string;
  /** Default: omitido → la DB aplica 'trial'. */
  plan?: ConsultoraInsert['plan'];
  /**
   * Default (si se omite): `now + 30d` (trial vigente → gate no bloquea).
   * Pasar explícitamente `null` o una fecha pasada para probar el gate.
   */
  trialHasta?: string | null;
}

/**
 * Inserta una consultora de test y devuelve su id. Lanza si el insert falla
 * (mismo contrato que el `expect(error).toBeNull()` que reemplaza en los tests).
 */
export async function createTestConsultora(
  admin: SupabaseClient<Database>,
  input: CreateTestConsultoraInput,
): Promise<{ id: string }> {
  const trial_hasta =
    input.trialHasta !== undefined
      ? input.trialHasta
      : new Date(Date.now() + THIRTY_DAYS_MS).toISOString();

  const row: ConsultoraInsert = {
    name: input.name,
    slug: input.slug,
    trial_hasta,
  };
  if (input.plan) row.plan = input.plan;

  const { data, error } = await admin.from('consultoras').insert(row).select('id').single();

  if (error || !data) {
    throw new Error(`createTestConsultora(${input.slug}): ${error?.message ?? 'sin row'}`);
  }
  return { id: data.id };
}
