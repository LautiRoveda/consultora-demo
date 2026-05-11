'use client';

import type { RecoverPasswordInput } from './schema';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';

import { recoverPasswordAction } from './actions';
import { recoverPasswordInputSchema } from './schema';

export function RecoverPasswordForm() {
  const [isPending, setIsPending] = useState(false);

  const form = useForm<RecoverPasswordInput>({
    resolver: zodResolver(recoverPasswordInputSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: RecoverPasswordInput) {
    setIsPending(true);
    const result = await recoverPasswordAction(values);
    setIsPending(false);

    if (result.ok) {
      toast.success('Link enviado', { description: result.message });
      form.reset();
      return;
    }

    switch (result.code) {
      case 'RATE_LIMITED':
        toast.error('Demasiados intentos', { description: result.message });
        return;
      case 'INVALID_INPUT':
        toast.error('Datos inválidos', { description: result.message });
        return;
    }
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl">Recuperar contraseña</CardTitle>
        <p className="text-muted-foreground text-sm">
          Ingresá tu email y te mandamos un link para definir una nueva contraseña.
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
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Enviando…' : 'Enviar link de recuperación'}
            </Button>
          </form>
        </Form>

        <p className="text-muted-foreground border-t pt-4 text-center text-sm">
          <Link href="/login" className="text-foreground font-medium hover:underline">
            ← Volver a iniciar sesión
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
