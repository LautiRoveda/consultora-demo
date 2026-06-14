import 'server-only';

import type { Json } from '@/shared/supabase/types';
import type { AgenteTipo, RarAgenteRef, RarExpuesto, RarPlanillaNomina } from './queries';

import { TIPO_ORDER } from './labels';

/**
 * T-147 · Parseo defensivo del snapshot legal de `rar_presentaciones` (jsonb sin
 * tipo TS garantizado) al shape que consume la planilla RAR.
 *
 * El snapshot lo arma `presentarRarAction` (T-146) con la forma:
 *   { cliente: { id, razon_social, cuit, art, domicilio, localidad, provincia },
 *     nomina: { expuestos: RarExpuesto[], agentes: RarAgenteRef[] },
 *     fecha_presentacion, fecha_vencimiento, periodo, generado_at }
 *
 * Como el snapshot es inmutable y podría provenir de una versión anterior del
 * armado, NO asumimos la forma: cada campo se coacciona con fallback. Un snapshot
 * corrupto degrada a una planilla con campos en blanco, nunca tira la request.
 */

export type RarSnapshotCliente = {
  razon_social: string;
  cuit: string;
  domicilio: string | null;
  localidad: string | null;
  provincia: string | null;
  art: string | null;
};

export type ParsedRarSnapshot = {
  cliente: RarSnapshotCliente;
  nomina: RarPlanillaNomina;
  periodo: number;
  fechaPresentacion: string | null;
  /** Timestamp original de generación (footer "Generado el …"). */
  generadoAt: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** String o null (vacío/whitespace → null). */
function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/** String con fallback a '' (campos required del template). */
function reqStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function strArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function agenteTipo(value: unknown): AgenteTipo {
  return typeof value === 'string' && (TIPO_ORDER as readonly string[]).includes(value)
    ? (value as AgenteTipo)
    : 'fisico';
}

function parseAgente(value: unknown, idx: number): RarAgenteRef {
  const r = isRecord(value) ? value : {};
  return {
    agente_id:
      typeof r.agente_id === 'string' && r.agente_id.length > 0 ? r.agente_id : `ag-${idx}`,
    codigo: reqStr(r.codigo),
    nombre: reqStr(r.nombre),
    agente_tipo: agenteTipo(r.agente_tipo),
  };
}

function parseExpuesto(value: unknown, idx: number): RarExpuesto {
  const r = isRecord(value) ? value : {};
  const agentes = Array.isArray(r.agentes) ? r.agentes.map(parseAgente) : [];
  return {
    empleado_id:
      typeof r.empleado_id === 'string' && r.empleado_id.length > 0 ? r.empleado_id : `exp-${idx}`,
    apellido: reqStr(r.apellido),
    nombre: reqStr(r.nombre),
    cuil: nullableStr(r.cuil),
    dni: nullableStr(r.dni),
    fecha_ingreso: nullableStr(r.fecha_ingreso),
    puestos: strArray(r.puestos),
    agentes,
    faltan_datos:
      typeof r.faltan_datos === 'boolean' ? r.faltan_datos : !r.cuil || !r.fecha_ingreso,
  };
}

export function parseRarSnapshot(snapshot: Json, fallbackPeriodo: number): ParsedRarSnapshot {
  const root = isRecord(snapshot) ? snapshot : {};
  const cliente = isRecord(root.cliente) ? root.cliente : {};
  const nomina = isRecord(root.nomina) ? root.nomina : {};

  const expuestos = Array.isArray(nomina.expuestos) ? nomina.expuestos.map(parseExpuesto) : [];
  const agentes = Array.isArray(nomina.agentes) ? nomina.agentes.map(parseAgente) : [];

  return {
    cliente: {
      razon_social: reqStr(cliente.razon_social),
      cuit: reqStr(cliente.cuit),
      domicilio: nullableStr(cliente.domicilio),
      localidad: nullableStr(cliente.localidad),
      provincia: nullableStr(cliente.provincia),
      art: nullableStr(cliente.art),
    },
    nomina: { expuestos, agentes },
    periodo: typeof root.periodo === 'number' ? root.periodo : fallbackPeriodo,
    fechaPresentacion: nullableStr(root.fecha_presentacion),
    generadoAt: nullableStr(root.generado_at),
  };
}
