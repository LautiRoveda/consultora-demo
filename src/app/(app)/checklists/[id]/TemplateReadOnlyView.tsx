import type { TemplateSectionNode } from '../queries';

import { Badge } from '@/shared/ui/badge';
import { Card, CardContent, CardHeader } from '@/shared/ui/card';

import { RESPONSE_TYPE_LABELS } from '../labels';
import { type ResponseType } from '../schema';

interface Props {
  sections: TemplateSectionNode[];
}

/** Render de solo-lectura de la estructura (versión publicada o template de sistema). */
export function TemplateReadOnlyView({ sections }: Props) {
  if (sections.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
        Este template no tiene secciones.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <Card key={section.id}>
          <CardHeader className="space-y-1">
            <p className="font-medium break-words">{section.titulo}</p>
            {section.descripcion && (
              <p className="text-muted-foreground text-sm break-words">{section.descripcion}</p>
            )}
          </CardHeader>
          <CardContent>
            {section.items.length === 0 ? (
              <p className="text-muted-foreground text-sm">Sin ítems.</p>
            ) : (
              <ul className="space-y-2">
                {section.items.map((item) => (
                  <li key={item.id} className="rounded-md border p-3">
                    <p className="text-sm break-words">{item.texto}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">
                        {RESPONSE_TYPE_LABELS[item.response_type as ResponseType] ??
                          item.response_type}
                      </Badge>
                      {item.es_critico && <Badge variant="destructive">Crítico</Badge>}
                      {!item.es_requerido && <Badge variant="secondary">Opcional</Badge>}
                      {item.referencia_normativa && (
                        <span className="text-muted-foreground text-xs">
                          {item.referencia_normativa}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
