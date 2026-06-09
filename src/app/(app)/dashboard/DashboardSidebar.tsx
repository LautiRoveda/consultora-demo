import type { InformeListRow } from '../informes/queries';
import type { SemaforoItem } from './queries';
import { Bot, FileText, Plus } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';

import { ClientSemaphore } from './ClientSemaphore';

/**
 * T-131 · Columna derecha del tablero.
 *
 * Fase B: arriba de todo el semáforo por cliente (`ClientSemaphore`). Debajo, el
 * botón primario "Nuevo informe" (solo desktop — en móvil la CTA primaria es el
 * FAB, una sola por breakpoint), "Seguir con lo tuyo" (borradores recientes) y
 * una barra sutil al asistente IA.
 */
export function DashboardSidebar({
  recentDrafts,
  semaforo,
}: {
  recentDrafts: InformeListRow[];
  semaforo: SemaforoItem[];
}) {
  return (
    <aside className="space-y-4" data-testid="dashboard-sidebar">
      <ClientSemaphore semaforo={semaforo} />

      <Button asChild size="lg" className="hidden w-full md:flex" data-testid="nuevo-informe-cta">
        <Link href="/informes/nuevo">
          <Plus className="h-5 w-5" aria-hidden="true" />
          Nuevo informe
        </Link>
      </Button>

      {recentDrafts.length > 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold">Seguir con lo tuyo</h2>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {recentDrafts.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/informes/${d.id}/editar`}
                    className="hover:bg-accent/40 flex items-start gap-2 rounded-md px-2 py-2 transition-colors"
                  >
                    <FileText
                      className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{d.titulo}</span>
                      <span className="text-muted-foreground block text-xs">Borrador</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Link
        href="/asistente"
        className="hover:bg-accent/40 flex items-center gap-3 rounded-lg border p-3 transition-colors"
      >
        <span className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-md">
          <Bot className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">Asistente IA</span>
          <span className="text-muted-foreground block text-xs">
            Consultá tus datos en lenguaje natural.
          </span>
        </span>
      </Link>
    </aside>
  );
}
