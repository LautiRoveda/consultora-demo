'use client';

import type { UseFormReturn } from 'react-hook-form';
import type { SeccionCatalogoItem, SeccionConfig } from './secciones';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useFieldArray } from 'react-hook-form';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { FormField, FormItem, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { ReorderButtons } from '@/shared/ui/reorder-buttons';

import {
  defaultSeccionesConfig,
  SECCION_DESCRIPCION_MAX,
  SECCION_TITULO_MAX,
  SECCION_TITULO_MIN,
  SECCIONES_MAX_CUSTOM,
  SECCIONES_MAX_TOTAL,
} from './secciones';

/**
 * T-138 fase 2 · Configuracion de secciones del informe (seleccion + orden +
 * customs). Compartido por los forms de los tipos SIN estructura legal
 * (relevamiento / capacitacion / otros) via el slot de PersonalizacionSection.
 *
 * Config client-side pura: `useFieldArray` sobre `secciones` (move/append/
 * remove), se persiste con el resto de la metadata en el submit del form —
 * sin RPC (a diferencia del reorder de checklists, que muta filas en DB).
 *
 * `UseFormReturn<any>`: mismo trade-off que el resto de common/ — la
 * invarianza de UseFormReturn<T> impide tiparlo cross-tipo; la garantia de
 * shape es Zod en runtime (seccionesField en cada schema).
 */
type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>;
  catalogo: readonly SeccionCatalogoItem[];
  disabled?: boolean;
};

/** Shape runtime de cada fila (mas el `id` interno que inyecta useFieldArray). */
type SeccionRow = { id: string } & SeccionConfig;

export function SeccionesConfigField({ form, catalogo, disabled }: Props) {
  const { fields, append, remove, move, replace } = useFieldArray({
    control: form.control,
    name: 'secciones',
  });
  const items = fields as unknown as SeccionRow[];

  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [nuevaDescripcion, setNuevaDescripcion] = useState('');

  const labelById = new Map(catalogo.map((c) => [c.id, c.label]));
  const seleccionadas = new Set(
    items.filter((i) => i.kind === 'catalogo').map((i) => i.seccion_id),
  );
  const disponibles = catalogo.filter((c) => !seleccionadas.has(c.id));
  const customCount = items.filter((i) => i.kind === 'custom').length;
  const atTotalCap = items.length >= SECCIONES_MAX_TOTAL;
  const atCustomCap = customCount >= SECCIONES_MAX_CUSTOM;
  const esDefault =
    items.length === catalogo.length &&
    items.every((it, i) => it.kind === 'catalogo' && it.seccion_id === catalogo[i]!.id);

  const tituloListo = nuevoTitulo.trim().length >= SECCION_TITULO_MIN;

  function agregarCustom() {
    if (!tituloListo || atTotalCap || atCustomCap) return;
    append({ kind: 'custom', titulo: nuevoTitulo.trim(), descripcion: nuevaDescripcion.trim() });
    setNuevoTitulo('');
    setNuevaDescripcion('');
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Secciones del informe</p>
        <p className="text-muted-foreground text-sm">
          Elegí qué secciones lleva el borrador y en qué orden. Sin cambios, se usa la estructura
          estándar del tipo.
        </p>
      </div>

      <ul className="space-y-1.5">
        {items.map((item, index) => {
          const label =
            item.kind === 'catalogo'
              ? (labelById.get(item.seccion_id) ?? item.seccion_id)
              : item.titulo;
          return (
            <li key={item.id} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
              <span className="text-muted-foreground w-5 shrink-0 text-right text-xs tabular-nums">
                {index + 1}.
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
              {item.kind === 'custom' && <Badge variant="secondary">personalizada</Badge>}
              <ReorderButtons
                index={index}
                total={items.length}
                label={label}
                disabled={disabled}
                onMove={(d) => move(index, d === 'up' ? index - 1 : index + 1)}
              />
              {/* min(1) del schema: la ultima seccion no se puede quitar. */}
              <Button
                type="button"
                variant="ghost"
                size="none"
                className="size-7 shrink-0"
                disabled={disabled || items.length <= 1}
                aria-label={`Quitar sección «${label}»`}
                onClick={() => remove(index)}
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          );
        })}
      </ul>

      {disponibles.length > 0 && (
        <div>
          <p className="text-muted-foreground text-xs">Secciones del catálogo quitadas:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {disponibles.map((c) => (
              <Button
                key={c.id}
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || atTotalCap}
                onClick={() => append({ kind: 'catalogo', seccion_id: c.id })}
              >
                <Plus className="size-3.5" aria-hidden />
                {c.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs">Agregar sección personalizada:</p>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_3fr_auto]">
          <Input
            value={nuevoTitulo}
            placeholder="Título (ej: Plan de izaje)"
            maxLength={SECCION_TITULO_MAX}
            aria-label="Título de la sección personalizada"
            disabled={disabled || atTotalCap || atCustomCap}
            onChange={(e) => setNuevoTitulo(e.target.value)}
          />
          <Input
            value={nuevaDescripcion}
            placeholder="Descripción breve (opcional)"
            maxLength={SECCION_DESCRIPCION_MAX}
            aria-label="Descripción de la sección personalizada"
            disabled={disabled || atTotalCap || atCustomCap}
            onChange={(e) => setNuevaDescripcion(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || atTotalCap || atCustomCap || !tituloListo}
            onClick={agregarCustom}
          >
            <Plus className="size-4" aria-hidden />
            Agregar sección
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          {items.length} / {SECCIONES_MAX_TOTAL} secciones · personalizadas {customCount} /{' '}
          {SECCIONES_MAX_CUSTOM}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || esDefault}
          onClick={() => replace(defaultSeccionesConfig(catalogo.map((c) => c.id)))}
        >
          Restaurar estructura estándar
        </Button>
      </div>

      {/* Mensaje del array completo (caps / dedup del refine). */}
      <FormField
        control={form.control}
        name="secciones"
        render={() => (
          <FormItem>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
