'use server';

import { redirect } from 'next/navigation';

import { logger } from '@/shared/observability/logger';
import { createClient } from '@/shared/supabase/server';

/**
 * Server action de logout. Invocada desde el user menu del shell autenticado
 * (`AppUserMenu`) y desde cualquier `<form action={signOutAction}>` legacy.
 *
 * Movida en T-017 desde `src/app/dashboard/actions.ts` — el sidebar la
 * consume desde fuera del feature dashboard, así que ubicación compartida
 * es honesta.
 *
 * `supabase.auth.signOut()` borra la cookie via el cookie writer del server
 * client. `redirect('/login')` tira NEXT_REDIRECT que Next.js intercepta.
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
