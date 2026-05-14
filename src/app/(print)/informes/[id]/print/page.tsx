import type { InformeStatus, InformeTipo } from '@/app/(app)/informes/schema';
import type { AttachmentForPrint } from './PrintTemplate';
import { notFound } from 'next/navigation';

import { getInformeAttachments } from '@/app/(app)/informes/[id]/attachments/queries';
import { getInformeById, getInformeMetadata } from '@/app/(app)/informes/queries';
import { INFORME_STATUSES, INFORME_TIPOS } from '@/app/(app)/informes/schema';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createSignedAttachmentUrls } from '@/shared/storage/attachments';
import { createSignedLogoUrl } from '@/shared/storage/logo';
import { SIGNED_URL_TTL_PDF_RENDER_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';

import { PrintTemplate } from './PrintTemplate';

/**
 * T-023 · Vista imprimible de un informe.
 * T-024 · Suma logo de consultora + secciones de anexos (visuales + descargables).
 *
 * Solo accesible via fetch interno del route handler `/api/informes/[id]/pdf`
 * (el layout (print)/layout.tsx valida el header `x-internal-pdf-render`).
 *
 * Las signed URLs se generan con TTL 5 min (suficiente para Puppeteer setContent
 * + page.pdf + buffer). Puppeteer hace fetch de cada `<img>` y bloquea hasta
 * networkidle0 — las URLs deben estar vivas durante todo el render.
 */
export default async function InformePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const informe = await getInformeById(supabase, id);
  if (!informe) notFound();

  if (!(INFORME_TIPOS as readonly string[]).includes(informe.tipo)) notFound();
  if (!(INFORME_STATUSES as readonly string[]).includes(informe.status)) notFound();

  const tipo = informe.tipo as InformeTipo;
  const status = informe.status as InformeStatus;
  const metadata = await getInformeMetadata(supabase, informe.id, tipo);

  // T-024: branding + attachments. La consultora viene del auth del request
  // (el internal fetch del route handler PDF inyecta las cookies del user).
  const consultora = user ? await getCurrentConsultora(supabase, user.id) : null;

  let logoSignedUrl: string | null = null;
  if (consultora?.logoStoragePath) {
    const { signedUrl } = await createSignedLogoUrl(
      supabase,
      consultora.logoStoragePath,
      SIGNED_URL_TTL_PDF_RENDER_SEC,
    );
    logoSignedUrl = signedUrl;
  }

  const attachmentRows = await getInformeAttachments(supabase, informe.id);
  const signedUrlMap = await createSignedAttachmentUrls(
    supabase,
    attachmentRows.map((a) => a.storage_path),
    SIGNED_URL_TTL_PDF_RENDER_SEC,
  );
  const attachments: AttachmentForPrint[] = attachmentRows.map((a) => ({
    id: a.id,
    kind: a.kind as 'image' | 'file',
    filename: a.filename,
    mime_type: a.mime_type,
    size_bytes: a.size_bytes,
    caption: a.caption,
    position: a.position,
    signedUrl: signedUrlMap.get(a.storage_path) ?? null,
  }));

  return (
    <PrintTemplate
      informe={{
        id: informe.id,
        tipo,
        titulo: informe.titulo,
        status,
        contenido: informe.contenido,
        created_at: informe.created_at,
      }}
      metadata={metadata}
      branding={{
        consultoraName: consultora?.name ?? 'ConsultoraDemo',
        logoSignedUrl,
      }}
      attachments={attachments}
    />
  );
}
