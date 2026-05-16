import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createSignedLogoUrl } from '@/shared/storage/logo';
import { SIGNED_URL_TTL_UI_SEC } from '@/shared/storage/types';
import { createClient } from '@/shared/supabase/server';

import { ConsultoraSettingsView } from './ConsultoraSettingsView';

/**
 * T-024 · Settings de la consultora — primer feature: logo.
 *
 * Permission gate: cualquier member ve el preview; solo owner puede editar
 * (gate UI + gate server-side en el route handler + action).
 */
export default async function ConsultoraSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/login?error=no_consultora');

  let logoSignedUrl: string | null = null;
  if (consultora.logoStoragePath) {
    const { signedUrl } = await createSignedLogoUrl(
      supabase,
      consultora.logoStoragePath,
      SIGNED_URL_TTL_UI_SEC,
    );
    logoSignedUrl = signedUrl;
  }

  return (
    <ConsultoraSettingsView
      consultoraName={consultora.name}
      consultoraRole={consultora.role}
      logoSignedUrl={logoSignedUrl}
      hasLogo={consultora.logoStoragePath !== null}
      autoCreateEventOnSign={consultora.autoCreateEventOnSign}
    />
  );
}
