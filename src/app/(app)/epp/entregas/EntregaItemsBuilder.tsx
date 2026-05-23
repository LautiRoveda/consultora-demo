'use client';

import type { Control, UseFieldArrayReturn, UseFormReturn } from 'react-hook-form';
import type { CreateEntregaInput } from './schema';
import { Trash2 } from 'lucide-react';
import { useWatch } from 'react-hook-form';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { DEFAULT_MOTIVO_ENTREGA, MOTIVO_ENTREGA_VALUES } from './schema';

const MOTIVO_LABELS: Record<(typeof MOTIVO_ENTREGA_VALUES)[number], string> = {
  inicial: 'Inicial',
  renovacion: 'Renovación',
  reposicion_rotura: 'Reposición — rotura',
  reposicion_perdida: 'Reposición — pérdida',
  rotacion: 'Rotación',
};

export type ItemCatalogOption = {
  id: string;
  nombre: string;
  es_descartable: boolean;
  requiere_numero_serie: boolean;
  vida_util_meses: number;
  marca_default: string | null;
  modelo_default: string | null;
  categoria_nombre: string;
};

type Props = {
  form: UseFormReturn<CreateEntregaInput>;
  fieldArray: UseFieldArrayReturn<CreateEntregaInput, 'items'>;
  itemsCatalog: ItemCatalogOption[];
};

export function EntregaItemsBuilder({ form, fieldArray, itemsCatalog }: Props) {
  const { fields, append, remove } = fieldArray;

  // useWatch sobre el array entero — memoizable (a diferencia de form.watch);
  // derivamos cada selectedItemId por índice sin violar reglas de hooks.
  const watchedItems = useWatch({ control: form.control, name: 'items' }) ?? [];

  function handleAddItem() {
    append({
      item_id: '',
      cantidad: 1,
      motivo_entrega: DEFAULT_MOTIVO_ENTREGA,
    });
  }

  return (
    <div className="grid gap-4">
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Agregá al menos un item EPP entregado al empleado.
        </p>
      )}

      {fields.map((field, idx) => {
        const selectedItemId = watchedItems[idx]?.item_id;
        const selectedItem = itemsCatalog.find((c) => c.id === selectedItemId);
        const requiresSerial = selectedItem?.requiere_numero_serie ?? false;

        return (
          <Card key={field.id}>
            <CardContent className="grid gap-3 pt-6">
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium">Item #{idx + 1}</div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(idx)}
                  aria-label={`Quitar item ${idx + 1}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <ItemSelectField control={form.control} idx={idx} itemsCatalog={itemsCatalog} />

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name={`items.${idx}.cantidad`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Cantidad</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={100}
                          value={f.value ?? 1}
                          onChange={(e) => f.onChange(Number(e.target.value))}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`items.${idx}.motivo_entrega`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Motivo</FormLabel>
                      <Select onValueChange={f.onChange} value={f.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Elegir motivo" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {MOTIVO_ENTREGA_VALUES.map((v) => (
                            <SelectItem key={v} value={v}>
                              {MOTIVO_LABELS[v]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {requiresSerial && (
                <FormField
                  control={form.control}
                  name={`items.${idx}.numero_serie`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>Número de serie (obligatorio)</FormLabel>
                      <FormControl>
                        <Input {...f} value={f.value ?? ''} placeholder="Ej. AR-2026-00123" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name={`items.${idx}.marca_entregada`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>
                        Marca <span className="text-muted-foreground">(opcional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...f}
                          value={f.value ?? ''}
                          placeholder={selectedItem?.marca_default ?? 'Marca'}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`items.${idx}.modelo_entregado`}
                  render={({ field: f }) => (
                    <FormItem>
                      <FormLabel>
                        Modelo <span className="text-muted-foreground">(opcional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input
                          {...f}
                          value={f.value ?? ''}
                          placeholder={selectedItem?.modelo_default ?? 'Modelo'}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Button type="button" variant="outline" onClick={handleAddItem}>
        + Agregar item EPP
      </Button>
    </div>
  );
}

function ItemSelectField({
  control,
  idx,
  itemsCatalog,
}: {
  control: Control<CreateEntregaInput>;
  idx: number;
  itemsCatalog: ItemCatalogOption[];
}) {
  return (
    <FormField
      control={control}
      name={`items.${idx}.item_id`}
      render={({ field: f }) => (
        <FormItem>
          <FormLabel>Item EPP</FormLabel>
          <Select onValueChange={f.onChange} value={f.value}>
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Elegir item del catálogo" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {itemsCatalog.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.categoria_nombre} · {opt.nombre}
                  {opt.es_descartable ? ' (descartable)' : ''}
                  {opt.requiere_numero_serie ? ' · req. serie' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
