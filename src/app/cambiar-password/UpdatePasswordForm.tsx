'use client';

import type { UpdatePasswordInput } from './schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';

import { updatePasswordAction } from './actions';
import { updatePasswordInputSchema } from './schema';

export function UpdatePasswordForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<UpdatePasswordInput>({
    resolver: zodResolver(updatePasswordInputSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  async function onSubmit(values: UpdatePasswordInput) {
    setIsPending(true);
    const result = await updatePasswordAction(values);

    if (result.ok) {
      router.push(result.redirectTo);
      router.refresh();
      return;
    }

    setIsPending(false);

    switch (result.code) {
      case 'NO_SESSION':
        toast.error('Sesión expirada', { description: result.message });
        // Después del toast, dar tiempo a que el user lo lea y mandarlo a /login.
        setTimeout(() => router.push('/login'), 2000);
        return;
      case 'SAME_PASSWORD':
        toast.error('Contraseña inválida', { description: result.message });
        return;
      case 'INVALID_INPUT':
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error inesperado', { description: result.message });
        return;
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Definir nueva contraseña</CardTitle>
        <p className="text-muted-foreground text-sm">
          Elegí una contraseña nueva para tu cuenta. Mínimo 8 caracteres.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="grid gap-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nueva contraseña</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Repetí la contraseña</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Guardando…' : 'Guardar contraseña'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
