import { notFound } from 'next/navigation';

import { getPresentacionById } from '@/app/(app)/rar/queries';
import { parseRarSnapshot } from '@/app/(app)/rar/snapshot';
import { RarPlanillaTemplate } from '@/app/(print)/rar/planilla/[clienteId]/print/RarPlanillaTemplate';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createSignedLogoUrl } from '@/shared/storage/logo';
import { SIGNED_URL_TTL_PDF_RENDER_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';

/**
 * T-147 · Vista imprimible de una presentación HISTÓRICA del RAR.
 *
 * A diferencia del print de Fase 2 (`/rar/planilla/[clienteId]/print`, que
 * renderea la nómina VIVA), este renderea el `snapshot` congelado de
 * `rar_presentaciones` — el documento refleja lo efectivamente presentado, no
 * la nómina actual que pudo cambiar.
 *
 * Solo accesible via fetch interno del route handler
 * `/api/rar/presentaciones/[presentacionId]/pdf`. El layout (print)/layout.tsx
 * valida el header `x-internal-pdf-render` — acceso directo desde browser →
 * notFound().
 *
 * Defense in depth: notFound si la presentación no existe o es cross-tenant
 * (RLS ya filtra, pero chequeamos `consultora_id === consultora.id`).
 *
 * `generatedAt` = `generado_at` del snapshot (fallback fecha de presentación):
 * el template deriva el período del año de `generatedAt`, así el header muestra
 * el período presentado, no el año actual.
 */
export default async function RarPresentacionPrintPage({
  params,
}: {
  params: Promise<{ presentacionId: string }>;
}) {
  const { presentacionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) notFound();

  const presentacion = await getPresentacionById(supabase, presentacionId);
  if (!presentacion) notFound();
  if (presentacion.consultora_id !== consultora.id) notFound();

  const parsed = parseRarSnapshot(presentacion.snapshot, presentacion.periodo);

  let logoSignedUrl: string | null = null;
  if (consultora.logoStoragePath) {
    const { signedUrl } = await createSignedLogoUrl(
      supabase,
      consultora.logoStoragePath,
      SIGNED_URL_TTL_PDF_RENDER_SEC,
    );
    logoSignedUrl = signedUrl;
  }

  const generatedAt =
    parsed.generadoAt ??
    (parsed.fechaPresentacion
      ? `${parsed.fechaPresentacion}T12:00:00.000Z`
      : `${presentacion.periodo}-01-01T12:00:00.000Z`);

  return (
    <RarPlanillaTemplate
      cliente={parsed.cliente}
      nomina={parsed.nomina}
      logoSignedUrl={logoSignedUrl}
      consultoraName={consultora.name}
      generatedAt={generatedAt}
    />
  );
}
