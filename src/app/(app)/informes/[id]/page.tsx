import type { FieldValues } from 'react-hook-form';
import type { InformeStatus, InformeTipo } from '../schema';
import type { AttachmentClientRow } from './editar/AttachmentsSection';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { civilIsoToDate } from '@/app/(app)/calendario/event-form-helpers';
import { EVENT_STATUS_LABELS } from '@/app/(app)/calendario/labels';
import { getEventsByInformeId } from '@/app/(app)/calendario/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createSignedAttachmentUrls } from '@/shared/storage/attachments';
import { SIGNED_URL_TTL_UI_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';
import { TEMPLATE_CLIENT_REGISTRY } from '@/shared/templates/registry/client';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

import { getInformeById, getInformeMetadata } from '../queries';
import { INFORME_STATUS_LABELS, INFORME_TIPO_LABELS } from '../schema';
import { getInformeAttachments } from './attachments/queries';
import { DownloadPdfButton } from './DownloadPdfButton';
import { AttachmentsSection } from './editar/AttachmentsSection';
import { PublishButton } from './editar/PublishButton';
import { MarkdownPreview } from './MarkdownPreview';

/**
 * T-020 · Detalle de informe (read-only).
 * T-022 · Summary renderizado dinamicamente via TEMPLATE_CLIENT_REGISTRY[tipo].
 * T-024-FU0 · Suma seccion de adjuntos en modo read-only (sin botones upload/
 * delete/reorder, captions no editables). Reusa AttachmentsSection.tsx con
 * prop canEdit={false} — el componente ya tiene los gates internos.
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

  // T-024-FU0: attachments + signed URLs (mismo patron que /editar, TTL 1h).
  // Si no hay attachments, dejamos el array vacio y el componente NO renderea
  // la seccion (el empty state "No hay adjuntos todavía" solo aparece en
  // /editar, ya que aca el caller decide si pasar el componente o no).
  // T-036: eventos vinculados al informe (seccion al final del detail view).
  const linkedEvents = await getEventsByInformeId(supabase, informe.id);

  const attachmentRows = await getInformeAttachments(supabase, informe.id);
  let attachments: AttachmentClientRow[] = [];
  if (attachmentRows.length > 0) {
    const signedUrls = await createSignedAttachmentUrls(
      supabase,
      attachmentRows.map((a) => a.storage_path),
      SIGNED_URL_TTL_UI_SEC,
    );
    attachments = attachmentRows.map((a) => ({
      id: a.id,
      kind: a.kind as 'image' | 'file',
      filename: a.filename,
      mime_type: a.mime_type,
      size_bytes: a.size_bytes,
      caption: a.caption,
      position: a.position,
      signedUrl: signedUrls.get(a.storage_path) ?? null,
    }));
  }

  const tipoLabel = INFORME_TIPO_LABELS[tipo] ?? informe.tipo;
  const statusLabel = INFORME_STATUS_LABELS[informe.status as InformeStatus] ?? informe.status;
  const createdAt = new Date(informe.created_at).toLocaleString('es-AR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">
            <Link href="/informes" className="hover:text-foreground hover:underline">
              ← Volver a Informes
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
            {informe.titulo}
          </h1>
          <p className="text-muted-foreground text-sm">
            {tipoLabel} · {statusLabel} · Creado {createdAt}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DownloadPdfButton
            informeId={informe.id}
            hasContent={!!informe.contenido && informe.contenido.trim() !== ''}
          />
          {canEdit && (
            <Button asChild>
              <Link href={`/informes/${informe.id}/editar`}>Editar</Link>
            </Button>
          )}
          {/* T-036: PublishButton tambien disponible desde detail view sin
              entrar a /editar. Si toggle OFF + tipo recurrente + publish OK,
              el modal NO aparece aqui (PostPublishEventDialog vive solo en
              /editar) — el user recibe toast simple "Informe publicado". */}
          {consultora && (
            <PublishButton
              informeId={informe.id}
              status={informe.status as InformeStatus}
              informeTipo={tipo}
              canPublish={canEdit}
              autoCreateEventOnSign={consultora.autoCreateEventOnSign}
              hasLinkedEvent={linkedEvents.length > 0}
            />
          )}
        </div>
      </div>
      {metadataRow && SummaryComponent && (
        <SummaryComponent metadata={metadataRow.data as FieldValues} />
      )}
      {attachments.length > 0 && (
        <AttachmentsSection
          informeId={informe.id}
          initialAttachments={attachments}
          canEdit={false}
        />
      )}
      <Card>
        <CardContent className="px-6 py-6">
          <MarkdownPreview content={informe.contenido} />
        </CardContent>
      </Card>

      {/* T-036: vencimientos vinculados (eventos con informe_id = este informe).
          Solo se renderiza si hay al menos uno. NO clutter visual si no hay. */}
      {linkedEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Vencimientos vinculados</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {linkedEvents.map((ev) => (
                <li key={ev.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/calendario/agenda?event=${ev.id}`}
                    className="hover:underline"
                    data-testid={`linked-event-${ev.id}`}
                  >
                    <Badge variant={statusBadgeVariant(ev.status)} className="text-xs">
                      {EVENT_STATUS_LABELS[ev.status as keyof typeof EVENT_STATUS_LABELS] ??
                        ev.status}
                    </Badge>
                    <span className="ml-2 font-medium">{ev.titulo}</span>
                    <span className="text-muted-foreground ml-2">
                      ·{' '}
                      {format(civilIsoToDate(ev.fecha_vencimiento), "d 'de' MMM yyyy", {
                        locale: es,
                      })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function statusBadgeVariant(status: string): 'default' | 'destructive' | 'outline' | 'secondary' {
  switch (status) {
    case 'completed':
      return 'default';
    case 'cancelled':
      return 'secondary';
    case 'pending':
      return 'outline';
    default:
      return 'outline';
  }
}
