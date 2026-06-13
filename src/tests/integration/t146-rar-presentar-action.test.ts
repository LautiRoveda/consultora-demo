/**
 * T-146 · Integration de `presentarRarAction` (member + billing) + la RPC
 * `gen_rar_vencimiento_calendar_for`.
 *
 * Cobertura:
 *  - happy path: ok + warnings (faltan_datos + cliente sin ART); crea el
 *    calendar_event rar_anual (recurrence NULL) + reminders [60,30,7,0] +
 *    rar_presentaciones con snapshot.
 *  - DUPLICATE: re-presentar el mismo (cliente, periodo) → 23505.
 *  - billing 402: consultora con trial expirado → BILLING_GATED.
 *  - cross-tenant: cliente de otra consultora → CLIENTE_NOT_FOUND.
 *  - cierre de ciclo: 2ª presentación (otro periodo) → el rar_anual anterior del
 *    cliente queda completed y sus reminders skipped; el nuevo queda pending.
 *
 * Harness server-action: mock next/headers + server-only + next/cache + logger;
 * `signInAs` puebla el cookieStore. Consultoras con trial vigente (billing gate).
 * Molde t143-rar-actions.test.ts.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:integration`.
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestConsultora } from './helpers/consultora';

const cookieStore: Array<{ name: string; value: string }> = [];

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ 'x-forwarded-for': '127.0.0.1' })),
  cookies: () =>
    Promise.resolve({
      getAll: () => cookieStore.map((c) => ({ name: c.name, value: c.value })),
      set: (name: string, value: string) => {
        const idx = cookieStore.findIndex((c) => c.name === name);
        if (idx >= 0) cookieStore[idx] = { name, value };
        else cookieStore.push({ name, value });
      },
    }),
}));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('@/shared/observability/logger', () => ({
  logger: {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  },
}));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY.',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = 'TestPassword123!';

const emailOwnerA = `t146a-own-${runId}@example.com`;
const emailOwnerExp = `t146exp-own-${runId}@example.com`;

let cAId: string;
let cBId: string;
let cExpId: string;
let ownerAId: string;
let ownerExpId: string;

let clienteAId: string; // cA, sin ART, con un expuesto con datos faltantes
let clienteBId: string; // cB (cross-tenant)
let clienteExpId: string; // cExp (billing)

async function mkUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${JSON.stringify(error)}`);
  return data.user.id;
}

beforeAll(async () => {
  cAId = (await createTestConsultora(admin, { name: 'T146A', slug: `t146a-${runId}` })).id;
  cBId = (await createTestConsultora(admin, { name: 'T146B', slug: `t146b-${runId}` })).id;
  // Trial expirado → billing gate dispara.
  cExpId = (
    await createTestConsultora(admin, {
      name: 'T146Exp',
      slug: `t146exp-${runId}`,
      plan: 'trial',
      trialHasta: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    })
  ).id;

  ownerAId = await mkUser(emailOwnerA);
  ownerExpId = await mkUser(emailOwnerExp);

  await admin.from('consultora_members').insert([
    { user_id: ownerAId, consultora_id: cAId, role: 'owner' },
    { user_id: ownerExpId, consultora_id: cExpId, role: 'owner' },
  ]);
  await admin.auth.admin.updateUserById(ownerAId, {
    app_metadata: { consultora_id: cAId, consultora_role: 'owner' },
  });
  await admin.auth.admin.updateUserById(ownerExpId, {
    app_metadata: { consultora_id: cExpId, consultora_role: 'owner' },
  });

  // Cliente A: SIN ART (art null) → warning.
  const cuitA = Date.now().toString().slice(-8).padStart(8, '0');
  clienteAId = (
    await admin
      .from('clientes')
      .insert({ consultora_id: cAId, razon_social: `Cliente A ${runId}`, cuit: `30-${cuitA}-5` })
      .select('id')
      .single()
  ).data!.id;
  const cuitB = (Date.now() + 1).toString().slice(-8).padStart(8, '0');
  clienteBId = (
    await admin
      .from('clientes')
      .insert({ consultora_id: cBId, razon_social: `Cliente B ${runId}`, cuit: `30-${cuitB}-6` })
      .select('id')
      .single()
  ).data!.id;
  const cuitE = (Date.now() + 2).toString().slice(-8).padStart(8, '0');
  clienteExpId = (
    await admin
      .from('clientes')
      .insert({
        consultora_id: cExpId,
        razon_social: `Cliente Exp ${runId}`,
        cuit: `30-${cuitE}-7`,
      })
      .select('id')
      .single()
  ).data!.id;

  // Exposición en cA: puesto + agente + empleado (cuil/fecha null → faltan_datos).
  const puestoAId = (
    await admin
      .from('puestos')
      .insert({ consultora_id: cAId, nombre: `Soldador ${runId}` })
      .select('id')
      .single()
  ).data!.id;
  const agenteAId = (
    await admin
      .from('rar_agentes')
      .insert({
        consultora_id: cAId,
        codigo: `FX-A-${runId}`,
        nombre: `Ruido A ${runId}`,
        agente_tipo: 'fisico',
      })
      .select('id')
      .single()
  ).data!.id;
  const empleadoAId = (
    await admin
      .from('empleados')
      .insert({
        consultora_id: cAId,
        cliente_id: clienteAId,
        nombre: 'Pepe',
        apellido: `Expuesto ${runId}`,
        dni: cuitA,
        created_by: ownerAId,
        // cuil + fecha_ingreso NULL → faltan_datos.
      })
      .select('id')
      .single()
  ).data!.id;
  await admin.from('empleados_puestos').insert({
    empleado_id: empleadoAId,
    puesto_id: puestoAId,
    consultora_id: cAId,
    asignado_por: ownerAId,
  });
  await admin.from('cliente_puesto_agentes').insert({
    cliente_id: clienteAId,
    puesto_id: puestoAId,
    agente_id: agenteAId,
    consultora_id: cAId,
    asignado_por: ownerAId,
  });
});

afterAll(async () => {
  const ids = [cAId, cBId, cExpId];
  await admin
    .from('rar_presentaciones')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('calendar_events')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('cliente_puesto_agentes')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('empleados_puestos')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('empleados')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('rar_agentes')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('puestos')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('clientes')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('consultora_members')
    .delete()
    .in('consultora_id', ids)
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .in('id', ids)
    .then(() => {});
  await admin.auth.admin.deleteUser(ownerAId).catch(() => {});
  await admin.auth.admin.deleteUser(ownerExpId).catch(() => {});
});

beforeEach(() => {
  cookieStore.length = 0;
});

const sessionCache = new Map<string, Array<{ name: string; value: string }>>();
async function signInAs(email: string): Promise<void> {
  cookieStore.length = 0;
  const cached = sessionCache.get(email);
  if (cached) {
    for (const c of cached) cookieStore.push({ ...c });
    return;
  }
  const { createClient: createServerClient } = await import('@/shared/supabase/server');
  const sb = await createServerClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  sessionCache.set(
    email,
    cookieStore.map((c) => ({ ...c })),
  );
}

describe('presentarRarAction', () => {
  it('happy path: ok + warnings; crea rar_anual (recurrence NULL) + reminders + presentación', async () => {
    await signInAs(emailOwnerA);
    const { presentarRarAction } = await import('@/app/(app)/rar/actions');
    const result = await presentarRarAction({ cliente_id: clienteAId, periodo: 2025 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.periodo).toBe(2025);
    // 2 warnings: trabajador con datos faltantes + cliente sin ART.
    expect(result.warnings.length).toBe(2);

    const { data: pres } = await admin
      .from('rar_presentaciones')
      .select('id, calendar_event_id, snapshot, fecha_vencimiento')
      .eq('id', result.presentacionId)
      .single();
    expect(pres?.calendar_event_id).toBeTruthy();
    expect((pres?.snapshot as { cliente?: { razon_social?: string } })?.cliente?.razon_social).toBe(
      `Cliente A ${runId}`,
    );

    const { data: ev } = await admin
      .from('calendar_events')
      .select('tipo, status, recurrence_months, metadata')
      .eq('id', pres!.calendar_event_id!)
      .single();
    expect(ev).toMatchObject({ tipo: 'rar_anual', status: 'pending', recurrence_months: null });
    expect((ev?.metadata as { cliente_id?: string })?.cliente_id).toBe(clienteAId);

    const { data: reminders } = await admin
      .from('calendar_event_reminders')
      .select('offset_days, status')
      .eq('event_id', pres!.calendar_event_id!);
    expect((reminders ?? []).map((r) => r.offset_days).sort((a, b) => b - a)).toEqual([
      60, 30, 7, 0,
    ]);
    expect((reminders ?? []).every((r) => r.status === 'pending')).toBe(true);
  });

  it('DUPLICATE: re-presentar el mismo (cliente, periodo) → DUPLICATE', async () => {
    await signInAs(emailOwnerA);
    const { presentarRarAction } = await import('@/app/(app)/rar/actions');
    const result = await presentarRarAction({ cliente_id: clienteAId, periodo: 2025 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('DUPLICATE');
  });

  it('cierre de ciclo: 2ª presentación (otro periodo) → el rar_anual anterior queda completed + reminders skipped', async () => {
    await signInAs(emailOwnerA);
    const { presentarRarAction } = await import('@/app/(app)/rar/actions');

    // Evento de la presentación previa (periodo 2025).
    const { data: prev } = await admin
      .from('rar_presentaciones')
      .select('calendar_event_id')
      .eq('cliente_id', clienteAId)
      .eq('periodo', 2025)
      .single();
    const prevEventId = prev!.calendar_event_id!;

    const result = await presentarRarAction({ cliente_id: clienteAId, periodo: 2026 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // El evento anterior quedó cerrado.
    const { data: prevEv } = await admin
      .from('calendar_events')
      .select('status')
      .eq('id', prevEventId)
      .single();
    expect(prevEv?.status).toBe('completed');

    const { data: prevReminders } = await admin
      .from('calendar_event_reminders')
      .select('status')
      .eq('event_id', prevEventId);
    expect((prevReminders ?? []).every((r) => r.status === 'skipped')).toBe(true);

    // El nuevo evento queda pending.
    const { data: newPres } = await admin
      .from('rar_presentaciones')
      .select('calendar_event_id')
      .eq('cliente_id', clienteAId)
      .eq('periodo', 2026)
      .single();
    const { data: newEv } = await admin
      .from('calendar_events')
      .select('status')
      .eq('id', newPres!.calendar_event_id!)
      .single();
    expect(newEv?.status).toBe('pending');
  });

  it('billing: consultora con trial expirado → BILLING_GATED', async () => {
    await signInAs(emailOwnerExp);
    const { presentarRarAction } = await import('@/app/(app)/rar/actions');
    const result = await presentarRarAction({ cliente_id: clienteExpId, periodo: 2025 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BILLING_GATED');
  });

  it('cross-tenant: cliente de otra consultora → CLIENTE_NOT_FOUND', async () => {
    await signInAs(emailOwnerA);
    const { presentarRarAction } = await import('@/app/(app)/rar/actions');
    const result = await presentarRarAction({ cliente_id: clienteBId, periodo: 2025 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('CLIENTE_NOT_FOUND');
  });
});
