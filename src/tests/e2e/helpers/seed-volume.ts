/**
 * T-158 · Seeding programático "a volumen" para los E2E `@volume`.
 *
 * Por qué service-role y NO clicks: generar el volumen por UI es inviable en el
 * harness (minutos de navegación por cada fila). Sembramos con `adminClient`
 * (batcheado, segundos) y Playwright solo VALIDA que la UI opera sobre ese
 * volumen. El suite `@volume` corre nightly fuera del gate (T-158, fork 2).
 *
 * **Cero IA**: los informes se insertan con `contenido` escrito (markdown
 * literal) — nunca se entra al path de generación Claude (mismo criterio que
 * `informes-publish-flow.spec.ts:createInformeWithContent`).
 *
 * **Seed derivativo del semáforo (corrección T-158)**: la RPC `semaforo_clientes`
 * ([20260609000001_t131_semaforo_clientes.sql:51-93]) NO lee `calendar_events`
 * genéricos — deriva el estado del cliente por 3 caminos: (1) `ce.informe_id` →
 * `informes.cliente_id`; (2) `tipo='epp_entrega'` + `metadata->>'empleado_id'` →
 * `empleados.cliente_id`; (3) `tipo='accion_correctiva'` + `metadata->>'cliente_id'`.
 * Los eventos directos sin link salen con `cliente_id` NULL y se filtran → NO
 * mueven el semáforo. Por eso sembramos eventos DERIVATIVOS (caminos 1 y 2) para
 * tener clientes en `vencido` / `por_vencer` a volumen real.
 *
 * Env vars requeridas: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  uniqueTestEmail,
} from './admin';

// ── Números objetivo (T-158). Cruzan los umbrales relevantes sin inflar el
// runtime: 50 (cap de listado clientes/empleados) y 200 (cap dashboard). ──
/** Clientes "Volumen Cliente NNN" en la consultora gorda (supera el cap 50). */
export const VOL_CLIENTES = 110;
/** Empleados en el cliente industrial (supera el cap 50 per-cliente). */
export const VOL_EMPLEADOS_INDUSTRIAL = 120;
/** Clientes con vencimiento DERIVATIVO vencido (camino informes). */
export const VOL_VENCIDOS = 10;
/** Clientes con vencimiento DERIVATIVO por-vencer (camino epp metadata). */
export const VOL_POR_VENCER = 10;
/** Informes escritos (sin IA), mix draft/published. */
export const VOL_INFORMES = 80;
/** Entregas EPP reales vía RPC (cubre el wiring EPP→calendario al menos una vez). */
export const VOL_EPP_ENTREGAS_RPC = 5;

const REMINDER_OFFSETS = [14, 3, 0];

/** Fecha civil `YYYY-MM-DD` a `n` días de hoy (negativo = pasado). */
function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

/** DNI/CUIT secuenciales globales para no chocar el UNIQUE (consultora, cliente, dni). */
let dniCounter = 10_000_000;
let cuitCounter = 10_000_000;
const nextDni = (): string => String(dniCounter++);
const nextCuit = (): string => `30-${String(cuitCounter++).padStart(8, '0')}-9`;

export interface VolumeSeed {
  userId: string;
  email: string;
  password: string;
  consultoraId: string;
  /** Cliente alfabéticamente DENTRO de las primeras 50 filas (visible en el listado). */
  clienteVisibleRazon: string;
  /** Cliente alfabéticamente MÁS ALLÁ de la fila 50 (truncado: invisible + no buscable). */
  clienteTruncadoRazon: string;
  /** Cliente industrial (>50 empleados) para probar la truncación de empleados. */
  clienteIndustrialId: string;
  /** Apellido de un empleado DENTRO de las primeras 50 filas del industrial. */
  empleadoVisibleApellido: string;
  /** Apellido de un empleado MÁS ALLÁ de la fila 50 del industrial (truncado). */
  empleadoTruncadoApellido: string;
  /** Cliente en estado `vencido` en el semáforo (camino informes). */
  clienteVencidoId: string;
  /** Cliente en estado `por_vencer` en el semáforo (camino epp metadata). */
  clientePorVencerId: string;
  /** Título del evento `custom` marcador (visible en /calendario/agenda). */
  customEventTitulo: string;
}

const PAD3 = (n: number): string => String(n).padStart(3, '0');

/**
 * Siembra la consultora "gorda" + toda su data a volumen. Devuelve los
 * marcadores que el spec usa en sus aserciones.
 */
