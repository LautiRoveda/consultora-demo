import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';

import { InformesList } from './InformesList';
import { listInformes } from './queries';

/**
 * T-019 · Lista de informes de la consultora del user logueado.
 *
 * Server Component: hace `getUser` defensivo (el layout `(app)` ya guardea
 * sesion, pero un page exportado es una entry route directa) y delega a
 * `listInformes` que aplica RLS por JWT claim.
 */
export default async function InformesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const informes = await listInformes(supabase);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Informes</h1>
          <p className="text-muted-foreground text-sm">
            Informes técnicos de tu consultora. La generación con IA llega en el próximo sprint.
          </p>
        </div>
        {informes.length > 0 && (
          <Button asChild>
            <Link href="/informes/nuevo">Crear informe</Link>
          </Button>
        )}
      </div>
      <InformesList informes={informes} />
    </div>
  );
}
