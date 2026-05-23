'use client';

import type { PuestoRow } from './queries';
import { zodResolver } from '@hookform/resolvers/zod';
import { X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { optionalString } from '@/shared/lib/zod-form-helpers';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Textarea } from '@/shared/ui/textarea';

import { createPuestoAction, updatePuestoAction } from './actions';

const puestoFormSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(80, { message: 'Máximo 80 caracteres.' }),
  descripcion: optionalString({ max: 500, label: 'descripción' }),
  riesgos_asociados: z
    .array(z.string().trim().min(1).max(60))
    .max(50, { message: 'Máximo 50 tags.' }),
});

type PuestoFormValues = z.infer<typeof puestoFormSchema>;

const EMPTY_DEFAULTS: PuestoFormValues = {
  nombre: '',
  descripcion: '',
  riesgos_asociados: [],
};

function rowToValues(row: PuestoRow): PuestoFormValues {
  return {
    nombre: row.nombre,
    descripcion: row.descripcion ?? '',
    riesgos_asociados: row.riesgos_asociados ?? [],
  };
}

function stripEmpty(values: PuestoFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = { nombre: values.nombre };
  if (values.descripcion !== '') out.descripcion = values.descripcion;
  if (values.riesgos_asociados.length > 0) out.riesgos_asociados = values.riesgos_asociados;
  return out;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function diffPatch(
  initial: PuestoFormValues,
  values: PuestoFormValues,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (values.nombre !== initial.nombre) patch.nombre = values.nombre;
  if (values.descripcion !== initial.descripcion) {
    patch.descripcion = values.descripcion === '' ? null : values.descripcion;
  }
  if (!arraysEqual(initial.riesgos_asociados, values.riesgos_asociados)) {
    patch.riesgos_asociados =
      values.riesgos_asociados.length === 0 ? null : values.riesgos_asociados;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

type Props =
  | { mode: 'create'; initialValues?: never; puestoId?: never }
  | { mode: 'edit'; initialValues: PuestoRow; puestoId: string };

export function PuestoForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [riesgoInput, setRiesgoInput] = useState('');

  const initialFormValues =
    props.mode === 'edit' ? rowToValues(props.initialValues) : EMPTY_DEFAULTS;

  const form = useForm<PuestoFormValues>({
    resolver: zodResolver(puestoFormSchema),
    defaultValues: initialFormValues,
  });

  const riesgos = useWatch({ control: form.control, name: 'riesgos_asociados' }) ?? [];

  function addRiesgo() {
    const value = riesgoInput.trim();
    if (!value) return;
    if (value.length > 60) {
      toast.error('Tag muy largo (máx 60 caracteres)');
      return;
    }
    if (riesgos.includes(value)) {
      setRiesgoInput('');
      return;
    }
    if (riesgos.length >= 50) {
      toast.error('Máximo 50 tags');
      return;
    }
    form.setValue('riesgos_asociados', [...riesgos, value], { shouldDirty: true });
    setRiesgoInput('');
  }

  function removeRiesgo(tag: string) {
    form.setValue(
      'riesgos_asociados',
      riesgos.filter((r) => r !== tag),
      { shouldDirty: true },
    );
  }

  type ActionResult =
    | { ok: true; id: string }
    | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

  function handleResult(result: ActionResult, verb: 'created' | 'updated') {
    if (result.ok) {
      toast.success(verb === 'created' ? 'Puesto creado' : 'Cambios guardados');
      router.push('/epp/catalogo/puestos');
      router.refresh();
      return;
    }

    switch (result.code) {
      case 'INVALID_INPUT':
        if (result.fieldErrors) {
          for (const [field, msgs] of Object.entries(result.fieldErrors)) {
            const msg = msgs[0];
            if (msg && field in EMPTY_DEFAULTS) {
              form.setError(field as keyof PuestoFormValues, { message: msg });
            }
          }
        }
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'DUPLICATE_NAME':
        form.setError('nombre', {
          message: result.fieldErrors?.nombre?.[0] ?? 'Nombre duplicado.',
        });
        toast.error('Nombre duplicado', { description: result.message });
        return;
      case 'FORBIDDEN_NOT_OWNER':
        toast.error('Permisos insuficientes', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Puesto no encontrado');
        router.push('/epp/catalogo/puestos');
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      default:
        toast.error('Error inesperado', { description: result.message });
    }
  }

  function onSubmit(values: PuestoFormValues) {
    if (props.mode === 'edit') {
      const patch = diffPatch(initialFormValues, values);
      if (patch === null) {
        toast.info('Sin cambios para guardar');
        return;
      }
      startTransition(async () => {
        const result = await updatePuestoAction(props.puestoId, patch);
        handleResult(result, 'updated');
      });
      return;
    }
    const payload = stripEmpty(values);
    startTransition(async () => {
      const result = await createPuestoAction(payload);
      handleResult(result, 'created');
    });
  }

  const submitLabel =
    props.mode === 'create'
      ? isPending
        ? 'Creando…'
        : 'Crear puesto'
      : isPending
        ? 'Guardando…'
        : 'Guardar cambios';

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6" noValidate>
        <FormField
          control={form.control}
          name="nombre"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre *</FormLabel>
              <FormControl>
                <Input placeholder="Soldador, gruista, operario…" {...field} disabled={isPending} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="descripcion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Tareas, responsabilidades, contexto…"
                  {...field}
                  disabled={isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="riesgos_asociados"
          render={() => (
            <FormItem>
              <FormLabel>Riesgos asociados</FormLabel>
              <p className="text-muted-foreground text-xs">
                Tags libres (caída altura, ruido, químico…) que más adelante alimentan la sugerencia
                de EPP por IA.
              </p>
              <div className="flex gap-2">
                <Input
                  value={riesgoInput}
                  onChange={(e) => setRiesgoInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addRiesgo();
                    }
                  }}
                  placeholder="Escribí un riesgo y presioná Enter"
                  disabled={isPending}
                  data-testid="riesgo-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={addRiesgo}
                  disabled={isPending || !riesgoInput.trim()}
                >
                  Agregar
                </Button>
              </div>
              {riesgos.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2" data-testid="riesgos-list">
                  {riesgos.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeRiesgo(tag)}
                        disabled={isPending}
                        className="hover:text-destructive ml-1 inline-flex"
                        aria-label={`Quitar ${tag}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => router.back()} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isPending}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Form>
  );
}