export async function seedConsultoraGorda(label: string): Promise<VolumeSeed> {
  const email = uniqueTestEmail(`vol-gorda-${label}`);
  const { userId, consultoraId, password } = await createTestUserWithConsultora({
    email,
    consultoraName: `T-158 Volumen Gorda ${label}`,
  });

  // ── 1. Clientes: 1 industrial (sort temprano) + N "Volumen Cliente NNN". ──
  const clienteIndustrialRazon = `AAA Industrial Volumen ${label}`;
  const clienteVisibleRazon = `Volumen Cliente ${PAD3(1)}`;
  const clienteTruncadoRazon = `Volumen Cliente ${PAD3(VOL_CLIENTES)}`;

  const clienteRows = [
    {
      consultora_id: consultoraId,
      created_by: userId,
      razon_social: clienteIndustrialRazon,
      cuit: nextCuit(),
    },
    ...Array.from({ length: VOL_CLIENTES }, (_, i) => ({
      consultora_id: consultoraId,
      created_by: userId,
      razon_social: `Volumen Cliente ${PAD3(i + 1)}`,
      cuit: nextCuit(),
    })),
  ];
  const { data: clientes, error: cErr } = await adminClient
    .from('clientes')
    .insert(clienteRows)
    .select('id, razon_social');
  if (cErr || !clientes) throw new Error(`seed clientes: ${cErr?.message}`);

  const byRazon = new Map(clientes.map((c) => [c.razon_social, c.id]));
  const clienteIndustrialId = byRazon.get(clienteIndustrialRazon)!;
  // Clientes ordinarios indexados 1..N (los que mueven el semáforo).
  const volClienteId = (n: number): string => byRazon.get(`Volumen Cliente ${PAD3(n)}`)!;

  // ── 2. Empleados: 120 en el industrial (supera 50) + spread + 10 para EPP. ──
  const empleadoVisibleApellido = `Industrial ${PAD3(1)}`;
  const empleadoTruncadoApellido = `Industrial ${PAD3(VOL_EMPLEADOS_INDUSTRIAL)}`;

  const empleadoRows = [
    // Industrial: 120 empleados → su lista per-cliente trunca a 50.
    ...Array.from({ length: VOL_EMPLEADOS_INDUSTRIAL }, (_, i) => ({
      consultora_id: consultoraId,
      cliente_id: clienteIndustrialId,
      created_by: userId,
      nombre: 'Empleado',
      apellido: `Industrial ${PAD3(i + 1)}`,
      dni: nextDni(),
    })),
    // 1 empleado en cada cliente por-vencer (camino EPP del semáforo).
    ...Array.from({ length: VOL_POR_VENCER }, (_, i) => ({
      consultora_id: consultoraId,
      cliente_id: volClienteId(VOL_VENCIDOS + i + 1),
      created_by: userId,
      nombre: 'Epp',
      apellido: `PorVencer ${PAD3(i + 1)}`,
      dni: nextDni(),
    })),
    // Spread de volumen: 2 empleados en 30 clientes ordinarios.
    ...Array.from({ length: 60 }, (_, i) => ({
      consultora_id: consultoraId,
      cliente_id: volClienteId(VOL_VENCIDOS + VOL_POR_VENCER + (i % 30) + 1),
      created_by: userId,
      nombre: 'Spread',
      apellido: `Empleado ${PAD3(i + 1)}`,
      dni: nextDni(),
    })),
  ];
  const { data: empleados, error: eErr } = await adminClient
    .from('empleados')
    .insert(empleadoRows)
    .select('id, cliente_id, apellido');
  if (eErr || !empleados) throw new Error(`seed empleados: ${eErr?.message}`);

  // Empleado por-vencer por cliente (para el evento epp_entrega derivativo).
  const empleadoPorVencerByCliente = new Map<string, string>();
  for (const emp of empleados) {
    if (emp.apellido.startsWith('PorVencer') && !empleadoPorVencerByCliente.has(emp.cliente_id)) {
      empleadoPorVencerByCliente.set(emp.cliente_id, emp.id);
    }
  }

  // ── 3. Informes escritos (sin IA). 10 con cliente_id para el camino vencido. ──
  const TIPOS = ['rgrl', 'capacitacion', 'relevamiento', 'otros', 'accidente'] as const;
  const informeRows = Array.from({ length: VOL_INFORMES }, (_, i) => ({
    consultora_id: consultoraId,
    created_by: userId,
    tipo: TIPOS[i % TIPOS.length]!,
    titulo: `Informe Volumen ${PAD3(i + 1)}`,
    contenido: `# Informe Volumen ${PAD3(i + 1)}\n\nContenido escrito (sin IA) para el suite a volumen.`,
    status: i % 2 === 0 ? 'draft' : 'published',
    // Los primeros 10 quedan ligados a un cliente distinto (camino 1 del semáforo).
    cliente_id: i < VOL_VENCIDOS ? volClienteId(i + 1) : null,
  }));
  const { data: informes, error: iErr } = await adminClient
    .from('informes')
    .insert(informeRows)
    .select('id, cliente_id');
  if (iErr || !informes) throw new Error(`seed informes: ${iErr?.message}`);

  const informeByCliente = new Map<string, string>();
  for (const inf of informes) {
    if (inf.cliente_id && !informeByCliente.has(inf.cliente_id)) {
      informeByCliente.set(inf.cliente_id, inf.id);
    }
  }

  // ── 4. calendar_events DERIVATIVOS (mueven el semáforo) + genéricos (calendario). ──
  const customEventTitulo = `VOL-CUSTOM-MARKER ${label}`;
  const eventRows: {
    consultora_id: string;
    created_by: string;
    tipo: string;
    titulo: string;
    fecha_vencimiento: string;
    reminder_offsets_days: number[];
    informe_id?: string;
    metadata?: { empleado_id: string };
  }[] = [];

  // 4a. Camino 1 (informes): 10 clientes → evento ligado al informe, fecha pasada → VENCIDO.
  for (let i = 1; i <= VOL_VENCIDOS; i++) {
    const clienteId = volClienteId(i);
    const informeId = informeByCliente.get(clienteId);
    if (!informeId) continue;
    eventRows.push({
      consultora_id: consultoraId,
      created_by: userId,
      tipo: 'rgrl_anual',
      titulo: `Vencimiento RGRL ${PAD3(i)}`,
      fecha_vencimiento: isoDate(-10),
      reminder_offsets_days: REMINDER_OFFSETS,
      informe_id: informeId,
    });
  }

  // 4b. Camino 2 (epp metadata): 10 clientes → evento epp_entrega, fecha +10 → POR_VENCER.
  for (let i = 1; i <= VOL_POR_VENCER; i++) {
    const clienteId = volClienteId(VOL_VENCIDOS + i);
    const empleadoId = empleadoPorVencerByCliente.get(clienteId);
    if (!empleadoId) continue;
    eventRows.push({
      consultora_id: consultoraId,
      created_by: userId,
      tipo: 'epp_entrega',
      titulo: `Vencimiento EPP ${PAD3(i)}`,
      fecha_vencimiento: isoDate(10),
      reminder_offsets_days: REMINDER_OFFSETS,
      metadata: { empleado_id: empleadoId },
    });
  }

  // 4c. Marcador custom (visible en agenda, NO mueve semáforo) + relleno de volumen.
  eventRows.push({
    consultora_id: consultoraId,
    created_by: userId,
    tipo: 'custom',
    titulo: customEventTitulo,
    fecha_vencimiento: isoDate(12),
    reminder_offsets_days: [7, 0],
  });
  for (let i = 0; i < 80; i++) {
    eventRows.push({
      consultora_id: consultoraId,
      created_by: userId,
      tipo: 'custom',
      titulo: `Vencimiento custom volumen ${PAD3(i + 1)}`,
      fecha_vencimiento: isoDate(20 + (i % 60)),
      reminder_offsets_days: [7, 0],
    });
  }

  const { error: ceErr } = await adminClient.from('calendar_events').insert(eventRows);
  if (ceErr) throw new Error(`seed calendar_events: ${ceErr.message}`);

  // ── 5. EPP real vía RPC (wiring EPP→calendario, 5 entregas en el industrial). ──
  await seedEppEntregasViaRpc({
    consultoraId,
    userId,
    clienteId: clienteIndustrialId,
    empleadoIds: empleados
      .filter((e) => e.cliente_id === clienteIndustrialId)
      .slice(0, VOL_EPP_ENTREGAS_RPC)
      .map((e) => e.id),
    label,
  });

  return {
    userId,
    email,
    password,
    consultoraId,
    clienteVisibleRazon,
    clienteTruncadoRazon,
    clienteIndustrialId,
    empleadoVisibleApellido,
    empleadoTruncadoApellido,
    clienteVencidoId: volClienteId(1),
    clientePorVencerId: volClienteId(VOL_VENCIDOS + 1),
    customEventTitulo,
  };
}

