'use client';

import { HardHat, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';

import { seedDefaultCatalogAction } from './actions';

export function EmptyCatalogoCTA() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSeed() {
    startTransition(async () => {
      const result = await seedDefaultCatalogAction();
      if (!result.ok) {
        switch (result.code) {
          case 'FORBIDDEN_NOT_OWNER':
            toast.error('Permisos insuficientes', { description: result.message });
            return;
          case 'UNAUTHENTICATED':
            toast.error('Sesión vencida', { description: result.message });
            router.push('/login');
            return;
          case 'NO_CONSULTORA':
            toast.error('Cuenta sin consultora', { description: result.message });
            return;
          default:
            toast.error('Error inesperado', { description: result.message });
        }
        return;
      }

      const { categorias, items, puestos } = result.created;
      const total = categorias + items + puestos;
      if (total === 0) {
        toast.info('Tu catálogo ya tenía todo el contenido recomendado.');
      } else {
        toast.success('Catálogo inicial cargado', {
          description: `${categorias} categorías + ${items} items + ${puestos} puestos.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
            <HardHat className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle>Tu catálogo EPP está vacío</CardTitle>
            <CardDescription>
              Cargá el catálogo inicial recomendado o creá categorías / items / puestos manualmente.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="text-muted-foreground space-y-1 text-sm">
          <li>
            · 8 categorías base (cabeza, manos, pies, ocular, caída altura, respiratoria, auditiva,
            ropa)
          </li>
          <li>
            · 15 items con normativas IRAM / NIOSH (casco, antiparras, guantes, borcegos, arnés…)
          </li>
          <li>· 3 puestos de ejemplo (operario, soldador, conductor maquinaria)</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSeed} disabled={isPending}>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden />
            {isPending ? 'Cargando…' : 'Cargar catálogo inicial recomendado'}
          </Button>
          <Button asChild variant="outline" disabled={isPending}>
            <a href="/epp/catalogo/categorias/nuevo">Crear primera categoría</a>
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Después de cargarlo podés editar / archivar / agregar lo que necesites. La operación es
          idempotente: re-invocarla solo agrega lo que falte.
        </p>
      </CardContent>
    </Card>
  );
}
