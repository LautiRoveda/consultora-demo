import type { InformeStatus, InformeTipo } from '@/app/(app)/informes/schema';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { INFORME_STATUS_LABELS, INFORME_TIPO_LABELS } from '@/app/(app)/informes/schema';
import { createClient } from '@/shared/supabase/server';
import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { formatDateEs, isArchived, provinciaLabel } from '../labels';
import { getClienteById, getInformesByClienteId } from '../queries';
import { ClienteActionsButtons } from './ClienteActionsButtons';

/**
 * T-049 · Detalle de cliente (read-only).
 *
 * Cards condicionales: si todos los fields de una sección son null, esa Card
 * NO se renderiza (clean visual). Identificación siempre se muestra porque
 * `razon_social` + `cuit` son NOT NULL.
 *
 * Permission gate UI matchea RLS T-047/T-048 any-member: todos los botones
 * (Editar/Archivar/Desarchivar) habilitados para cualquier member del tenant.
 */
export default async function ClienteDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const cliente = await getClienteById(supabase, id);
  if (!cliente) notFound();

  // T-050 · Informes vinculados (cap 10 visible, query cap 50 hard).
  const linkedInformes = await getInformesByClienteId(supabase, id);
  const visibleInformes = linkedInformes.slice(0, 10);

  const provincia = provinciaLabel(cliente.provincia);
  const hasUbicacion = !!(cliente.domicilio || cliente.localidad || cliente.provincia);
  const hasContacto = !!(
    cliente.contacto_nombre ||
    cliente.contacto_email ||
    cliente.contacto_telefono
  );
  const hasDetalles = !!(cliente.industria || cliente.art);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-muted-foreground text-sm">
            <Link href="/clientes" className="hover:text-foreground hover:underline">
              ← Volver a Clientes
            </Link>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{cliente.razon_social}</h1>
            {isArchived(cliente) && <Badge variant="secondary">Archivado</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            {cliente.cuit} · Creado el {formatDateEs(cliente.created_at)}
          </p>
        </div>
        <ClienteActionsButtons
          clienteId={cliente.id}
          razonSocial={cliente.razon_social}
          archived={isArchived(cliente)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identificación</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
          <Field label="Razón social" value={cliente.razon_social} />
          <Field label="CUIT" value={cliente.cuit} />
          {cliente.nombre_fantasia && (
            <Field
              label="Nombre fantasía"
              value={cliente.nombre_fantasia}
              className="md:col-span-2"
            />
          )}
        </CardContent>
      </Card>

      {hasUbicacion && (
        <Card>
          <CardHeader>
            <CardTitle>Ubicación</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {cliente.domicilio && (
              <Field label="Domicilio" value={cliente.domicilio} className="md:col-span-2" />
            )}
            {cliente.localidad && <Field label="Localidad" value={cliente.localidad} />}
            {provincia && <Field label="Provincia" value={provincia} />}
          </CardContent>
        </Card>
      )}

      {hasContacto && (
        <Card>
          <CardHeader>
            <CardTitle>Contacto</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {cliente.contacto_nombre && <Field label="Nombre" value={cliente.contacto_nombre} />}
            {cliente.contacto_email && <Field label="Email" value={cliente.contacto_email} />}
            {cliente.contacto_telefono && (
              <Field label="Teléfono" value={cliente.contacto_telefono} />
            )}
          </CardContent>
        </Card>
      )}

      {hasDetalles && (
        <Card>
          <CardHeader>
            <CardTitle>Detalles</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            {cliente.industria && <Field label="Industria" value={cliente.industria} />}
            {cliente.art && <Field label="ART" value={cliente.art} />}
          </CardContent>
        </Card>
      )}

      {cliente.notas && (
        <Card>
          <CardHeader>
            <CardTitle>Notas internas</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{cliente.notas}</p>
          </CardContent>
        </Card>
      )}

      {visibleInformes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Informes vinculados</CardTitle>
            <CardDescription>
              {linkedInformes.length === 1
                ? '1 informe asociado a este cliente.'
                : `${linkedInformes.length} informes asociados a este cliente.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {visibleInformes.map((inf) => (
                <li key={inf.id} className="flex items-center justify-between gap-4 py-3">
                  <Link href={`/informes/${inf.id}`} className="flex-1 min-w-0 hover:underline">
                    <div className="truncate font-medium">{inf.titulo}</div>
                    <div className="text-muted-foreground text-xs">
                      {INFORME_TIPO_LABELS[inf.tipo as InformeTipo]} ·{' '}
                      {formatDateEs(inf.created_at)}
                    </div>
                  </Link>
                  <Badge
                    variant={
                      inf.status === 'published'
                        ? 'default'
                        : inf.status === 'archived'
                          ? 'secondary'
                          : 'outline'
                    }
                  >
                    {INFORME_STATUS_LABELS[inf.status as InformeStatus]}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
      <p>{value}</p>
    </div>
  );
}
