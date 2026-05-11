'use client';

import type { CreateInformeInput } from '../schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { createInformeAction } from '../actions';
import { createInformeSchema, INFORME_TIPO_LABELS, INFORME_TIPOS } from '../schema';

export function InformeNuevoForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<CreateInformeInput>({
    resolver: zodResolver(createInformeSchema),
    defaultValues: { tipo: 'relevamiento', titulo: '' },
  });

  async function onSubmit(values: CreateInformeInput) {
    setIsPending(true);
    const result = await createInformeAction(values);

    if (result.ok) {
      router.push(result.redirectTo);
      router.refresh();
      return;
    }

    setIsPending(false);

    if (result.code === 'INVALID_INPUT') {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        if (field === 'tipo' || field === 'titulo') {
          form.setError(field, { message: messages[0] });
        }
      }
      toast.error('Datos inválidos', { description: result.message });
      return;
    }

    switch (result.code) {
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error inesperado', { description: result.message });
        return;
    }
  }

  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6">
        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo de informe</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elegí un tipo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {INFORME_TIPOS.map((tipo) => (
                        <SelectItem key={tipo} value={tipo}>
                          {INFORME_TIPO_LABELS[tipo]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input placeholder="Ej: Relevamiento de ruido — Planta Sur" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Creando…' : 'Crear informe'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
