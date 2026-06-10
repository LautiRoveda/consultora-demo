'use server';

import type { Json } from '@/shared/supabase/types';
import type { PlantillaConfig } from '@/shared/templates/registry/plantilla-config';
import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import {
  isPlantillaConfigVacia,
  normalizePlantillaConfig,
  PLANTILLA_CONFIG_SCHEMA_BY_TIPO,
} from '@/shared/templates/registry/plantilla-config';

import { createPlantillaSchema, plantillaIdSchema, renamePlantillaSchema } from './schema';

/**
 * T-139 · Server actions de plantillas de informes ("Mis plantillas").
 *
 * Mismo patron que informes/actions.ts: discriminated union de retorno, NUNCA
 * tira.
 *
 * SIN billing gate (decision del owner, T-139): se gatea donde hay costo/valor
 * de IA (crear/generar informes); la plantilla es config sin costo ni consumo,
 * por eso ni el create ni rename/archive lo llevan — un trial vencido puede
 * ordenar sus presets y los tiene listos al reactivar.
 *
 * No hay action "aplicar": aplicar es client-side (degradePlantillaConfig +
 * copiar al form) y la persistencia pasa por el flujo existente de informes,
 * que re-valida contra `<tipo>MetadataSchema`.
 */

/** 23505 = unique_violation (idx_informe_plantillas_nombre, parcial activos). */
const PG_UNIQUE_VIOLATION = '23505';

const NOMBRE_DUPLICADO = 'Ya existe una plantilla activa con ese nombre para este tipo.';

export type CreatePlantillaResult =
  | { ok: true; plantillaId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR'; message: string };

export async function createPlantillaAction(input: unknown): Promise<CreatePlantillaResult> {
  const parsed = createPlantillaSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors,
      message: 'Revisá los campos del formulario.',
    };
  }

  // Config re-validada con el schema strict del tipo: rechaza datos del
  // cliente (keys por-informe), secciones de otro tipo y over-cap. El detalle
  // de issues va al log, no al user: el dialog solo edita `nombre` — la config
  // sale del form de personalizacion, que ya la valido campo a campo.
  const configParsed = PLANTILLA_CONFIG_SCHEMA_BY_TIPO[parsed.data.tipo].safeParse(
    parsed.data.config,
  );
  if (!configParsed.success) {
    logger.warn(
      { tipo: parsed.data.tipo, issues: configParsed.error.issues },
      'createPlantillaAction: config invalida para el tipo',
    );
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { config: ['La configuración no es válida para este tipo de informe.'] },
      message: 'La configuración de la plantilla no es válida.',
    };
  }

  const config = normalizePlantillaConfig(parsed.data.tipo, configParsed.data as PlantillaConfig);
  // Post-normalize y no en el schema: "solo secciones en default" pasa el
  // parse pero normaliza a vacia — aplicar esa plantilla seria un no-op.
  if (isPlantillaConfigVacia(config)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { config: ['La plantilla necesita al menos una personalización.'] },
      message: 'Personalizá algo antes de guardar la plantilla.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Iniciá sesión para guardar plantillas.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    logger.warn({ userId: user.id }, 'createPlantillaAction: user sin consultora');
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const { data, error } = await supabase
    .from('informe_plantillas')
    .insert({
      consultora_id: consultora.id,
      tipo: parsed.data.tipo,
      nombre: parsed.data.nombre,
      config: config as Json,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    if (error?.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        fieldErrors: { nombre: [NOMBRE_DUPLICADO] },
        message: NOMBRE_DUPLICADO,
      };
    }
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id },
      'createPlantillaAction: insert fallo',
    );
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No pudimos guardar la plantilla.' };
  }

  revalidatePath('/informes/plantillas');
  return { ok: true, plantillaId: data.id };
}

export type UpdatePlantillaResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | { ok: false; code: 'UNAUTHENTICATED' | 'NOT_FOUND' | 'INTERNAL_ERROR'; message: string };

export async function renamePlantillaAction(input: unknown): Promise<UpdatePlantillaResult> {
  const parsed = renamePlantillaSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    return { ok: false, code: 'INVALID_INPUT', fieldErrors, message: 'Revisá el nombre.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };
  }

  // RLS scopea al tenant; el filtro archived_at evita renombrar archivadas
  // (la gestion solo lista activas y el unique parcial solo cubre activas).
  const { data, error } = await supabase
    .from('informe_plantillas')
    .update({ nombre: parsed.data.nombre })
    .eq('id', parsed.data.id)
    .is('archived_at', null)
    .select('id');

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        fieldErrors: { nombre: [NOMBRE_DUPLICADO] },
        message: NOMBRE_DUPLICADO,
      };
    }
    logger.error({ err: error, userId: user.id }, 'renamePlantillaAction: update fallo');
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No pudimos renombrar la plantilla.' };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Plantilla no encontrada (o no pertenece a tu consultora).',
    };
  }

  revalidatePath('/informes/plantillas');
  return { ok: true };
}

export async function archivePlantillaAction(input: unknown): Promise<UpdatePlantillaResult> {
  const parsed = plantillaIdSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      fieldErrors: { id: ['UUID inválido.'] },
      message: 'Identificador inválido.',
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, code: 'UNAUTHENTICATED', message: 'Iniciá sesión.' };
  }

  // Soft delete (DELETE es default-deny en la tabla). Snapshot-on-apply:
  // archivar no toca informes que ya copiaron esta config.
  const { data, error } = await supabase
    .from('informe_plantillas')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .is('archived_at', null)
    .select('id');

  if (error) {
    logger.error({ err: error, userId: user.id }, 'archivePlantillaAction: update fallo');
    return { ok: false, code: 'INTERNAL_ERROR', message: 'No pudimos archivar la plantilla.' };
  }
  if (!data || data.length === 0) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'Plantilla no encontrada (o ya estaba archivada).',
    };
  }

  revalidatePath('/informes/plantillas');
  return { ok: true };
}
