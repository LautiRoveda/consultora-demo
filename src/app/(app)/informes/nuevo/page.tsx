import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';

import { InformeNuevoForm } from './InformeNuevoForm';

/**
 * T-019 · Crear informe nuevo.
 *
 * Server Component que delega al form (Client) — RHF + zodResolver requieren
 * browser side.
 */
export default async function InformeNuevoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  return (
    <div className="space-y-6">
      <div>
        <p className="text-muted-foreground text-sm">
          <Link href="/informes" className="hover:text-foreground hover:underline">
            ← Volver a Informes
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-balance break-words">
          Nuevo informe
        </h1>
        <p className="text-muted-foreground text-sm">
          Elegí el tipo y dale un título. Después vas a poder generar el contenido con IA en el
          editor.
        </p>
      </div>
      <InformeNuevoForm />
    </div>
  );
}
