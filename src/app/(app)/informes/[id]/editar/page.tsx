import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { getInformeById, getInformeMetadata } from '../../queries';
import { type InformeTipo } from '../../schema';
import { EditorView } from './EditorView';

/**
 * T-020 · Editor de informe.
 * T-021 · Fetcha metadata para tipo='rgrl' y la pasa al EditorView para el
 *         panel Collapsible arriba del editor de contenido.
 *
 * Server component que valida acceso y delega al EditorView client.
 *
 * Permission gate: si el user no es creator NI owner de la consultora,
 * redirige a `/informes/[id]` (no a `/login`) — el read-view del informe
 * sigue siendo accesible.
 */
export default async function InformeEditarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const informe = await getInformeById(supabase, id);
  if (!informe) notFound();

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/login?error=no_consultora');

  const canEdit = informe.created_by === user.id || consultora.role === 'owner';
  if (!canEdit) {
    redirect(`/informes/${informe.id}`);
  }

  // T-021: solo cargar metadata para tipo='rgrl'. Los otros 4 tipos no tienen
  // template parametrizado todavia (T-022 los suma).
  const metadata = informe.tipo === 'rgrl' ? await getInformeMetadata(supabase, informe.id) : null;

  return (
    <EditorView
      informeId={informe.id}
      tipo={informe.tipo as InformeTipo}
      titulo={informe.titulo}
      initialContent={informe.contenido}
      initialMetadata={metadata}
    />
  );
}
