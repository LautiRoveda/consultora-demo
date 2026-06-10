/**
 * T-139 · Tests RLS de informe_plantillas.
 *
 * Las plantillas son PER-CONSULTORA (activos del negocio, a diferencia del
 * chat T-126 per-user): las policies exigen solo `is_member_of_consultora`.
 * El caso estrella: dos users del MISMO tenant SI se ven (y editan) las
 * plantillas entre si — lo opuesto al chat.
 *
 * Cobertura: SELECT/INSERT/UPDATE intra-tenant entre users + cross-tenant +
 * spoof created_by + anon + DELETE default-deny + CHECKs (tipo/nombre/config)
 * + unique parcial por (consultora_id, tipo, lower(nombre)) solo activos.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration src/tests/integration/informe-plantillas-rls.test.ts`.
 */
import type { Database } from '@/shared/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Correr con: `set -a && source .env.local && set +a && pnpm test:integration`',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slugA = `t139-rls-a-${runId}`;
const slugB = `t139-rls-b-${runId}`;
const emailA1 = `t139-a1-${runId}@example.com`;
const emailA2 = `t139-a2-${runId}@example.com`;
const emailB = `t139-b-${runId}@example.com`;
const password = 'TestPassword123!';

const configMinima = { instrucciones_adicionales: 'Tono formal.' };

let cAId: string;
let cBId: string;
let a1Id: string;
let a2Id: string;
let bId: string;

let clientA1: SupabaseClient<Database>;
let clientA2: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;
let clientAnon: SupabaseClient<Database>;

/** Plantilla fixture de cA creada por a1 (RLS-válida). */
let plantillaA1Id: string;

