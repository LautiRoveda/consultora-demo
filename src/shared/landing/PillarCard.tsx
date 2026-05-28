import type { LucideIcon } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';

/**
 * T-108 · Card de pilar (icon + título + body) para sección "5 pilares" del
 * landing principal.
 *
 * Server Component. Espera un `LucideIcon` (el caller pasa el componente
 * importado de `lucide-react`). El `eyebrow` opcional es para badges tipo
 * "01", "02" arriba del icono — visual hint de orden sin números literales
 * en el título.
 */

interface PillarCardProps {
  icon: LucideIcon;
  title: string;
  body: string;
  eyebrow?: string;
}

export function PillarCard({ icon: Icon, title, body, eyebrow }: PillarCardProps) {
  return (
    <Card className="border-primary/30 h-full transition-all hover:-translate-y-0.5 hover:shadow-md">
      <CardHeader>
        {eyebrow ? (
          <span className="text-primary/40 text-xs font-bold tracking-wide">{eyebrow}</span>
        ) : null}
        <span className="bg-primary/10 text-primary mt-1 flex size-10 items-center justify-center rounded-md">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <CardTitle className="mt-3 text-base leading-snug">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
      </CardContent>
    </Card>
  );
}
