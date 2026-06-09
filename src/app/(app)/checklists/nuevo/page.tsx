import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { TemplateMetaForm } from '../TemplateMetaForm';

export default async function NuevoChecklistPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');
  if (consultora.role !== 'owner') redirect('/checklists');

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/checklists" className="hover:text-foreground hover:underline">
            ← Volver a Checklists
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nuevo template</h1>
        <p className="text-muted-foreground text-sm">
          Creá la plantilla. Después le agregás secciones e ítems y publicás la primera versión.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <TemplateMetaForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
