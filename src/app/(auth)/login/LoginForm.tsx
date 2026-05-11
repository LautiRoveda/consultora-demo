'use client';

import type { LoginInput } from './schema';
import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';

import { loginAction, magicLinkAction } from './actions';
import { loginInputSchema, magicLinkInputSchema } from './schema';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirmed = searchParams.get('confirmed');
  const callbackError = searchParams.get('error');

  const [isPending, setIsPending] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginInput) {
    setIsPending(true);
    const result = await loginAction(values);

    if (result.ok) {
      // No reseteamos isPending: el router.push deja el button en "Ingresando…"
      // hasta que la nueva página rendere (evita doble submit).
      router.push(result.redirectTo);
      router.refresh(); // fuerza re-render del Server Component con la nueva sesión
      return;
    }

    setIsPending(false);

    switch (result.code) {
      case 'INVALID_CREDENTIALS':
        toast.error('No se pudo iniciar sesión', { description: result.message });
        return;
      case 'EMAIL_NOT_CONFIRMED':
        toast.error('Cuenta no confirmada', { description: result.message });
        return;
      case 'RATE_LIMITED':
        toast.error('Demasiados intentos', { description: result.message });
        return;
      case 'INVALID_INPUT':
        toast.error('Datos inválidos', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error inesperado', { description: result.message });
        return;
    }
  }

  async function handleMagicLink() {
    const email = form.getValues('email');
    const parsed = magicLinkInputSchema.safeParse({ email });
    if (!parsed.success) {
      form.setError('email', {
        message: parsed.error.issues[0]?.message ?? 'Ingresá un email válido.',
      });
      return;
    }

    setIsPending(true);
    const result = await magicLinkAction({ email });
    setIsPending(false);

    if (result.ok) {
      toast.success('Magic link enviado', { description: result.message });
      return;
    }

    switch (result.code) {
      case 'RATE_LIMITED':
        toast.error('Demasiados intentos', { description: result.message });
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
        <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
        <p className="text-muted-foreground text-sm">
          Email y contraseña, o pedí un magic link al inbox.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {confirmed === '1' && (
          <Alert>
            <AlertTitle>Cuenta confirmada</AlertTitle>
            <AlertDescription>Ingresá con tu email y contraseña.</AlertDescription>
          </Alert>
        )}
        {callbackError === 'callback_failed' && (
          <Alert variant="destructive">
            <AlertTitle>Link expirado</AlertTitle>
            <AlertDescription>
              El link de confirmación expiró o ya fue usado. Si no podés iniciar sesión, escribinos.
            </AlertDescription>
          </Alert>
        )}
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

        <div className="relative my-2 flex items-center">
          <div className="bg-border h-px flex-1" />
          <span className="text-muted-foreground px-3 text-xs uppercase">o</span>
          <div className="bg-border h-px flex-1" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isPending}
          onClick={() => void handleMagicLink()}
        >
          Enviar magic link al email
        </Button>

        <p className="text-muted-foreground border-t pt-4 text-center text-sm">
          ¿Todavía no tenés cuenta?{' '}
          <Link href="/signup" className="text-foreground font-medium hover:underline">
            Crear cuenta
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
