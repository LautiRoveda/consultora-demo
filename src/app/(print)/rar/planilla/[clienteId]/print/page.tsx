import { notFound } from 'next/navigation';

import { getClienteById } from '@/app/(app)/clientes/queries';
import { listExpuestosByCliente } from '@/app/(app)/rar/queries';
import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createSignedLogoUrl } from '@/shared/storage/logo';
import { SIGNED_URL_TTL_PDF_RENDER_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';

import { RarPlanillaTemplate } from './RarPlanillaTemplate';

/**
 * T-144 · Vista imprimible de la Planilla RAR (Res SRT 37/2010 + Dto 658/96).
 *
 * Solo accesible via fetch interno del route handler
 * `/api/rar/planilla/[clienteId]/pdf`. El layout (print)/layout.tsx valida el
 * header `x-internal-pdf-render` — acceso directo desde browser → notFound().
 *
 * Defense in depth respecto a RLS:
 *  - notFound si el cliente no existe o es cross-tenant (RLS ya filtra, pero
 *    chequeamos `consultora_id === consultora.id` por las dudas).
 *  - A diferencia de la planilla EPP, la nómina vacía es un caso VÁLIDO: el PDF
 *    se genera igual declarando "sin personal expuesto" (T-144 D5).
 *
 * La signed URL del logo usa TTL 5 min — suficiente para Puppeteer setContent +
 * page.pdf + buffer.
 */
export default async function RarPlanillaPrintPage({
  params,
}: {
  params: Promise<{ clienteId: string }>;
}) {
  const { clienteId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) notFound();

  const cliente = await getClienteById(supabase, clienteId);
  if (!cliente) notFound();
  if (cliente.consultora_id !== consultora.id) notFound();

  const nomina = await listExpuestosByCliente(supabase, clienteId);

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
    <RarPlanillaTemplate
      cliente={{
        razon_social: cliente.razon_social,
        cuit: cliente.cuit,
        domicilio: cliente.domicilio,
        localidad: cliente.localidad,
        provincia: cliente.provincia,
        art: cliente.art,
      }}
      nomina={nomina}
      logoSignedUrl={logoSignedUrl}
      consultoraName={consultora.name}
      generatedAt={new Date().toISOString()}
    />
  );
}
