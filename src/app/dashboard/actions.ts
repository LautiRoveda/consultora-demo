'use server';

import { redirect } from 'next/navigation';

import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

/**
 * Server action de logout invocada desde el form del dashboard.
 *
 * `supabase.auth.signOut()` borra el cookie de sesión via el cookie writer
 * del server client. `redirect('/login')` tira NEXT_REDIRECT que Next.js
 * intercepta y devuelve un redirect al cliente — el flujo normal.
 *
 * T-014 va a sumar tests + integración con password recovery.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  logger.info({ userId: user?.id }, 'signout_completed');
  redirect('/login');
}
