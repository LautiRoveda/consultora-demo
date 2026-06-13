'use client';

import type { AgenteRow } from './queries';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { optionalString } from '@/shared/lib/zod-form-helpers';
import { Button } from '@/shared/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';
import { Textarea } from '@/shared/ui/textarea';

import { createAgenteAction, updateAgenteAction } from './actions';
import { TIPO_LABELS, TIPO_ORDER } from './labels';
import { AGENTE_TIPOS } from './schema';

const agenteFormSchema = z.object({
  codigo: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(60, { message: 'Máximo 60 caracteres.' }),
  nombre: z
    .string()
    .trim()
    .min(2, { message: 'Mínimo 2 caracteres.' })
    .max(120, { message: 'Máximo 120 caracteres.' }),
  agente_tipo: z.enum(AGENTE_TIPOS, { message: 'Elegí un tipo.' }),
  cas: optionalString({ max: 40, label: 'CAS' }),
  enfermedad_asociada: optionalString({ max: 200, label: 'enfermedad' }),
  descripcion: optionalString({ max: 500, label: 'descripción' }),
});

type AgenteFormValues = z.infer<typeof agenteFormSchema>;

const EMPTY_DEFAULTS: AgenteFormValues = {
  codigo: '',
  nombre: '',
  agente_tipo: 'fisico',
  cas: '',
  enfermedad_asociada: '',
  descripcion: '',
};

function rowToValues(row: AgenteRow): AgenteFormValues {
  return {
    codigo: row.codigo,
    nombre: row.nombre,
    agente_tipo: row.agente_tipo,
    cas: row.cas ?? '',
    enfermedad_asociada: row.enfermedad_asociada ?? '',
    descripcion: row.descripcion ?? '',
  };
}

function stripEmpty(values: AgenteFormValues): Record<string, unknown> {
  const out: Record<string, unknown> = {
    codigo: values.codigo,
    nombre: values.nombre,
    agente_tipo: values.agente_tipo,
  };
  if (values.cas !== '') out.cas = values.cas;
  if (values.enfermedad_asociada !== '') out.enfermedad_asociada = values.enfermedad_asociada;
  if (values.descripcion !== '') out.descripcion = values.descripcion;
  return out;
}

function diffPatch(
  initial: AgenteFormValues,
  values: AgenteFormValues,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  if (values.codigo !== initial.codigo) patch.codigo = values.codigo;
  if (values.nombre !== initial.nombre) patch.nombre = values.nombre;
  if (values.agente_tipo !== initial.agente_tipo) patch.agente_tipo = values.agente_tipo;
  if (values.cas !== initial.cas) patch.cas = values.cas === '' ? null : values.cas;
  if (values.enfermedad_asociada !== initial.enfermedad_asociada) {
    patch.enfermedad_asociada =
      values.enfermedad_asociada === '' ? null : values.enfermedad_asociada;
  }
  if (values.descripcion !== initial.descripcion) {
    patch.descripcion = values.descripcion === '' ? null : values.descripcion;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

type Props =
  | { mode: 'create'; initialValues?: never; agenteId?: never }
  | { mode: 'edit'; initialValues: AgenteRow; agenteId: string };

type ActionResult =
  | { ok: true; id: string }
  | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

export function AgenteForm(props: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const initialFormValues =
    props.mode === 'edit' ? rowToValues(props.initialValues) : EMPTY_DEFAULTS;

  const form = useForm<AgenteFormValues>({
    resolver: zodResolver(agenteFormSchema),
    defaultValues: initialFormValues,
  });

  function handleResult(result: ActionResult, verb: 'created' | 'updated') {
    if (result.ok) {
      toast.success(verb === 'created' ? 'Agente creado' : 'Cambios guardados');
      router.push('/rar/agentes');
      router.refresh();
      return;
    }

    switch (result.code) {
      case 'INVALID_INPUT':
        if (result.fieldErrors) {
          for (const [field, msgs] of Object.entries(result.fieldErrors)) {
            const msg = msgs[0];
            if (msg && field in EMPTY_DEFAULTS) {
              form.setError(field as keyof AgenteFormValues, { message: msg });
            }
          }
        }
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'DUPLICATE':
        if (result.fieldErrors?.codigo?.[0]) {
          form.setError('codigo', { message: result.fieldErrors.codigo[0] });
        }
        if (result.fieldErrors?.nombre?.[0]) {
          form.setError('nombre', { message: result.fieldErrors.nombre[0] });
        }
        toast.error('Agente duplicado', { description: result.message });
        return;
      case 'FORBIDDEN_NOT_OWNER':
        toast.error('Permisos insuficientes', { description: result.message });
        return;
      case 'NOT_FOUND':
        toast.error('Agente no encontrado');
        router.push('/rar/agentes');
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

  function onSubmit(values: AgenteFormValues) {
    if (props.mode === 'edit') {
      const patch = diffPatch(initialFormValues, values);
      if (patch === null) {
        toast.info('Sin cambios para guardar');
        return;
      }
      startTransition(async () => {
        const result = await updateAgenteAction(props.agenteId, patch);
        handleResult(result, 'updated');
      });
      return;
    }
    const payload = stripEmpty(values);
    startTransition(async () => {
      const result = await createAgenteAction(payload);
      handleResult(result, 'created');
    });
  }

  const submitLabel =
    props.mode === 'create'
      ? isPending
        ? 'Creando…'
        : 'Crear agente'
      : isPending
        ? 'Guardando…'
        : 'Guardar cambios';

  return (
    <Form {...form}>
      <form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} className="space-y-6" noValidate>
        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="codigo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Código *</FormLabel>
                <FormControl>
                  <Input placeholder="90001, 40153…" {...field} disabled={isPending} />
                </FormControl>
                <p className="text-muted-foreground text-xs">Código ESOP (Res SRT 81/2019).</p>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="agente_tipo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tipo *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange} disabled={isPending}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Elegí un tipo" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {TIPO_ORDER.map((tipo) => (
                      <SelectItem key={tipo} value={tipo}>
                        {TIPO_LABELS[tipo]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="nombre"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Nombre *</FormLabel>
              <FormControl>
                <Input
                  placeholder="Ruido, Polvo de sílice cristalina…"
                  {...field}
                  disabled={isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="cas"
            render={({ field }) => (
              <FormItem>
                <FormLabel>N° CAS</FormLabel>
                <FormControl>
                  <Input placeholder="14808-60-7" {...field} disabled={isPending} />
                </FormControl>
                <p className="text-muted-foreground text-xs">Solo agentes químicos.</p>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="enfermedad_asociada"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Enfermedad asociada</FormLabel>
                <FormControl>
                  <Input placeholder="Silicosis, Hipoacusia…" {...field} disabled={isPending} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="descripcion"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Descripción</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder="Contexto, fuentes de exposición, observaciones…"
                  {...field}
                  disabled={isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
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
