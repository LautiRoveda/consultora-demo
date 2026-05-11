'use server';

import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

import { createInformeSchema } from './schema';

/**
 * T-019 · Server actions del modulo Informes.
 *
 * Mismo patron que login/signup (T-012/T-013): discriminated union de retorno,
 * NUNCA tira. El cliente patternmatchea sobre `code` para UX.
 */

export type CreateInformeResult =
  | { ok: true; redirectTo: string; informeId: string }
  | { ok: false; code: 'INVALID_INPUT'; fieldErrors: Record<string, string[]>; message: string }
  | {
      ok: false;
      code: 'UNAUTHENTICATED' | 'NO_CONSULTORA' | 'INTERNAL_ERROR';
      message: string;
    };

/**
 * Crea un informe en la consultora del user logueado.
 *
 * Pasos:
 * 1. Zod safeParse. INVALID_INPUT con fieldErrors si falla (RHF muestra inline).
 * 2. getUser → UNAUTHENTICATED si null. El layout `(app)` ya guardea esto,
 *    pero defensa en profundidad: una action es un endpoint POST publico.
 * 3. getCurrentConsultora → NO_CONSULTORA si null (user huerfano).
 * 4. INSERT con created_by=auth.uid(). RLS WITH CHECK valida member + ownership.
 * 5. revalidatePath de la lista para que el redirect a `/informes/[id]` vea
 *    el row recien creado al volver a `/informes`.
 *
 * Retorna `redirectTo` con el id del informe — el client navega y refresha.
 */
export async function createInformeAction(input: unknown): Promise<CreateInformeResult> {
  const parsed = createInformeSchema.safeParse(input);
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: 'UNAUTHENTICATED',
      message: 'Iniciá sesión para crear un informe.',
    };
  }

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) {
    logger.warn({ userId: user.id }, 'createInformeAction: user sin consultora');
    return {
      ok: false,
      code: 'NO_CONSULTORA',
      message: 'Tu cuenta no tiene una consultora vinculada.',
    };
  }

  const { data, error } = await supabase
    .from('informes')
    .insert({
      consultora_id: consultora.id,
      tipo: parsed.data.tipo,
      titulo: parsed.data.titulo,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (error || !data) {
    logger.error(
      { err: error, userId: user.id, consultoraId: consultora.id },
      'createInformeAction: insert fallo',
    );
    return {
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Hubo un error creando el informe. Reintentá en unos minutos.',
    };
  }

  revalidatePath('/informes');
  logger.info(
    { informeId: data.id, userId: user.id, consultoraId: consultora.id, tipo: parsed.data.tipo },
    'informe_created',
  );

  return {
    ok: true,
    redirectTo: `/informes/${data.id}`,
    informeId: data.id,
  };
}
