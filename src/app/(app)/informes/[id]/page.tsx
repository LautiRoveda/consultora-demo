import type { FieldValues } from 'react-hook-form';
import type { InformeStatus, InformeTipo } from '../schema';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { TEMPLATE_CLIENT_REGISTRY } from '@/shared/templates/registry/client';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

import { getInformeById, getInformeMetadata } from '../queries';
import { INFORME_STATUS_LABELS, INFORME_TIPO_LABELS } from '../schema';
import { DownloadPdfButton } from './DownloadPdfButton';
import { MarkdownPreview } from './MarkdownPreview';

/**
 * T-020 · Detalle de informe (read-only).
 * T-022 · Summary renderizado dinamicamente via TEMPLATE_CLIENT_REGISTRY[tipo].
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

  // T-022: getInformeMetadata es generico. Renderizamos el SummaryComponent
  // del tipo activo si hay metadata. Cero UI si no la hay (fallback al
  // markdown puro como pre-T-021).
  const tipo = informe.tipo as InformeTipo;
  const metadataRow = await getInformeMetadata(supabase, informe.id, tipo);
  const SummaryComponent = TEMPLATE_CLIENT_REGISTRY[tipo]?.SummaryComponent;

  const tipoLabel = INFORME_TIPO_LABELS[tipo] ?? informe.tipo;
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
        <div className="flex items-center gap-2">
          <DownloadPdfButton
            informeId={informe.id}
            hasContent={!!informe.contenido && informe.contenido.trim() !== ''}
          />
          {canEdit && (
            <Button asChild>
              <Link href={`/informes/${informe.id}/editar`}>Editar</Link>
            </Button>
          )}
        </div>
      </div>
      {metadataRow && SummaryComponent && (
        <SummaryComponent metadata={metadataRow.data as FieldValues} />
      )}
      <Card>
        <CardContent className="px-6 py-6">
          <MarkdownPreview content={informe.contenido} />
        </CardContent>
      </Card>
    </div>
  );
}
