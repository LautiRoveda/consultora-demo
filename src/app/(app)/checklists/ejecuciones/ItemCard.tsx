'use client';

import type { ResponseType } from '../schema';
import type { AdjuntoView } from './PhotoCapture';
import type { ExecutionRespuestaRow, TemplateItemRow } from './queries';
import type { SaveRespuestaInput } from './schema';
import { useRef, useState } from 'react';

import { Badge } from '@/shared/ui/badge';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Textarea } from '@/shared/ui/textarea';

import { PhotoCapture } from './PhotoCapture';
import { ResponseToggle } from './ResponseToggle';
import { SaveStatusIndicator } from './SaveStatusIndicator';
import { useAutoSaveRespuesta } from './useAutoSaveRespuesta';

export type ItemCardProps = {
  executionId: string;
  item: TemplateItemRow;
  initialRespuesta: ExecutionRespuestaRow | undefined;
  initialAdjuntos: AdjuntoView[];
  disabled: boolean;
  onAnsweredChange: (itemId: string, answered: boolean) => void;
  onFrozen: () => void;
};

type ItemState = {
  valor: string | null;
  numericText: string;
  observacion: string;
  fechaRegularizacion: string;
};

function computeAnswered(rt: TemplateItemRow['response_type'], s: ItemState): boolean {
  switch (rt) {
    case 'cumple_no_aplica':
    case 'si_no':
      return s.valor != null;
    case 'texto':
      return (s.valor ?? '').trim() !== '';
    case 'numerico':
      return s.numericText.trim() !== '' && Number.isFinite(Number(s.numericText));
    default:
      return false;
  }
}

