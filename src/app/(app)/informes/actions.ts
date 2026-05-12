'use server';

import type { Json } from '@/shared/supabase/types';
import { revalidatePath } from 'next/cache';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';
import { getServerTemplate } from '@/shared/templates/registry/server';

import { createInformeSchema } from './schema';

/**
 * T-019 · Server actions del modulo Informes.
 * T-022 · Generaliza la persistencia de metadata via TEMPLATE_SERVER_REGISTRY.
 *
 * Mismo patron que login/signup (T-012/T-013): discriminated union de retorno,
 * NUNCA tira. El cliente patternmatchea sobre `code` para UX.
 */

export type CreateInformeResult =
  | {
      ok: true;
      redirectTo: string;
      informeId: string;
      /** T-021/T-022: true si la metadata estructurada se persistio junto con el informe. */
      metadataPersisted: boolean;
    }
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
 * 5. (T-022) Si vino metadata y el tipo tiene template registrado, parsearla
 *    contra el schema del registry e INSERT a `informe_metadata`. Fallback no
 *    bloqueante: si Zod o RLS race fallan, el informe queda creado sin
 *    metadata y el user la completa en /editar.
 * 6. revalidatePath de la lista.
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

  // T-022 · Generalizacion de metadata via registry. Aplica a los 5 tipos.
  // No bloqueante: si Zod o RLS race fallan, el informe queda creado sin
  // metadata y el user la completa en /editar.
  let metadataPersisted = false;
  const tipoEntry = getServerTemplate(parsed.data.tipo);
  if (tipoEntry && parsed.data.metadata !== undefined) {
    const parsedMeta = tipoEntry.schema.safeParse(parsed.data.metadata);
    if (!parsedMeta.success) {
      logger.warn(
        {
          informeId: data.id,
          tipo: parsed.data.tipo,
          userId: user.id,
          consultoraId: consultora.id,
          issueCount: parsedMeta.error.issues.length,
        },
        'createInformeAction: metadata invalida, informe creado sin datos',
      );
    } else {
      const cleaned = tipoEntry.normalize(parsedMeta.data);
      const { error: metaErr } = await supabase
        .from('informe_metadata')
        // Cast a Json: el normalize() retorna un objeto plano serializable por
        // construccion (todos los `<Tipo>Metadata` lo son), pero TS no lo infiere.
        .insert({ informe_id: data.id, data: cleaned as Json });

      if (metaErr) {
        logger.warn(
          {
            err: metaErr,
            informeId: data.id,
            tipo: parsed.data.tipo,
            userId: user.id,
            consultoraId: consultora.id,
          },
          'createInformeAction: metadata insert fallo, informe creado sin datos',
        );
      } else {
        metadataPersisted = true;
      }
    }
  }

  revalidatePath('/informes');
  logger.info(
    {
      informeId: data.id,
      userId: user.id,
      consultoraId: consultora.id,
      tipo: parsed.data.tipo,
      metadataPersisted,
    },
    'informe_created',
  );

  // Si vino metadata y el tipo tiene template, redirect a /editar (con datos
  // pre-poblados o form vacio si fallo). Si no, redirect a la vista del informe.
  const wantsEditor = tipoEntry !== null && parsed.data.metadata !== undefined;
  const redirectTo = wantsEditor ? `/informes/${data.id}/editar` : `/informes/${data.id}`;

  return {
    ok: true,
    redirectTo,
    informeId: data.id,
    metadataPersisted,
  };
}
