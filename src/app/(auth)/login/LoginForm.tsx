'use client';

import type { LoginInput } from './schema';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';

import { loginAction } from './actions';
import { loginInputSchema } from './schema';

export function LoginForm() {
  const [isPending, setIsPending] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginInput) {
    setIsPending(true);
    const result = await loginAction(values);
    setIsPending(false);

    if (result.ok) {
      // T-012 va a redirigir aquí. T-009: nunca pasamos por este branch.
      toast.success('Sesión iniciada');
      return;
    }

    if (result.code === 'AUTH_NOT_IMPLEMENTED') {
      toast.info('Próximamente', { description: result.message });
      return;
    }

    // INVALID_INPUT — RHF + zodResolver lo cubren del lado client antes de
    // llamar a la action, así que llegar acá indica drift entre schemas.
    toast.error('Datos inválidos', { description: result.message });
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
        <p className="text-muted-foreground text-sm">
          Email y contraseña. Auth real llega en el próximo sprint.
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="lautaro@consultorademo.com.ar"
                      autoComplete="email"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contraseña</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Ingresando…' : 'Iniciar sesión'}
            </Button>
          </form>
        </Form>

        <p className="text-muted-foreground border-t pt-4 text-center text-sm">
          ¿Todavía no tenés cuenta?{' '}
          <span className="text-foreground font-medium">Empezá tu prueba de 7 días</span>{' '}
          <span className="text-xs">(disponible desde T-012)</span>.
        </p>
      </CardContent>
    </Card>
  );
}
