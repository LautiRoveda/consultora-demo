import type { Turn } from './schema';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { AsistenteShell } from './asistente-shell';
import { getChatConversaciones, getChatMensajes } from './queries';
import { conversacionIdSchema } from './schema';

/**
 * T-117 · Página del asistente IA contextual (EPP + inspecciones + CAPAs).
 *
 * Shell server (mismo guard de auth/consultora que el resto de `(app)`).
 *
 * T-126 · Persistencia. Carga la lista de conversaciones del usuario (sidebar) y,
 * si la URL trae `?c=<id>`, los mensajes de esa conversación (RLS los oculta si no
 * son del usuario -> tratamos como nueva). El chat sigue en un client component que
 * mantiene el turno en curso en memoria y persiste cada turno vía server action.
 */
export default async function AsistentePage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const { c } = await searchParams;
  const conversaciones = await getChatConversaciones(supabase);

  let initialMessages: Turn[] = [];
  let activeConversacionId: string | null = null;
  const parsedC = conversacionIdSchema.safeParse(c);
  if (parsedC.success) {
    const mensajes = await getChatMensajes(supabase, parsedC.data);
    if (mensajes.length > 0) {
      initialMessages = mensajes;
      activeConversacionId = parsedC.data;
    }
    // Vacío => RLS ocultó una conversación ajena o no existe: la tratamos como nueva.
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">Asistente</h1>
        <p className="text-sm text-muted-foreground">
          Preguntá en lenguaje natural sobre tus empleados y su EPP, tus inspecciones y CAPAs. El
          asistente sólo responde con datos de tu consultora. Tus conversaciones quedan guardadas.
        </p>
      </header>
      <AsistenteShell
        conversaciones={conversaciones}
        activeConversacionId={activeConversacionId}
        initialMessages={initialMessages}
      />
    </div>
  );
}
