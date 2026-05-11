import type { InformeStatus, InformeTipo } from '../schema';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { getInformeById } from '../queries';
import { INFORME_STATUS_LABELS, INFORME_TIPO_LABELS } from '../schema';

/**
 * T-019 · Detalle de informe (placeholder).
 *
 * El editor de `contenido` llega en T-020 con generacion via Claude API.
 * Por ahora solo muestra metadata + un mensaje de que el cuerpo se va a
 * generar en el proximo sprint.
 */
export default async function InformeDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const informe = await getInformeById(supabase, id);
  if (!informe) notFound();

  const tipoLabel = INFORME_TIPO_LABELS[informe.tipo as InformeTipo] ?? informe.tipo;
  const statusLabel = INFORME_STATUS_LABELS[informe.status as InformeStatus] ?? informe.status;
  const createdAt = new Date(informe.created_at).toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/informes" className="hover:text-foreground hover:underline">
            ← Volver a Informes
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{informe.titulo}</h1>
        <p className="text-muted-foreground text-sm">
          {tipoLabel} · {statusLabel} · Creado {createdAt}
        </p>
      </div>
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center text-sm">
          <p className="text-foreground font-medium">Contenido pendiente</p>
          <p className="mx-auto mt-2 max-w-md">
            El editor y la generación con IA llegan en el próximo sprint (T-020). Por ahora el
            informe queda como borrador con su título.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
