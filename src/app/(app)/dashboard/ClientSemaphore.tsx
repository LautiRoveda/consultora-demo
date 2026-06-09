import type { SemaforoItem } from './queries';
import Link from 'next/link';

import { cn } from '@/shared/lib/utils';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';

/**
 * T-131 fase B · Semáforo por cliente (columna derecha del tablero).
 *
 * El diferenciador: el consultor ve de un vistazo cuáles de sus 5-20 clientes
 * necesitan atención. Filas en alerta (rojo/ámbar) SIEMPRE visibles; los "al día"
 * (verde) van colapsados en un `<details>` nativo solo en desktop (en móvil se
 * muestran únicamente los en alerta). Server component puro: cero JS de cliente.
 *
 * A11y: el `contexto` textual transmite el estado (no solo el color); el punto es
 * decorativo (`aria-hidden`). Color vía tokens `--severity-*` (correctos en dark).
 */

const DOT: Record<SemaforoItem['estado'], string> = {
  vencido: 'bg-severity-danger',
  por_vencer: 'bg-severity-warning',
  al_dia: 'bg-severity-ok',
};

function Row({ item }: { item: SemaforoItem }) {
  return (
    <li className="flex items-center gap-2 px-2 py-1.5" data-testid={`semaforo-row-${item.id}`}>
      <span className={cn('size-2 shrink-0 rounded-full', DOT[item.estado])} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm">{item.nombre}</span>
      <span className="text-muted-foreground shrink-0 text-xs">{item.contexto}</span>
    </li>
  );
}

export function ClientSemaphore({ semaforo }: { semaforo: SemaforoItem[] }) {
  if (semaforo.length === 0) {
    return (
      <Card data-testid="client-semaphore-empty">
        <CardHeader>
          <h2 className="text-base font-semibold">Tus clientes</h2>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">Todavía no cargaste clientes.</p>
          <Link href="/clientes/nuevo" className="text-primary font-medium hover:underline">
            Agregar tu primer cliente
          </Link>
        </CardContent>
      </Card>
    );
  }

  const alerta = semaforo.filter((s) => s.estado !== 'al_dia');
  const alDia = semaforo.filter((s) => s.estado === 'al_dia');

  return (
    <Card data-testid="client-semaphore">
      <CardHeader>
        <h2 className="text-base font-semibold">Tus clientes</h2>
      </CardHeader>
      <CardContent>
        {alerta.length > 0 ? (
          <ul className="space-y-0.5">
            {alerta.map((s) => (
              <Row key={s.id} item={s} />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-2 py-1.5 text-sm md:hidden">Todos al día ✓</p>
        )}

        {alDia.length > 0 ? (
          <details className="mt-2 hidden md:block">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer px-2 text-xs">
              +{alDia.length} al día
            </summary>
            <ul className="mt-1 space-y-0.5">
              {alDia.map((s) => (
                <Row key={s.id} item={s} />
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}
