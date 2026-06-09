import { notFound } from 'next/navigation';

import { getEjecucionForPdf } from '@/app/(app)/checklists/ejecuciones/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createSignedChecklistAdjuntoUrl } from '@/shared/storage/checklist-adjuntos';
import { createSignedChecklistFirmaUrl } from '@/shared/storage/checklist-firmas';
import { createSignedLogoUrl } from '@/shared/storage/logo';
import { SIGNED_URL_TTL_PDF_RENDER_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';

import { ChecklistInspeccionTemplate } from './ChecklistInspeccionTemplate';

/**
 * T-060b · Vista imprimible del Relevamiento RGRL (Res SRT 463/09).
 *
 * Solo accesible vía el fetch interno del route `/api/checklists/ejecuciones/[id]/pdf`
 * (el layout (print) valida el header `x-internal-pdf-render`). Defense in depth:
 * notFound si no existe / cross-tenant / no está cerrada.
 *
 * Signed URLs (firma + adjuntos + logo) con TTL 5 min — suficiente para Puppeteer.
 */
export default async function ChecklistInspeccionPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) notFound();

  const data = await getEjecucionForPdf(supabase, id);
  if (!data) notFound();
  if (data.execution.consultora_id !== consultora.id) notFound();
  if (data.execution.estado !== 'cerrada') notFound();

  // Firma del matriculado.
  let firmaSignedUrl: string | null = null;
  if (data.firmaMatriculado?.firma_storage_path) {
    const { signedUrl } = await createSignedChecklistFirmaUrl(
      supabase,
      data.firmaMatriculado.firma_storage_path,
      SIGNED_URL_TTL_PDF_RENDER_SEC,
    );
    firmaSignedUrl = signedUrl;
  }

  // Adjuntos (fotos) → signed URLs, indexados por respuesta_id.
  const adjuntosByRespuesta: Record<string, string[]> = {};
  for (const adj of data.adjuntos) {
    if (!adj.respuesta_id) continue;
    const { signedUrl } = await createSignedChecklistAdjuntoUrl(
      supabase,
      adj.storage_path,
      SIGNED_URL_TTL_PDF_RENDER_SEC,
    );
    if (!signedUrl) continue;
    (adjuntosByRespuesta[adj.respuesta_id] ??= []).push(signedUrl);
  }

  // Logo de la consultora.
  let logoSignedUrl: string | null = null;
  if (consultora.logoStoragePath) {
    const { signedUrl } = await createSignedLogoUrl(
      supabase,
      consultora.logoStoragePath,
      SIGNED_URL_TTL_PDF_RENDER_SEC,
    );
    logoSignedUrl = signedUrl;
  }

  return (
    <ChecklistInspeccionTemplate
      execution={data.execution}
      sections={data.sections}
      respuestasByItemId={data.respuestasByItemId}
      adjuntosByRespuesta={adjuntosByRespuesta}
      firma={data.firmaMatriculado}
      firmaSignedUrl={firmaSignedUrl}
      logoSignedUrl={logoSignedUrl}
      consultoraName={consultora.name}
      generatedAt={new Date().toISOString()}
    />
  );
}
