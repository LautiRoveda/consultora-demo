'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/shared/ui/form';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Separator } from '@/shared/ui/separator';

const formSchema = z.object({
  email: z.string().email({ message: 'Ingresá un email válido.' }),
  password: z.string().min(8, { message: 'Mínimo 8 caracteres.' }),
});

type FormValues = z.infer<typeof formSchema>;

const SEVERITY_TOKENS = [
  { name: 'severity-ok', bg: 'bg-severity-ok', fg: 'text-severity-ok-foreground', label: 'OK' },
  {
    name: 'severity-info',
    bg: 'bg-severity-info',
    fg: 'text-severity-info-foreground',
    label: 'Info',
  },
  {
    name: 'severity-warning',
    bg: 'bg-severity-warning',
    fg: 'text-severity-warning-foreground',
    label: 'Warning',
  },
  {
    name: 'severity-danger',
    bg: 'bg-severity-danger',
    fg: 'text-severity-danger-foreground',
    label: 'Danger',
  },
];

export function StyleguideClient() {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', password: '' },
  });

  function onSubmit(values: FormValues) {
    toast.success('Form enviado', { description: `email=${values.email}` });
  }

  return (
    <main className="container mx-auto max-w-4xl space-y-10 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Styleguide</h1>
        <p className="text-muted-foreground">
          Referencia visual del theme T-008 (paleta indigo + severities) y los componentes shadcn
          instalados. Dev tool — devuelve 404 en producción.
        </p>
      </header>

      <Separator />

      {/* ── Tipografía ─────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Tipografía</h2>
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold">Heading 1 · Geist Sans 4xl</h1>
          <h2 className="text-3xl font-semibold">Heading 2 · 3xl</h2>
          <h3 className="text-2xl font-semibold">Heading 3 · 2xl</h3>
          <h4 className="text-xl font-semibold">Heading 4 · xl</h4>
          <p className="text-base">
            Cuerpo · Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
            incididunt ut labore et dolore magna aliqua.
          </p>
          <p className="text-muted-foreground text-sm">Texto muted · sm.</p>
          <pre className="bg-muted text-foreground rounded-md p-3 font-mono text-sm">
            {`const informe = await generarInforme({ tipo: 'ruido' });`}
          </pre>
        </div>
      </section>

      <Separator />

      {/* ── Paleta brand + severities ──────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Paleta</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <div className="bg-primary text-primary-foreground flex h-24 flex-col justify-end rounded-md p-3">
            <span className="text-xs font-medium opacity-80">--primary</span>
            <span className="text-sm font-semibold">Brand · indigo</span>
          </div>
          {SEVERITY_TOKENS.map(({ name, bg, fg, label }) => (
            <div key={name} className={`${bg} ${fg} flex h-24 flex-col justify-end rounded-md p-3`}>
              <span className="text-xs font-medium opacity-80">--{name}</span>
              <span className="text-sm font-semibold">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      {/* ── Buttons ────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Buttons</h2>
        <div className="flex flex-wrap gap-2">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="link">Link</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Small</Button>
          <Button>Default</Button>
          <Button size="lg">Large</Button>
          <Button disabled>Disabled</Button>
        </div>
      </section>

      <Separator />

      {/* ── Input + Label ──────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Input + Label</h2>
        <div className="grid max-w-md gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="demo-email">Email</Label>
            <Input id="demo-email" type="email" placeholder="lautaro@ejemplo.com" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="demo-disabled">Deshabilitado</Label>
            <Input id="demo-disabled" disabled placeholder="No se puede editar" />
          </div>
        </div>
      </section>

      <Separator />

      {/* ── Card ───────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Card</h2>
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Próximo vencimiento</CardTitle>
            <CardDescription>Protocolo de ruido · cliente Acme SA</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm">Vence en 7 días (2026-05-17).</p>
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ── Form (react-hook-form + zod) ────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Form (RHF + Zod)</h2>
        <Form {...form}>
          <form
            onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}
            className="grid max-w-md gap-4"
          >
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="lautaro@ejemplo.com" {...field} />
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
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-fit">
              Enviar
            </Button>
          </form>
        </Form>
      </section>

      <Separator />

      {/* ── Toasts ─────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Toasts (sonner)</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => toast('Default toast')}>Default</Button>
          <Button
            variant="secondary"
            onClick={() => toast.success('Operación OK', { description: 'Vencimiento atendido.' })}
          >
            Success
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.info('Cambió la norma', { description: 'Res 85/12 → versión 2.' })}
          >
            Info
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              toast.warning('Vence en 7 días', {
                description: 'EPP de Juan Pérez próximo a vencer.',
              })
            }
          >
            Warning
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              toast.error('No se pudo guardar', { description: 'Reintentá en unos segundos.' })
            }
          >
            Error
          </Button>
        </div>
      </section>
    </main>
  );
}
