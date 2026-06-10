import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';

import { type PlantillaClientItem } from '../plantillas/PlantillaControls';
import { getPlantillasActivas } from '../plantillas/queries';
import { type InformeTipo } from '../schema';
import { InformeNuevoForm } from './InformeNuevoForm';

/**
 * T-019 · Crear informe nuevo.
 * T-139 · Fetchea las plantillas activas (todos los tipos: el tipo se elige
 *         en el step 1 del wizard, el filtro es client-side).
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

  const plantillas: PlantillaClientItem[] = (await getPlantillasActivas(supabase)).map((row) => ({
    id: row.id,
    tipo: row.tipo as InformeTipo,
    nombre: row.nombre,
    config: row.config,
  }));

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
      <InformeNuevoForm plantillas={plantillas} />
    </div>
  );
}