/**
 * Crea catálogo EPP mínimo + N entregas reales y llama a la RPC
 * `gen_epp_planificaciones_y_calendar_for` por cada una. Esto ejercita el wiring
 * real EPP→calendario (a diferencia de los eventos epp_entrega directos de 4b).
 */
async function seedEppEntregasViaRpc(args: {
  consultoraId: string;
  userId: string;
  clienteId: string;
  empleadoIds: string[];
  label: string;
}): Promise<void> {
  const { consultoraId, userId, clienteId, empleadoIds, label } = args;
  if (empleadoIds.length === 0) return;

  const { data: cat, error: catErr } = await adminClient
    .from('epp_categorias')
    .insert({ consultora_id: consultoraId, nombre: `Cat Volumen ${label}`, created_by: userId })
    .select('id')
    .single();
  if (catErr || !cat) throw new Error(`seed epp_categoria: ${catErr?.message}`);

  const { data: item, error: itemErr } = await adminClient
    .from('epp_items')
    .insert({
      consultora_id: consultoraId,
      categoria_id: cat.id,
      nombre: `Casco Volumen ${label}`,
      vida_util_meses: 6,
      es_descartable: false,
      requiere_numero_serie: false,
      created_by: userId,
    })
    .select('id')
    .single();
  if (itemErr || !item) throw new Error(`seed epp_item: ${itemErr?.message}`);

  for (const empleadoId of empleadoIds) {
    const { data: entrega, error: entErr } = await adminClient
      .from('epp_entregas')
      .insert({
        consultora_id: consultoraId,
        empleado_id: empleadoId,
        cliente_id: clienteId,
        fecha_entrega: isoDate(-1),
        created_by: userId,
      })
      .select('id')
      .single();
    if (entErr || !entrega) throw new Error(`seed epp_entrega: ${entErr?.message}`);

    const { error: eiErr } = await adminClient.from('epp_entrega_items').insert({
      entrega_id: entrega.id,
      item_id: item.id,
      consultora_id: consultoraId,
      cantidad: 1,
      motivo_entrega: 'inicial',
    });
    if (eiErr) throw new Error(`seed epp_entrega_item: ${eiErr.message}`);

    const { error: rpcErr } = await adminClient.rpc('gen_epp_planificaciones_y_calendar_for', {
      p_entrega_id: entrega.id,
    });
    if (rpcErr) throw new Error(`gen_epp_planificaciones_y_calendar_for: ${rpcErr.message}`);
  }
}

