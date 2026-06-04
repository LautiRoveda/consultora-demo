'use client';

import type { AdjuntoView } from './PhotoCapture';
import type { EjecucionSectionNode, ExecutionRespuestaRow, TemplateItemRow } from './queries';
import { AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { Button } from '@/shared/ui/button';

import { ItemCard } from './ItemCard';
import { ReadyToCloseCard } from './ReadyToCloseCard';
import { SectionProgressHeader } from './SectionProgressHeader';

export type EjecucionRunnerProps = {
  executionId: string;
  isOwner: boolean;
  sections: EjecucionSectionNode[];
  respuestasByItemId: Record<string, ExecutionRespuestaRow>;
  adjuntosByItemId: Record<string, AdjuntoView[]>;
};

function isAnswered(item: TemplateItemRow, resp: ExecutionRespuestaRow | undefined): boolean {
  if (!resp) return false;
  switch (item.response_type) {
    case 'cumple_no_aplica':
    case 'si_no':
      return resp.valor != null;
    case 'texto':
      return (resp.valor ?? '').trim() !== '';
    case 'numerico':
      return resp.valor_numerico != null;
    default:
      return false;
  }
}

export function EjecucionRunner({
  executionId,
  isOwner,
  sections,
  respuestasByItemId,
  adjuntosByItemId,
}: EjecucionRunnerProps) {
  const requiredItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sections) for (const it of s.items) if (it.es_requerido) ids.add(it.id);
    return ids;
  }, [sections]);

  const [answeredIds, setAnsweredIds] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const s of sections) {
      for (const it of s.items) {
        if (isAnswered(it, respuestasByItemId[it.id])) set.add(it.id);
      }
    }
    return set;
  });
  const [sectionIndex, setSectionIndex] = useState(0);
  const [frozen, setFrozen] = useState(false);

  const onFrozen = useCallback(() => setFrozen(true), []);
  const onAnsweredChange = useCallback((itemId: string, answered: boolean) => {
    setAnsweredIds((prev) => {
      if (answered === prev.has(itemId)) return prev;
      const next = new Set(prev);
      if (answered) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }, []);

  const totalRequired = requiredItemIds.size;
  const answeredRequired = useMemo(() => {
    let n = 0;
    for (const id of requiredItemIds) if (answeredIds.has(id)) n += 1;
    return n;
  }, [requiredItemIds, answeredIds]);

  if (sections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">Este template no tiene ítems para relevar.</p>
    );
  }

  const section = sections[sectionIndex]!;
  const isLast = sectionIndex === sections.length - 1;
  const isFirst = sectionIndex === 0;

  function goTo(index: number) {
    setSectionIndex(index);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="grid gap-4">
      {frozen && (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive flex items-start gap-2 rounded-md border p-3 text-sm"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="grid gap-2">
            <p>Esta inspección ya fue cerrada o anulada. No se puede seguir editando.</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/checklists/ejecuciones">Volver a inspecciones</Link>
            </Button>
          </div>
        </div>
      )}

      <SectionProgressHeader
        sectionTitle={section.titulo}
        sectionIndex={sectionIndex}
        sectionCount={sections.length}
        answeredRequired={answeredRequired}
        totalRequired={totalRequired}
      />

      {section.descripcion && (
        <p className="text-muted-foreground text-sm break-words">{section.descripcion}</p>
      )}

      {section.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Esta sección no tiene ítems.</p>
      ) : (
        <ul className="grid gap-3">
          {section.items.map((item) => (
            <ItemCard
              key={item.id}
              executionId={executionId}
              item={item}
              initialRespuesta={respuestasByItemId[item.id]}
              initialAdjuntos={adjuntosByItemId[item.id] ?? []}
              disabled={frozen}
              onAnsweredChange={onAnsweredChange}
              onFrozen={onFrozen}
            />
          ))}
        </ul>
      )}

      {isLast && (
        <ReadyToCloseCard
          isOwner={isOwner}
          answeredRequired={answeredRequired}
          totalRequired={totalRequired}
        />
      )}

      <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-2 border-t bg-background px-4 py-3 sm:px-6 lg:px-8">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => goTo(sectionIndex - 1)}
          disabled={isFirst}
        >
          ← Anterior
        </Button>
        <span className="text-muted-foreground text-xs">
          {sectionIndex + 1} / {sections.length}
        </span>
        <Button
          type="button"
          className="min-h-11"
          onClick={() => goTo(sectionIndex + 1)}
          disabled={isLast}
        >
          Siguiente →
        </Button>
      </div>
    </div>
  );
}
