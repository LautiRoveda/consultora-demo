import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

/**
 * T-095 · 404 del route group `(app)`.
 *
 * Se dispara cuando una page autenticada llama a `notFound()` o cuando un
 * dynamic segment no matchea (ej `/clientes/<uuid-inexistente>` cae aquí si
 * la query devuelve null y la page lanza `notFound()`).
 *
 * El shell autenticado sigue visible — el usuario no pierde nav contexto.
 */
export default function NotFound() {
  return (
    <Card className="mx-auto mt-12 max-w-md">
      <CardContent className="space-y-4 py-8 text-center">
        <h2 className="text-xl font-semibold">Página no encontrada</h2>
        <p className="text-muted-foreground text-sm">La página que buscás no existe o se movió.</p>
        <div className="flex justify-center pt-2">
          <Button asChild>
            <Link href="/dashboard">Ir al dashboard</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