async function signedClient(email: string): Promise<SupabaseClient<Database>> {
  const sb = createSbClient<Database>(url!, anonKey!, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return sb;
}

beforeAll(async () => {
  cAId = (await createTestConsultora(admin, { name: 'T139 RLS cA', slug: slugA })).id;
  cBId = (await createTestConsultora(admin, { name: 'T139 RLS cB', slug: slugB })).id;

  // Users secuenciales (Promise.all sobre auth.admin tiene flakiness en sa-east-1).
  const uA1 = await admin.auth.admin.createUser({ email: emailA1, password, email_confirm: true });
  if (uA1.error || !uA1.data.user) throw new Error(`createUser a1: ${JSON.stringify(uA1.error)}`);
  a1Id = uA1.data.user.id;
  const uA2 = await admin.auth.admin.createUser({ email: emailA2, password, email_confirm: true });
  if (uA2.error || !uA2.data.user) throw new Error(`createUser a2: ${JSON.stringify(uA2.error)}`);
  a2Id = uA2.data.user.id;
  const uB = await admin.auth.admin.createUser({ email: emailB, password, email_confirm: true });
  if (uB.error || !uB.data.user) throw new Error(`createUser b: ${JSON.stringify(uB.error)}`);
  bId = uB.data.user.id;

  // Memberships: a1 + a2 en cA (mismo tenant, distintos users); b owner en cB.
  await admin.from('consultora_members').insert([
    { user_id: a1Id, consultora_id: cAId, role: 'member' },
    { user_id: a2Id, consultora_id: cAId, role: 'member' },
    { user_id: bId, consultora_id: cBId, role: 'owner' },
  ]);

  // Claim JWT ANTES del sign-in (el claim se hornea al emitir el token).
  await admin.auth.admin.updateUserById(a1Id, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(a2Id, { app_metadata: { consultora_id: cAId } });
  await admin.auth.admin.updateUserById(bId, { app_metadata: { consultora_id: cBId } });

  clientA1 = await signedClient(emailA1);
  clientA2 = await signedClient(emailA2);
  clientB = await signedClient(emailB);
  clientAnon = createSbClient<Database>(url, anonKey, { auth: { persistSession: false } });

  const { data: plantilla, error } = await clientA1
    .from('informe_plantillas')
    .insert({
      consultora_id: cAId,
      tipo: 'relevamiento',
      nombre: 'Mi relevamiento de ruido',
      config: configMinima,
      created_by: a1Id,
    })
    .select('id')
    .single();
  if (error || !plantilla) throw new Error(`fixture plantilla a1: ${JSON.stringify(error)}`);
  plantillaA1Id = plantilla.id;
});

afterAll(async () => {
  // A diferencia del chat (user_id cascade), las plantillas cuelgan de la
  // consultora — borrar users NO las limpia. Hard-delete via service_role;
  // las consultoras quedan orphan (retencion de audit_log, como el resto).
  await admin.from('informe_plantillas').delete().in('consultora_id', [cAId, cBId]);
  await Promise.all([
    admin.auth.admin.deleteUser(a1Id).catch(() => {}),
    admin.auth.admin.deleteUser(a2Id).catch(() => {}),
    admin.auth.admin.deleteUser(bId).catch(() => {}),
  ]);
});

describe('informe_plantillas RLS (per-consultora)', () => {
  it('1. a1 inserta una plantilla de su consultora', async () => {
    const { data, error } = await clientA1
      .from('informe_plantillas')
      .insert({
        consultora_id: cAId,
        tipo: 'rgrl',
        nombre: 'RGRL industria',
        config: configMinima,
        created_by: a1Id,
      })
      .select('id, consultora_id, created_by')
      .single();
    expect(error).toBeNull();
    expect(data?.consultora_id).toBe(cAId);
    expect(data?.created_by).toBe(a1Id);
  });

  it('2. a2 SI ve la plantilla de a1 (mismo tenant — activo del negocio, no per-user)', async () => {
    const { data, error } = await clientA2
      .from('informe_plantillas')
      .select('id, nombre')
      .eq('id', plantillaA1Id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.id).toBe(plantillaA1Id);
  });

  it('3. a2 SI puede renombrar la plantilla de a1 (UPDATE intra-tenant)', async () => {
    const { data, error } = await clientA2
      .from('informe_plantillas')
      .update({ nombre: 'Relevamiento de ruido (rev a2)' })
      .eq('id', plantillaA1Id)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length).toBe(1);
  });

  it('4. b NO ve la plantilla de cA (cross-tenant)', async () => {
    const { data, error } = await clientB
      .from('informe_plantillas')
      .select('id')
      .eq('id', plantillaA1Id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('5. b NO puede actualizar la plantilla de cA (0 rows)', async () => {
    const { data, error } = await clientB
      .from('informe_plantillas')
      .update({ nombre: 'hackeada' })
      .eq('id', plantillaA1Id)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);
  });

  it('6. a1 NO puede insertar con consultora_id de otro tenant (cB)', async () => {
    const { error } = await clientA1.from('informe_plantillas').insert({
      consultora_id: cBId,
      tipo: 'relevamiento',
      nombre: 'cross-tenant',
      config: configMinima,
      created_by: a1Id,
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('7. a1 NO puede spoofear created_by = a2', async () => {
    const { error } = await clientA1.from('informe_plantillas').insert({
      consultora_id: cAId,
      tipo: 'relevamiento',
      nombre: 'spoof autor',
      config: configMinima,
      created_by: a2Id,
    });
    expect(error).not.toBeNull();
    expect(error?.message.toLowerCase()).toMatch(/row[- ]level security|policy|violates/);
  });

  it('8. anon (sin sesión) NO puede consultar', async () => {
    const { data, error } = await clientAnon
      .from('informe_plantillas')
      .select('id')
      .eq('id', plantillaA1Id)
      .maybeSingle();
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });

  it('9. NO hay DELETE para authenticated (default-deny → 0 rows)', async () => {
    const { data, error } = await clientA1
      .from('informe_plantillas')
      .delete()
      .eq('id', plantillaA1Id)
      .select('id');
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBe(0);

    const { data: still } = await admin
      .from('informe_plantillas')
      .select('id')
      .eq('id', plantillaA1Id)
      .maybeSingle();
    expect(still?.id).toBe(plantillaA1Id);
  });

  it('10. CHECK: tipo inválido / nombre vacío / config no-objeto → 23514', async () => {
    const tipoInvalido = await clientA1.from('informe_plantillas').insert({
      consultora_id: cAId,
      tipo: 'inexistente',
      nombre: 'tipo roto',
      config: configMinima,
      created_by: a1Id,
    });
    expect(tipoInvalido.error?.code).toBe('23514');

    const nombreVacio = await clientA1.from('informe_plantillas').insert({
      consultora_id: cAId,
      tipo: 'relevamiento',
      nombre: '   ',
      config: configMinima,
      created_by: a1Id,
    });
    expect(nombreVacio.error?.code).toBe('23514');

    const configArray = await clientA1.from('informe_plantillas').insert({
      consultora_id: cAId,
      tipo: 'relevamiento',
      nombre: 'config rota',
      config: [1, 2, 3],
      created_by: a1Id,
    });
    expect(configArray.error?.code).toBe('23514');
  });

  it('11. unique parcial: nombre duplicado (case-insensitive) mismo tipo → 23505; archivar lo libera', async () => {
    const { data: original, error: e1 } = await clientA1
      .from('informe_plantillas')
      .insert({
        consultora_id: cAId,
        tipo: 'capacitacion',
        nombre: 'Capacitación incendio',
        config: configMinima,
        created_by: a1Id,
      })
      .select('id')
      .single();
    expect(e1).toBeNull();

    // Duplicado case-insensitive, incluso de OTRO user del tenant. La
    // variacion de case es solo-ASCII a proposito: el fold de lower() sobre
    // 'Ó' depende del locale de la DB y meteria flake CI-local vs prod.
    const dup = await clientA2.from('informe_plantillas').insert({
      consultora_id: cAId,
      tipo: 'capacitacion',
      nombre: 'capacitación incendio',
      config: configMinima,
      created_by: a2Id,
    });
    expect(dup.error?.code).toBe('23505');

    // Mismo nombre en OTRO tipo no choca (unique incluye tipo).
    const otroTipo = await clientA1.from('informe_plantillas').insert({
      consultora_id: cAId,
      tipo: 'otros',
      nombre: 'Capacitación incendio',
      config: configMinima,
      created_by: a1Id,
    });
    expect(otroTipo.error).toBeNull();

    // Archivar la original libera el nombre (unique solo cubre activas).
    await clientA1
      .from('informe_plantillas')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', original!.id);
    const reuso = await clientA2.from('informe_plantillas').insert({
      consultora_id: cAId,
      tipo: 'capacitacion',
      nombre: 'Capacitación incendio',
      config: configMinima,
      created_by: a2Id,
    });
    expect(reuso.error).toBeNull();
  });
});
