import {
  AlarmClockIcon,
  BanknoteIcon,
  CalendarIcon,
  CheckIcon,
  ClipboardListIcon,
  FileTextIcon,
  LayersIcon,
} from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/shared/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Separator } from '@/shared/ui/separator';

const PROBLEMS = [
  {
    icon: FileTextIcon,
    title: 'Pasás 2-4 horas redactando cada informe',
    body: 'Word + Excel + planillas a mano. Cuando volvés de planta, ya no querés escribir.',
  },
  {
    icon: AlarmClockIcon,
    title: 'Se te pasa una entrega de EPP a 6 meses',
    body: 'La SRT te sanciona con la Resolución 299/11 y al cliente le tocás explicar por qué.',
  },
  {
    icon: LayersIcon,
    title: 'Las herramientas existentes son CRMs pesados',
    body: '50 features que no usás, precio escondido, soporte por mail tres días después.',
  },
];

const PILLARS = [
  {
    icon: ClipboardListIcon,
    title: 'Informes en 5 minutos',
    body: 'Ruido, iluminación, puesta a tierra, RGRL y carga de fuego con IA. Normativa argentina al día. Tu firma profesional al pie. Salida PDF firmable.',
  },
  {
    icon: CalendarIcon,
    title: 'Cero multas por olvido',
    body: 'Calendario que avisa antes: EPP a 5 meses, protocolos anuales con 30 días de antelación, calibraciones, capacitaciones.',
  },
  {
    icon: BanknoteIcon,
    title: 'Pricing claro, sin comerciales',
    body: 'USD 30 al mes. 7 días gratis sin tarjeta. Cancelás cuando quieras desde tu cuenta.',
  },
];

const PRICING_FEATURES = [
  'Informes ilimitados con IA',
  'Empleados ilimitados con tracking de EPP',
  'Calendario de vencimientos completo',
  'Notificaciones push + email',
  'Versionado de normas con comparación IA',
  'Soporte por email',
];

const FAQS = [
  {
    q: '¿Necesito tarjeta de crédito para probar?',
    a: 'No. 7 días gratis sin tarjeta. Si no te convence, no hacés nada — la cuenta se desactiva sola.',
  },
  {
    q: '¿Qué pasa con mis datos cuando cancelo?',
    a: 'Mantenés acceso completo durante 30 días para descargar lo que necesites. Pasado ese plazo, los datos se eliminan según la Ley 25.326 de Protección de Datos Personales.',
  },
  {
    q: '¿Funciona en celular?',
    a: 'Sí, desde cualquier navegador moderno. La PWA offline con permisos diarios y kit de jornada llega en Fase 3 — pensada para uso en obra.',
  },
  {
    q: '¿Reemplaza mi firma profesional?',
    a: 'No. Vos sos el matriculado y firmás cada informe. La app te ayuda a producirlos más rápido y con menos errores, pero la responsabilidad civil/penal sigue siendo tuya.',
  },
];

export default function HomePage() {
  return (
    <>
      {/* Skip-link a11y — visible solo al focus por teclado. */}
      <a
        href="#main-content"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Saltar al contenido principal
      </a>

      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="flex items-center gap-2">
            <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-bold">
              CD
            </span>
            <span className="text-sm font-semibold">ConsultoraDemo</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/prototipo">Demo</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/login">Iniciar sesión</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
              Tu consultora de Higiene y Seguridad Laboral, en piloto automático
            </h1>
            <p className="text-muted-foreground mt-6 text-lg sm:text-xl">
              El asistente argentino que escribe tus informes con IA y nunca te deja olvidar un
              vencimiento. Para consultores HyS por USD 30 al mes.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">Empezar prueba de 7 días</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/prototipo">Ver demo</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-6 text-sm">
              Hecho en Argentina · cumplimiento SRT
            </p>
          </div>
        </section>

        <Separator />

        {/* ── Problema ───────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              Si sos consultor HyS, esto te suena
            </h2>
            <p className="text-muted-foreground mt-3">
              Tres dolores que se repiten en cada conversación con consultores en AMBA y el resto
              del país.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {PROBLEMS.map(({ icon: Icon, title, body }) => (
              <Card key={title}>
                <CardHeader>
                  <Icon className="text-muted-foreground size-6" aria-hidden="true" />
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">{body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* ── Solución / Pilares ─────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">
              Dos pilares hechos mejor que la competencia
            </h2>
            <p className="text-muted-foreground mt-3">
              No es una suite EHS genérica. Son dos cosas concretas resueltas con la profundidad que
              el rubro necesita.
            </p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <Card key={title} className="border-primary/20">
                <CardHeader>
                  <span className="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-md">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground text-sm">{body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator />

        {/* ── Pricing ────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight">Plan Pro</h2>
            <p className="text-muted-foreground mt-3">
              Un consultor, un plan. Pricing público, sin comercial intermediario.
            </p>
          </div>
          <Card className="mx-auto mt-10 max-w-md">
            <CardHeader>
              <CardTitle>
                <span className="text-4xl font-semibold">USD 30</span>
                <span className="text-muted-foreground text-base font-normal"> / mes</span>
              </CardTitle>
              <p className="text-muted-foreground text-sm">
                7 días gratis sin tarjeta. Cancelás cuando quieras.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {PRICING_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm">
                    <CheckIcon
                      className="text-severity-ok mt-0.5 size-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="w-full" size="lg">
                <Link href="/signup">Empezar prueba de 7 días</Link>
              </Button>
            </CardContent>
          </Card>
          <p className="text-muted-foreground mt-6 text-center text-xs">
            Plan Team (USD 100) y Enterprise (USD 250) disponibles más adelante.
          </p>
        </section>

        <Separator />

        {/* ── FAQ ────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-3xl px-4 py-16">
          <h2 className="text-center text-3xl font-semibold tracking-tight">
            Preguntas frecuentes
          </h2>
          <div className="divide-border mt-10 divide-y border-y">
            {FAQS.map(({ q, a }) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between text-left font-medium">
                  <span>{q}</span>
                  <span
                    className="text-muted-foreground transition-transform group-open:rotate-45"
                    aria-hidden="true"
                  >
                    +
                  </span>
                </summary>
                <p className="text-muted-foreground mt-3 text-sm">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto max-w-5xl px-4 py-10 text-sm">
          <div className="flex flex-col gap-6 sm:flex-row sm:justify-between">
            <div>
              <p className="text-foreground font-semibold">ConsultoraDemo</p>
              <p className="mt-1">© 2026 · Hecho en Argentina.</p>
            </div>
            <nav className="flex flex-wrap gap-x-6 gap-y-2">
              <Link href="/terminos" className="hover:text-foreground">
                Términos
              </Link>
              <Link href="/privacidad" className="hover:text-foreground">
                Privacidad
              </Link>
              <Link href="/prototipo" className="hover:text-foreground">
                Demo
              </Link>
              <Link href="/login" className="hover:text-foreground">
                Iniciar sesión
              </Link>
            </nav>
          </div>
          <p className="mt-8 max-w-3xl text-xs">
            Asistente que genera documentos. El profesional matriculado es responsable de revisar y
            firmar todo informe antes de presentarlo legalmente. La app no reemplaza criterio
            profesional ni absuelve responsabilidad civil/penal.
          </p>
        </div>
      </footer>
    </>
  );
}