export function ItemCard({
  executionId,
  item,
  initialRespuesta,
  initialAdjuntos,
  disabled,
  onAnsweredChange,
  onFrozen,
}: ItemCardProps) {
  const [state, setState] = useState<ItemState>({
    valor: initialRespuesta?.valor ?? null,
    numericText:
      initialRespuesta?.valor_numerico != null ? String(initialRespuesta.valor_numerico) : '',
    observacion: initialRespuesta?.observacion ?? '',
    fechaRegularizacion: initialRespuesta?.fecha_regularizacion ?? '',
  });
  const answeredRef = useRef(computeAnswered(item.response_type, state));

  const autosave = useAutoSaveRespuesta({
    initialRespuestaId: initialRespuesta?.id ?? null,
    onFrozen,
  });

  function makePayload(s: ItemState): SaveRespuestaInput {
    const base = { executionId, templateItemId: item.id };
    const observacion = s.observacion.trim() === '' ? undefined : s.observacion.trim();
    // response_type viene tipado como string (columna text + CHECK); lo estrechamos
    // al union para que el switch sea exhaustivo y devuelva siempre SaveRespuestaInput.
    switch (item.response_type as ResponseType) {
      case 'cumple_no_aplica':
        return {
          ...base,
          response_type: 'cumple_no_aplica',
          valor: (s.valor as 'si' | 'no' | 'na' | null) ?? null,
          observacion,
          fecha_regularizacion:
            s.valor === 'no' && s.fechaRegularizacion ? s.fechaRegularizacion : null,
        };
      case 'si_no':
        return {
          ...base,
          response_type: 'si_no',
          valor: (s.valor as 'si' | 'no' | null) ?? null,
          observacion,
        };
      case 'texto':
        return {
          ...base,
          response_type: 'texto',
          valor: s.valor && s.valor.trim() !== '' ? s.valor : null,
          observacion,
        };
      case 'numerico': {
        const n = s.numericText.trim() === '' ? null : Number(s.numericText);
        return {
          ...base,
          response_type: 'numerico',
          valor_numerico: Number.isFinite(n) ? n : null,
          observacion,
        };
      }
    }
  }

  function commit(next: ItemState, options?: { immediate?: boolean }) {
    setState(next);
    const answered = computeAnswered(item.response_type, next);
    if (answered !== answeredRef.current) {
      answeredRef.current = answered;
      onAnsweredChange(item.id, answered);
    }
    autosave.schedule(makePayload(next), options);
  }

  const showFecha = item.response_type === 'cumple_no_aplica' && state.valor === 'no';

  return (
    <li className="rounded-md border p-3">
      <p className="text-sm break-words">{item.texto}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {item.es_critico && <Badge variant="destructive">Crítico</Badge>}
        {!item.es_requerido && <Badge variant="secondary">Opcional</Badge>}
        {item.referencia_normativa && (
          <span className="text-muted-foreground text-xs">{item.referencia_normativa}</span>
        )}
      </div>

      <div className="mt-3 grid gap-3">
        {item.response_type === 'cumple_no_aplica' && (
          <ResponseToggle
            name={`resp-${item.id}`}
            ariaLabel={`Respuesta para: ${item.texto}`}
            value={state.valor}
            disabled={disabled}
            onChange={(v) => commit({ ...state, valor: v }, { immediate: true })}
            options={[
              { value: 'si', label: 'Cumple', tone: 'ok' },
              { value: 'no', label: 'No cumple', tone: 'bad' },
              { value: 'na', label: 'N/A', tone: 'na' },
            ]}
          />
        )}

        {item.response_type === 'si_no' && (
          <ResponseToggle
            name={`resp-${item.id}`}
            ariaLabel={`Respuesta para: ${item.texto}`}
            value={state.valor}
            disabled={disabled}
            onChange={(v) => commit({ ...state, valor: v }, { immediate: true })}
            options={[
              { value: 'si', label: 'Sí', tone: 'ok' },
              { value: 'no', label: 'No', tone: 'bad' },
            ]}
          />
        )}

        {item.response_type === 'texto' && (
          <div className="grid gap-1.5">
            <Label htmlFor={`texto-${item.id}`}>Respuesta</Label>
            <Textarea
              id={`texto-${item.id}`}
              value={state.valor ?? ''}
              rows={2}
              disabled={disabled}
              onChange={(e) => commit({ ...state, valor: e.target.value })}
              onBlur={() => void autosave.flush(makePayload(state))}
            />
          </div>
        )}

        {item.response_type === 'numerico' && (
          <div className="grid gap-1.5">
            <Label htmlFor={`num-${item.id}`}>Valor</Label>
            <Input
              id={`num-${item.id}`}
              type="number"
              inputMode="decimal"
              value={state.numericText}
              disabled={disabled}
              onChange={(e) => commit({ ...state, numericText: e.target.value })}
              onBlur={() => void autosave.flush(makePayload(state))}
            />
          </div>
        )}

        {showFecha && (
          <div className="grid gap-1.5">
            <Label htmlFor={`fecha-${item.id}`}>Fecha de regularización</Label>
            <Input
              id={`fecha-${item.id}`}
              type="date"
              className="max-w-44"
              value={state.fechaRegularizacion}
              disabled={disabled}
              onChange={(e) => commit({ ...state, fechaRegularizacion: e.target.value })}
              onBlur={() => void autosave.flush(makePayload(state))}
            />
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor={`obs-${item.id}`}>
            Observación <span className="text-muted-foreground">(opcional)</span>
          </Label>
          <Textarea
            id={`obs-${item.id}`}
            value={state.observacion}
            rows={2}
            disabled={disabled}
            onChange={(e) => commit({ ...state, observacion: e.target.value })}
            onBlur={() => void autosave.flush(makePayload(state))}
          />
        </div>

        <PhotoCapture
          executionId={executionId}
          getRespuestaId={autosave.getRespuestaId}
          ensureRespuesta={() => autosave.flush(makePayload(state))}
          initialAdjuntos={initialAdjuntos}
          disabled={disabled}
          onFrozen={onFrozen}
        />

        <SaveStatusIndicator status={autosave.status} onRetry={autosave.retry} />
      </div>
    </li>
  );
}
