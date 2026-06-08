import type { Database } from '@/shared/supabase/types';
import type { AccidenteMetadata, Gravedad } from './schema';

/**
 * T-075 · Mapea un incidente del libro (tipo='accidente') + su cliente + su
 * empleado a la metadata del template `accidente`, para pre-poblar el informe IA
 * de investigación.
 *
 * Best-effort VÁLIDO: devuelve un objeto que pasa `accidenteMetadataSchema` (así
 * `createInformeAction` lo persiste y el editor abre pre-cargado). Los campos que
 * el incidente NO tiene (tipo de lesión, partes del cuerpo, testigos, a veces
 * hora/puesto/lugar) se completan con defaults seguros que el usuario REVISA en
 * el editor antes de generar — el informe es un borrador, no se publica acá.
 *
 * NOTA: la metadata es no-bloqueante en `createInformeAction` (si no validara, el
 * informe igual se crea vacío) — por eso preferimos defaults que validen a dejar
 * el form en blanco.
 *
 * T-129: `puesto_afectado` deriva de los puestos del CATÁLOGO del empleado
 * (concatenados) — lo resuelve el call site con `getEmpleadoPuestosLabel` y lo
 * pasa acá como `puestoAfectado`, ya no se lee la columna legacy `empleados.puesto`.
 */

type IncidenteForMapping = Pick<
  Database['public']['Tables']['incidentes']['Row'],
  'fecha' | 'hora' | 'lugar_especifico' | 'descripcion' | 'gravedad' | 'dias_perdidos'
>;
type ClienteForMapping = Pick<
  Database['public']['Tables']['clientes']['Row'],
  'razon_social' | 'cuit' | 'domicilio'
>;

/** Placeholder editable para campos requeridos sin fuente en el incidente. */
const A_DETERMINAR = 'A determinar';
/** Máximo de `dias_baja_estimados` del template (el incidente admite hasta 3650). */
const DIAS_BAJA_MAX = 365;

/**
 * Mapeo de severidad libro -> template. El enum del libro es leve|grave|mortal;
 * el del template es leve|grave|grave_mortal (mortal -> grave_mortal).
 */
const GRAVEDAD_MAP: Record<NonNullable<IncidenteForMapping['gravedad']>, Gravedad> = {
  leve: 'leve',
  grave: 'grave',
  mortal: 'grave_mortal',
};

/** Devuelve `value` si cumple el mínimo de caracteres, si no el placeholder. */
function orPlaceholder(value: string | null | undefined, min: number): string {
  return value && value.trim().length >= min ? value : A_DETERMINAR;
}

export function mapIncidenteToAccidenteMetadata(args: {
  incidente: IncidenteForMapping;
  cliente: ClienteForMapping;
  /** Puestos del catálogo del empleado, concatenados (T-129). `null` si no tiene. */
  puestoAfectado: string | null;
}): { metadata: AccidenteMetadata; titulo: string } {
  const { incidente, cliente, puestoAfectado } = args;

  // gravedad siempre presente para tipo='accidente' (CHECK SQL + guard de la
  // action); el fallback es inalcanzable pero mantiene el map total.
  const gravedad: Gravedad = incidente.gravedad ? GRAVEDAD_MAP[incidente.gravedad] : 'grave';

  const dias_baja_estimados =
    incidente.dias_perdidos != null && incidente.dias_perdidos <= DIAS_BAJA_MAX
      ? incidente.dias_perdidos
      : undefined;

  const metadata: AccidenteMetadata = {
    // — identificación cliente (commonClientFields) —
    razon_social: cliente.razon_social,
    cuit: cliente.cuit,
    domicilio: orPlaceholder(cliente.domicilio, 3),
    // — suceso —
    fecha_accidente: incidente.fecha,
    hora_accidente: incidente.hora ? incidente.hora.slice(0, 5) : '00:00',
    lugar_especifico: orPlaceholder(incidente.lugar_especifico, 3),
    puesto_afectado: orPlaceholder(puestoAfectado, 2),
    // — lesión (sin fuente directa en el incidente -> defaults a completar) —
    tipo_lesion: ['otros'],
    partes_cuerpo_afectadas: ['otros'],
    gravedad,
    dias_baja_estimados,
    // — descripción —
    testigos_presentes: false,
    descripcion_inicial: incidente.descripcion,
  };

  const titulo = `Investigación de accidente — ${cliente.razon_social} — ${incidente.fecha}`;

  return { metadata, titulo };
}
