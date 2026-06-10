import type { PlantillaListItem } from './PlantillasView';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createClient } from '@/shared/supabase/server';

import { type InformeTipo } from '../schema';
import { PlantillasView } from './PlantillasView';
import { getPlantillasActivas } from './queries';

/**
 * T-139 · Gestion de "Mis plantillas". Vive en informes (no en settings):
 * settings es config DE LA CONSULTORA; las plantillas son config de informes.
 */

/** Resumen legible de la config jsonb ("3 campos · instrucciones · 5 secciones"). */
function resumenConfig(config: unknown): string {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return 'Sin personalización';
  }
  const c = config as {
    campos_personalizados?: unknown[];
    instrucciones_adicionales?: string;
    secciones?: unknown[];
  };
  const partes: string[] = [];
  const campos = c.campos_personalizados?.length ?? 0;
  if (campos > 0) partes.push(campos === 1 ? '1 campo' : `${campos} campos`);
  if (c.instrucciones_adicionales) partes.push('instrucciones');
  const secciones = c.secciones?.length ?? 0;
  if (secciones > 0) partes.push(secciones === 1 ? '1 sección' : `${secciones} secciones`);
  return partes.length > 0 ? partes.join(' · ') : 'Sin personalización';
}

export default async function PlantillasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const rows = await getPlantillasActivas(supabase);
  const plantillas: PlantillaListItem[] = rows.map((row) => ({
    id: row.id,
    tipo: row.tipo as InformeTipo,
    nombre: row.nombre,
    resumen: resumenConfig(row.config),
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
          Mis plantillas
        </h1>
        <p className="text-muted-foreground text-sm">
          Personalizaciones guardadas para reutilizar al crear informes. Se aplican copiando: editar
          o archivar una plantilla no cambia informes existentes.
        </p>
      </div>
      <PlantillasView plantillas={plantillas} />
    </div>
  );
}
