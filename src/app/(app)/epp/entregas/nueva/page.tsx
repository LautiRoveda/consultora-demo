import type { EmptyEntregasReason } from '../EmptyEntregasState';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';

import { EmptyEntregasState } from '../EmptyEntregasState';
import { EntregaWizard } from '../EntregaWizard';
import {
  countEntregasContext,
  listEmpleadosForEntregaWizard,
  listItemsForEntregaWizard,
} from '../queries';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * T-106 · Wizard "Nueva entrega". Acepta query params opcionales
 * `?empleado=<uuid>&items=<csv>` para preselect desde la sugerencia IA
 * (SugerenciaEppCard). Validamos formato UUID + scope (empleado/items deben
 * estar en los sets disponibles del tenant) ANTES de pasarlos al wizard; un
 * id inválido se descarta silenciosamente para no romper el flow.
 */
export default async function NuevaEntregaPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  if (consultora.role !== 'owner') {
    // Member non-owner: la creación está vedada por server action; redirigimos
    // a la lista (read-only para él) en lugar de mostrar el wizard.
    redirect('/epp/entregas');
  }

  const counts = await countEntregasContext(supabase, consultora.id);

  if (counts.items === 0 || counts.empleados === 0) {
    let reason: EmptyEntregasReason = 'both';
    if (counts.items > 0 && counts.empleados === 0) reason = 'no-empleados';
    else if (counts.items === 0 && counts.empleados > 0) reason = 'no-catalog';

    return (
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nueva entrega EPP</h1>
          <p className="text-sm text-muted-foreground">
            Antes de registrar la primera entrega necesitamos algunos datos.
          </p>
        </div>
        <EmptyEntregasState reason={reason} />
      </div>
    );
  }

  const [empleados, items] = await Promise.all([
    listEmpleadosForEntregaWizard(supabase),
    listItemsForEntregaWizard(supabase),
  ]);

  const params = (await searchParams) ?? {};
  const rawEmpleado = typeof params.empleado === 'string' ? params.empleado : undefined;
  const rawItems = typeof params.items === 'string' ? params.items : undefined;

  const empleadoIds = new Set(empleados.map((e) => e.id));
  const itemIds = new Set(items.map((i) => i.id));

  const initialEmpleadoId =
    rawEmpleado && UUID_REGEX.test(rawEmpleado) && empleadoIds.has(rawEmpleado)
      ? rawEmpleado
      : undefined;

  const initialItemIds = rawItems
    ? rawItems
        .split(',')
        .map((s) => s.trim())
        .filter((id) => UUID_REGEX.test(id) && itemIds.has(id))
    : undefined;

  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Nueva entrega EPP</h1>
        <p className="text-sm text-muted-foreground">
          {initialEmpleadoId
            ? 'Empleado e items pre-cargados desde sugerencia IA. Ajustá si hace falta y continuá.'
            : 'Seleccioná el empleado, registrá los items entregados y obtené la firma del operario.'}
        </p>
      </div>
      <EntregaWizard
        empleados={empleados}
        items={items}
        initialEmpleadoId={initialEmpleadoId}
        initialItemIds={initialItemIds && initialItemIds.length > 0 ? initialItemIds : undefined}
      />
    </div>
  );
}
