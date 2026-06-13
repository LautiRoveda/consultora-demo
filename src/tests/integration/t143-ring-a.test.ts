/**
 * T-143 (Ring A) · Integration: las FK COMPUESTAS de `puesto_agentes` garantizan
 * coherencia de consultora_id entre la junction y AMBOS parents (puestos +
 * rar_agentes).
 *
 * Cada FK compuesta ((<fk>, consultora_id) -> parent(id, consultora_id)) rechaza
 * estructuralmente una asignación cuyo consultora_id != el del parent, con 23503
 * (foreign_key_violation). Es el guard estructural del ticket (ADR-0015 / T-121).
 *
 * Cobertura:
 *  - control positivo: (puestoA, agenteA, cA) pasa.
 *  - mismatch en agente_id (agente de B, consultora A) -> 23503.
 *  - mismatch en puesto_id (puesto de B, consultora A) -> 23503.
 *  - mismatch en consultora_id (parents de A, consultora B) -> 23503.
 *
 * DEMO red→green (no automatizado, lo verifica el orquestador): degradar las FK
 * compuestas a simples en la migración t143 hace que los 3 casos de mismatch
 * inserten OK (sin 23503) → estos `it` fallan (rojo); restaurarlas → verde.
 *
 * service-role admin: testeamos el FK a nivel DB, NO la RLS. runId namespacing +
 * cleanup en orden FK inverso. Molde t121-coherence-fks.test.ts.
 *
 * Correr local (Supabase efímero, requiere Docker):
 *   pnpm test:integration src/tests/integration/t143-ring-a.test.ts
 */
import type { Database } from '@/shared/supabase/types';
import { createClient as createSbClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error(
    'Tests requieren NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (pnpm test:integration).',
  );
}

const admin = createSbClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

let cAId: string;
let cBId: string;
let puestoAId: string;
let puestoBId: string;
let agenteAId: string;
let agenteBId: string;

async function insertConsultora(slug: string): Promise<string> {
  const { data, error } = await admin
    .from('consultoras')
    .insert({ name: `T143 ${slug}`, slug })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insert consultora ${slug}: ${JSON.stringify(error)}`);
  return data.id;
}

async function insertPuesto(consultoraId: string, nombre: string): Promise<string> {
  const { data, error } = await admin
    .from('puestos')
    .insert({ consultora_id: consultoraId, nombre })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insert puesto ${nombre}: ${JSON.stringify(error)}`);
  return data.id;
}

async function insertAgente(consultoraId: string, codigo: string, nombre: string): Promise<string> {
  const { data, error } = await admin
    .from('rar_agentes')
    .insert({ consultora_id: consultoraId, codigo, nombre, agente_tipo: 'fisico' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insert agente ${codigo}: ${JSON.stringify(error)}`);
  return data.id;
}

beforeAll(async () => {
  // Setup secuencial (Promise.all sobre admin tiene flakiness en sa-east-1, lesson T-047).
  cAId = await insertConsultora(`ring-a-${runId}`);
  cBId = await insertConsultora(`ring-b-${runId}`);
  puestoAId = await insertPuesto(cAId, `Soldador ${runId}`);
  puestoBId = await insertPuesto(cBId, `Gruista ${runId}`);
  agenteAId = await insertAgente(cAId, `RA-A-${runId}`, `Ruido A ${runId}`);
  agenteBId = await insertAgente(cBId, `RA-B-${runId}`, `Ruido B ${runId}`);
});

afterAll(async () => {
  // Orden FK inverso. Las consultoras NO se borran (audit_log -> consultoras
  // RESTRICT + inmutable hace el hard-delete imposible; mismo leak best-effort
  // que los demás tests del módulo, lo limpia el db reset entre runs de CI).
  await admin
    .from('puesto_agentes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('rar_agentes')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('puestos')
    .delete()
    .in('consultora_id', [cAId, cBId])
    .then(() => {});
  await admin
    .from('consultoras')
    .delete()
    .in('id', [cAId, cBId])
    .then(() => {});
});

describe('T-143 · Ring A: FK compuestas de puesto_agentes', () => {
  it('control positivo: (puestoA, agenteA, cA) coherente pasa', async () => {
    const { error } = await admin.from('puesto_agentes').insert({
      puesto_id: puestoAId,
      agente_id: agenteAId,
      consultora_id: cAId,
    });
    expect(error).toBeNull();
  });

  it('mismatch en agente_id (agente de B, consultora A) -> 23503', async () => {
    const { error } = await admin.from('puesto_agentes').insert({
      puesto_id: puestoAId, // de A -> FK puestos OK
      agente_id: agenteBId, // de B -> FK rar_agentes (agenteB, A) no existe -> rechaza
      consultora_id: cAId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23503');
  });

  it('mismatch en puesto_id (puesto de B, consultora A) -> 23503', async () => {
    const { error } = await admin.from('puesto_agentes').insert({
      puesto_id: puestoBId, // de B -> FK puestos (puestoB, A) no existe -> rechaza
      agente_id: agenteAId, // de A -> FK rar_agentes OK
      consultora_id: cAId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23503');
  });

  it('mismatch en consultora_id (parents de A, consultora B) -> 23503', async () => {
    const { error } = await admin.from('puesto_agentes').insert({
      puesto_id: puestoAId, // de A
      agente_id: agenteAId, // de A
      consultora_id: cBId, // pero declara B -> ambas FK compuestas rechazan
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23503');
  });
});
