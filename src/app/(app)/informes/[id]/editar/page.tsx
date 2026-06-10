import { notFound, redirect } from 'next/navigation';

import { getEventsByInformeId } from '@/app/(app)/calendario/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createSignedAttachmentUrls } from '@/shared/storage/attachments';
import { SIGNED_URL_TTL_UI_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';

import { type PlantillaClientItem } from '../../plantillas/PlantillaControls';
import { getPlantillasActivas } from '../../plantillas/queries';
import { getInformeById, getInformeMetadata } from '../../queries';
import { type InformeStatus, type InformeTipo } from '../../schema';
import { getInformeAttachments } from '../attachments/queries';
import { type AttachmentClientRow } from './AttachmentsSection';
import { EditorView } from './EditorView';

/**
 * T-020 · Editor de informe.
 * T-021 · Fetcha metadata para tipo='rgrl' y la pasa al EditorView para el
 *         panel Collapsible arriba del editor de contenido.
 * T-024 · Carga attachments + genera signed URLs (TTL 1h) para previews + downloads.
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

  const tipo = informe.tipo as InformeTipo;
  const metadataRow = await getInformeMetadata(supabase, informe.id, tipo);

  // T-139: plantillas activas del tipo para los PlantillaControls del editor.
  const plantillas: PlantillaClientItem[] = (await getPlantillasActivas(supabase, tipo)).map(
    (row) => ({ id: row.id, tipo, nombre: row.nombre, config: row.config }),
  );

  const attachments = await getInformeAttachments(supabase, informe.id);
  const signedUrls = await createSignedAttachmentUrls(
    supabase,
    attachments.map((a) => a.storage_path),
    SIGNED_URL_TTL_UI_SEC,
  );
  const attachmentRows: AttachmentClientRow[] = attachments.map((a) => ({
    id: a.id,
    kind: a.kind as 'image' | 'file',
    filename: a.filename,
    mime_type: a.mime_type,
    size_bytes: a.size_bytes,
    caption: a.caption,
    position: a.position,
    signedUrl: signedUrls.get(a.storage_path) ?? null,
  }));

  // T-036: contexto para PublishButton + PostPublishEventDialog.
  // - linkedEvents: si > 0, NO mostrar modal post-publish (ya hay evento).
  // - razonSocial: del metadata si esta presente, fallback al titulo del informe
  //   (PostPublishEventDialog usa para buildDefaultEventoTitulo).
  const linkedEvents = await getEventsByInformeId(supabase, informe.id);
  const metaData = metadataRow?.data;
  const razonSocial =
    metaData &&
    typeof metaData === 'object' &&
    !Array.isArray(metaData) &&
    'razon_social' in metaData &&
    typeof metaData.razon_social === 'string'
      ? (metaData as { razon_social: string }).razon_social
      : null;

  return (
    <EditorView
      informeId={informe.id}
      tipo={tipo}
      titulo={informe.titulo}
      initialContent={informe.contenido}
      initialMetadata={metadataRow?.data ?? null}
      initialStatus={informe.status as InformeStatus}
      attachments={attachmentRows}
      canEdit={canEdit}
      autoCreateEventOnSign={consultora.autoCreateEventOnSign}
      hasLinkedEvent={linkedEvents.length > 0}
      razonSocial={razonSocial}
      plantillas={plantillas}
    />
  );
}
