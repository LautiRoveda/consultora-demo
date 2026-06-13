import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { AgenteForm } from '../../AgenteForm';

export const metadata = { title: 'Nuevo agente · RAR' };

export default async function NuevoAgentePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');
  if (consultora.role !== 'owner') redirect('/rar/agentes');

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/rar/agentes" className="hover:text-foreground hover:underline">
            ← Volver a Agentes de riesgo
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nuevo agente de riesgo</h1>
      </div>
      <Card>
        <CardContent className="pt-6">
          <AgenteForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
