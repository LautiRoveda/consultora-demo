import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { AsistenteChat } from './asistente-client';

/**
 * T-117 · Página del asistente IA contextual de EPP.
 *
 * Shell server (mismo guard de auth/consultora que el resto de `(app)`); el chat
 * vive en un client component que mantiene el historial en memoria y lo manda
 * completo en cada request (stateless — no se persiste en el MVP).
 */
export default async function AsistentePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Asistente</h1>
        <p className="text-sm text-muted-foreground">
          Preguntá en lenguaje natural sobre tus empleados y su EPP: quién, qué se le entregó y
          cuándo le vence. El asistente sólo responde con datos de tu consultora.
        </p>
      </header>
      <AsistenteChat />
    </div>
  );
}
