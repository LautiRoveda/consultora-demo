import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { AgenteForm } from '../../../AgenteForm';
import { getAgenteById } from '../../../queries';

export const metadata = { title: 'Editar agente · RAR' };

export default async function EditarAgentePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');
  if (consultora.role !== 'owner') redirect('/rar/agentes');

  const agente = await getAgenteById(supabase, id);
  if (!agente) notFound();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/rar/agentes" className="hover:text-foreground hover:underline">
            ← Volver a Agentes de riesgo
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Editar agente de riesgo</h1>
        <p className="text-muted-foreground text-sm">{agente.nombre}</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <AgenteForm mode="edit" agenteId={agente.id} initialValues={agente} />
        </CardContent>
      </Card>
    </div>
  );
}
