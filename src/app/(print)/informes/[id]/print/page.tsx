import type { InformeStatus, InformeTipo } from '@/app/(app)/informes/schema';
import { notFound } from 'next/navigation';

import { getInformeById, getInformeMetadata } from '@/app/(app)/informes/queries';
import { INFORME_STATUSES, INFORME_TIPOS } from '@/app/(app)/informes/schema';
import { createClient } from '@/shared/supabase/server';

import { PrintTemplate } from './PrintTemplate';

/**
 * T-023 · Vista imprimible de un informe.
 *
 * Solo accesible via fetch interno del route handler `/api/informes/[id]/pdf`
 * (el layout (print)/layout.tsx valida el header `x-internal-pdf-render`).
 *
 * Auth + RLS: las cookies del request original fluyen por el internal fetch,
 * asi que `createClient()` ve la sesion del user que pidio el PDF. RLS hace
 * el gate de tenancy — un informe de otra consultora devuelve null.
 *
 * El route handler ya validó auth + permisos antes de fetchar este page, pero
 * mantenemos la RLS query como defensa en profundidad (no asumimos al caller).
 */
export default async function InformePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const informe = await getInformeById(supabase, id);
  if (!informe) notFound();

  // Defensa: la columna `tipo`/`status` son `text` con check constraint en DB.
  // TS no lo sabe — narrowing manual contra el set conocido.
  if (!(INFORME_TIPOS as readonly string[]).includes(informe.tipo)) notFound();
  if (!(INFORME_STATUSES as readonly string[]).includes(informe.status)) notFound();

  const tipo = informe.tipo as InformeTipo;
  const status = informe.status as InformeStatus;
  const metadata = await getInformeMetadata(supabase, informe.id, tipo);

  return (
    <PrintTemplate
      informe={{
        id: informe.id,
        tipo,
        titulo: informe.titulo,
        status,
        contenido: informe.contenido,
        created_at: informe.created_at,
      }}
      metadata={metadata}
    />
  );
}
