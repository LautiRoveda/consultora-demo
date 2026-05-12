import type { InformeStatus, InformeTipo } from '../schema';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

import { getInformeById } from '../queries';
import { INFORME_STATUS_LABELS, INFORME_TIPO_LABELS } from '../schema';
import { MarkdownPreview } from './MarkdownPreview';

/**
 * T-020 · Detalle de informe (read-only).
 *
 * Render del `contenido` via MarkdownPreview (react-markdown + remark-gfm +
 * rehype-sanitize). Boton "Editar" visible solo si el user es creator del
 * informe O owner de la consultora — el gate UI espeja la RLS UPDATE policy.
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

  const consultora = await getCurrentConsultora(supabase, user.id);
  const canEdit =
    consultora !== null && (informe.created_by === user.id || consultora.role === 'owner');

  const tipoLabel = INFORME_TIPO_LABELS[informe.tipo as InformeTipo] ?? informe.tipo;
  const statusLabel = INFORME_STATUS_LABELS[informe.status as InformeStatus] ?? informe.status;
  const createdAt = new Date(informe.created_at).toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
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
        {canEdit && (
          <Button asChild>
            <Link href={`/informes/${informe.id}/editar`}>Editar</Link>
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="px-6 py-6">
          <MarkdownPreview content={informe.contenido} />
        </CardContent>
      </Card>
    </div>
  );
}
