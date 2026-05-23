import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { EntregaDetailView } from '../EntregaDetailView';
import { getEntregaById, getSignedUrlForFirma, listPlanificacionesByEntrega } from '../queries';

export default async function EntregaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const entrega = await getEntregaById(supabase, id);
  if (!entrega) notFound();

  const [firmaUrl, planificaciones] = await Promise.all([
    entrega.firma_storage_path
      ? getSignedUrlForFirma(supabase, entrega.firma_storage_path)
      : Promise.resolve(null),
    listPlanificacionesByEntrega(supabase, id),
  ]);

  return (
    <div className="max-w-4xl space-y-4">
      <EntregaDetailView entrega={entrega} firmaUrl={firmaUrl} planificaciones={planificaciones} />
    </div>
  );
}
