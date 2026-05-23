import type { EntregaListItem } from './queries';

import { EntregaCard } from './EntregaCard';

export type EntregasListProps = {
  entregas: EntregaListItem[];
};

export function EntregasList({ entregas }: EntregasListProps) {
  if (entregas.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay entregas registradas todavía. Comenzá registrando la primera.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {entregas.map((entrega) => (
        <EntregaCard key={entrega.id} entrega={entrega} />
      ))}
    </div>
  );
}
