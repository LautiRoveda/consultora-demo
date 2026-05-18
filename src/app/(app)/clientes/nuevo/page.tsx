import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';
import { Card, CardContent } from '@/shared/ui/card';

import { ClienteForm } from '../ClienteForm';

/**
 * T-049 · Crear cliente nuevo. Server Component delega al form (Client) — RHF
 * + zodResolver requieren browser side.
 */
export default async function NuevoClientePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/clientes" className="hover:text-foreground hover:underline">
            ← Volver a Clientes
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Nuevo cliente</h1>
        <p className="text-muted-foreground text-sm">
          Cargá los datos del cliente — los campos opcionales podés completarlos después.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ClienteForm mode="create" />
        </CardContent>
      </Card>
    </div>
  );
}