export interface SmallSeed {
  userId: string;
  email: string;
  password: string;
  consultoraId: string;
  clienteRazon: string;
}

/**
 * Siembra una consultora chica (2 clientes) para validar el aislamiento RLS:
 * su usuario NO debe ver NADA de la consultora gorda en ningún listado.
 */
export async function seedConsultoraChica(label: string): Promise<SmallSeed> {
  const email = uniqueTestEmail(`vol-chica-${label}`);
  const { userId, consultoraId, password } = await createTestUserWithConsultora({
    email,
    consultoraName: `T-158 Volumen Chica ${label}`,
  });

  const clienteRazon = `Chica Cliente ${label}`;
  const { error } = await adminClient.from('clientes').insert([
    {
      consultora_id: consultoraId,
      created_by: userId,
      razon_social: clienteRazon,
      cuit: nextCuit(),
    },
    {
      consultora_id: consultoraId,
      created_by: userId,
      razon_social: `Chica Cliente 2 ${label}`,
      cuit: nextCuit(),
    },
  ]);
  if (error) throw new Error(`seed chica clientes: ${error.message}`);

  return { userId, email, password, consultoraId, clienteRazon };
}

/**
 * Borra toda la data sembrada de una consultora en orden FK (service-role
 * bypassa RLS, incluso la inmutabilidad de epp_entregas). Belt-and-suspenders:
 * el nightly corre sobre Supabase local efímero (`db reset`), pero seguimos la
 * convención de cleanup del repo.
 */
export async function cleanupConsultora(consultoraId: string, userId: string): Promise<void> {
  await adminClient.from('calendar_events').delete().eq('consultora_id', consultoraId);
  await adminClient.from('epp_planificaciones').delete().eq('consultora_id', consultoraId);
  await adminClient.from('epp_entrega_items').delete().eq('consultora_id', consultoraId);
  await adminClient.from('epp_entregas').delete().eq('consultora_id', consultoraId);
  await adminClient.from('epp_items').delete().eq('consultora_id', consultoraId);
  await adminClient.from('epp_categorias').delete().eq('consultora_id', consultoraId);
  await adminClient.from('informes').delete().eq('consultora_id', consultoraId);
  await adminClient.from('empleados').delete().eq('consultora_id', consultoraId);
  await adminClient.from('clientes').delete().eq('consultora_id', consultoraId);
  await deleteTestUser(userId);
}
