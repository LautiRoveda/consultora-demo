import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { getClientesForConsultora } from '../../../clientes/queries';
import { getChecklistTemplates } from '../../queries';
import { NuevaInspeccionForm } from './NuevaInspeccionForm';

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * T-061a · Inicio de inspección. Cualquier member puede crear el borrador
 * (createEjecucionAction es member+billing). El cliente se elige acá porque el
 * backend lo exige al crear. Soporta ?template=<id> (atajo "Ejecutar" del detalle).
 */
export default async function NuevaInspeccionPage({
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

  const [templatesAll, clientes] = await Promise.all([
    getChecklistTemplates(supabase, {}),
    getClientesForConsultora(supabase, { limit: 1000 }),
  ]);

  const templates = templatesAll
    .filter((t) => t.latestVersionEstado === 'published')
    .map((t) => ({ id: t.id, nombre: t.nombre, isSystem: t.isSystem }));

  const sp = (await searchParams) ?? {};
  const requested = typeof sp.template === 'string' ? sp.template : undefined;
  const initialTemplateId =
    requested && templates.some((t) => t.id === requested) ? requested : undefined;

  const noTemplate = templates.length === 0;
  const noCliente = clientes.length === 0;

  return (
    <div className="max-w-2xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Nueva inspección</h1>
        <p className="text-muted-foreground text-sm">
          Elegí el template publicado y el cliente. Vas a relevarla sección por sección.
        </p>
      </header>

      {noTemplate || noCliente ? (
        <Card>
          <CardHeader>
            <CardTitle>Falta algo antes de empezar</CardTitle>
            <CardDescription>
              {noTemplate && noCliente
                ? 'Necesitás un template publicado y al menos un cliente.'
                : noTemplate
                  ? 'Necesitás un template publicado.'
                  : 'Necesitás al menos un cliente.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {noTemplate && (
              <Button asChild>
                <Link href="/checklists">Ir a Checklists</Link>
              </Button>
            )}
            {noCliente && (
              <Button asChild variant={noTemplate ? 'outline' : 'default'}>
                <Link href="/clientes/nuevo">Crear cliente</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <NuevaInspeccionForm
          templates={templates}
          clientes={clientes.map((c) => ({ id: c.id, razon_social: c.razon_social }))}
          initialTemplateId={initialTemplateId}
        />
      )}
    </div>
  );
}
