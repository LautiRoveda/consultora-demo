import { notFound } from 'next/navigation';

import { getEntregaForPlanilla } from '@/app/(app)/epp/entregas/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createSignedEppFirmaUrl } from '@/shared/storage/epp-firmas';
import { createSignedLogoUrl } from '@/shared/storage/logo';
import { SIGNED_URL_TTL_PDF_RENDER_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';

import { EppPlanillaTemplate } from './EppPlanillaTemplate';

/**
 * T-104 · Vista imprimible de la Planilla EPP Res SRT 299/11.
 *
 * Solo accesible via fetch interno del route handler `/api/epp/entregas/[id]/pdf`.
 * El layout (print)/layout.tsx valida el header `x-internal-pdf-render` —
 * acceso directo desde browser → notFound().
 *
 * Aplica defense in depth respecto a RLS:
 *  - notFound si la entrega no existe o cross-tenant (RLS ya filtra, pero
 *    chequeamos `consultora_id === consultora.id` por las dudas).
 *  - notFound si NO está firmada (la planilla legal requiere firma) o si
 *    no tiene items (defensive, schema no lo permitiría).
 *
 * Las signed URLs (firma + logo) usan TTL 5 min — suficiente para Puppeteer
 * setContent + page.pdf + buffer.
 */
export default async function EppEntregaPlanillaPrintPage({
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

  const entrega = await getEntregaForPlanilla(supabase, id);
  if (!entrega) notFound();

  if (entrega.consultora_id !== consultora.id) notFound();
  if (!entrega.firmado_at || !entrega.firma_storage_path) notFound();
  if (entrega.items.length === 0) notFound();

  const { signedUrl: firmaSignedUrl } = await createSignedEppFirmaUrl(
    supabase,
    entrega.firma_storage_path,
    SIGNED_URL_TTL_PDF_RENDER_SEC,
  );

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
    <EppPlanillaTemplate
      entrega={entrega}
      firmaSignedUrl={firmaSignedUrl}
      logoSignedUrl={logoSignedUrl}
      consultoraName={consultora.name}
      generatedAt={new Date().toISOString()}
    />
  );
}
