'use client';

import type { SignupInput } from './schema';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';

import { signupAction } from './actions';
import { signupInputSchema } from './schema';

export function SignupForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupInputSchema),
    defaultValues: { email: '', password: '', consultoraName: '' },
  });

  async function onSubmit(values: SignupInput) {
    setIsPending(true);
    const result = await signupAction(values);

    if (result.ok) {
      // No reseteamos isPending: dejamos el botón en "Creando..." hasta que el
      // router.push complete el navigation (evita doble submit accidental).
      router.push(result.redirectTo);
      return;
    }

    setIsPending(false);

    switch (result.code) {
      case 'EMAIL_ALREADY_REGISTERED':
        toast.error('Email ya registrado', { description: result.message });
        return;
      case 'WEAK_PASSWORD':
        toast.error('Contraseña débil', { description: result.message });
        return;
      case 'RATE_LIMITED':
        toast.error('Demasiados intentos', { description: result.message });
        return;
      case 'INVALID_INPUT':
        // RHF + zodResolver lo cubren del lado client; llegar acá indica drift.
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
        <CardTitle className="text-2xl">Crear cuenta</CardTitle>
        <p className="text-muted-foreground text-sm">
          Empezá tu prueba de 7 días gratis. Sin tarjeta de crédito.
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
              name="consultoraName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nombre de la consultora</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="Consultoría Pérez & Asociados"
                      autoComplete="organization"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? 'Creando cuenta…' : 'Crear cuenta'}
            </Button>
          </form>
        </Form>

        <p className="text-muted-foreground border-t pt-4 text-center text-sm">
          ¿Ya tenés cuenta?{' '}
          <Link href="/login" className="text-foreground font-medium hover:underline">
            Iniciar sesión
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
