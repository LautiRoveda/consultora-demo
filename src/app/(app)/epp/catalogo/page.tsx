import { redirect } from 'next/navigation';

import { getCurrentConsultora } from '@/shared/auth/getCurrentConsultora';
import { createClient } from '@/shared/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { EmptyCatalogoCTA } from './EmptyCatalogoCTA';
import { countCatalogo } from './queries';

/**
 * Root del catálogo EPP. Si el tenant ya tiene catálogo poblado, redirige a la
 * tab default `items`. Si está vacío, muestra el empty state CTA con seed.
 *
 * Owners ven la CTA de seed; members non-owners ven mensaje informativo (no
 * pueden disparar el seed — defense in depth del action layer).
 */
export default async function CatalogoIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const consultora = await getCurrentConsultora(supabase, user.id);
  if (!consultora) redirect('/dashboard');

  const counts = await countCatalogo(supabase, consultora.id);
  const isEmpty = counts.categorias === 0 && counts.items === 0 && counts.puestos === 0;

  if (!isEmpty) {
    redirect('/epp/catalogo/items');
  }

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-muted-foreground text-sm">
        Configurá categorías, items y puestos antes de hacer entregas a empleados.
      </p>
      {consultora.role === 'owner' ? (
        <EmptyCatalogoCTA />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Tu catálogo EPP está vacío</CardTitle>
            <CardDescription>
              El catálogo lo configura el owner de la consultora. Pedile que entre a esta sección y
              cargue el catálogo inicial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Cuando el owner cargue categorías, items y puestos, vas a poder verlos y consumirlos
              en las entregas EPP.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
