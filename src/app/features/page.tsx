import type { LucideIcon } from 'lucide-react';
import type { Metadata } from 'next';
import {
  CalendarIcon,
  ClipboardCheckIcon,
  FileTextIcon,
  HardHatIcon,
  PlayCircleIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { CTASection } from '@/shared/landing/CTASection';
import { LandingFooter } from '@/shared/landing/LandingFooter';
import { LandingHeader } from '@/shared/landing/LandingHeader';
import { WhatsAppFloat } from '@/shared/landing/WhatsAppFloat';
import { TRIAL_DAYS } from '@/shared/lib/trial-days';
import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

/**
 * T-108 · Página pública `/features`.
 *
 * Server Component (○ Static prerendered). Hero con video placeholder
 * (`#video` ancla para deep-link desde landing hero CTA "Ver demo 30 seg"),
 * 5 secciones split layout alternadas (IA + EPP + Calendario + Audit +
 * Protocolos AR), sección roadmap "Próximas features" con 6 cards, CTA
 * final reutilizando CTASection.
 *
 * Assets en `public/landing/` son placeholders generados por
 * `scripts/dev-generate-landing-placeholders.ts`. Lautaro los reemplaza
 * con screenshots reales del Cliente Demo SA pre-CP5 smoke productivo.
 * Buscar `TODO(T-108-CP5-assets)` para listar todos los call-sites.
 *
 * OG dynamic via /api/og?title=Features (edge runtime, CP1).
 */

const OG_TITLE = 'Features';
const OG_TAGLINE = 'IA que cita la Res SRT · multi-canal · audit log inmutable';
const OG_PARAMS = `?title=${encodeURIComponent(OG_TITLE)}&tagline=${encodeURIComponent(OG_TAGLINE)}`;

export const metadata: Metadata = {
  title: 'Features',
  description: `IA argentina con tablas SRT verificadas, calendario multi-canal de vencimientos normativos, EPP con planilla Res 299/11 firmada y audit log inmutable. Conocé el detalle de cada función antes de empezar tu trial de ${TRIAL_DAYS} días.`,
  alternates: { canonical: '/features' },
  openGraph: {
    title: 'Features · ConsultoraDemo',
    description: `IA argentina que cita la Res SRT con número exacto. Calendario multi-canal. Audit log inmutable. ${TRIAL_DAYS} días gratis sin tarjeta.`,
    url: '/features',
    type: 'website',
    locale: 'es_AR',
    siteName: 'ConsultoraDemo',
    images: [
      { url: `/api/og${OG_PARAMS}`, width: 1200, height: 630, alt: 'ConsultoraDemo · Features' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Features · ConsultoraDemo',
    description: `IA argentina que cita la Res SRT con número exacto. ${TRIAL_DAYS} días gratis sin tarjeta.`,
    images: [`/api/og${OG_PARAMS}`],
  },
};

interface FeatureSection {
  id: string;
  index: string;
  icon: LucideIcon;
  title: string;
  body: string;
  bullets: readonly string[];
  imageSrc: string;
  imageAlt: string;
}

// TODO(T-108-CP5-assets): los imageSrc apuntan a placeholders generados por
// scripts/dev-generate-landing-placeholders.ts. Lautaro reemplaza con
// screenshots reales del Cliente Demo SA pre-CP5 smoke productivo sin tocar
// código (mismos paths).
const FEATURES: readonly FeatureSection[] = [
  {
    id: 'ia-streaming',
    index: '01',
    icon: SparklesIcon,
    title: 'Generación de informes con IA streaming en vivo',
    body: 'La IA escribe tu informe técnico en tiempo real con citas SRT verificadas. Mediciones, criterios y conclusiones aparecen token por token mientras la IA piensa.',
    bullets: [
      'Streaming visible: ves el texto aparecer en pantalla, no esperás 30 segundos a un bloque.',
      'Res SRT 85/12 (ruido) cargada con valores oficiales — la IA cita con número y vigencia.',
      'Disclaimer de vigencia + URL Infoleg en cada cita. Vos editás y firmás antes de presentar.',
    ],
    imageSrc: '/landing/demo-informe-ruido-preview.png',
    imageAlt: 'Preview del PDF de informe técnico de ruido generado con IA streaming',
  },
  {
    id: 'epp-29911',
    index: '02',
    icon: HardHatIcon,
    title: 'EPP con planilla Res SRT 299/11 firmada',
    body: 'Cargás las entregas de EPP por empleado en un wizard guiado. La app genera la planilla 299/11 oficial con firma del empleado y código de verificación al pie.',
    bullets: [
      'Wizard por empleado: seleccionás items del catálogo, cantidad, fecha de entrega.',
      'Firma digital (signature pad mobile-friendly) o adjunto de planilla papel escaneada.',
      'PDF con marca de tu consultora + datos del matriculado + código de verificación.',
    ],
    imageSrc: '/landing/demo-planilla-epp-preview.png',
    imageAlt: 'Preview de planilla EPP Res SRT 299/11 con firma del empleado',
  },
  {
    id: 'calendario',
    index: '03',
    icon: CalendarIcon,
    title: 'Calendario que avisa antes de cada vencimiento',
    body: 'Cada evento (protocolo anual, entrega EPP 6m, calibración, capacitación, examen médico) entra al calendario con la antelación que vos definís y por el canal que elegís.',
    bullets: [
      'Multi-canal: email, Telegram bot y push web nativas. Activás los que querés por categoría.',
      'Offsets configurables por tipo: 30 días para protocolos anuales, 5 días para EPP, etc.',
      'Vista mensual + agenda por buckets ("vencen hoy", "esta semana", "este mes").',
    ],
    imageSrc: '/landing/demo-informe-ergonomia-preview.png',
    imageAlt: 'Preview del calendario de vencimientos normativos',
  },
  {
    id: 'audit-log',
    index: '04',
    icon: ShieldCheckIcon,
    title: 'Audit log inmutable compatible con ISO 45001',
    body: 'Cada cambio sobre datos del dominio (clientes, empleados, EPP, informes, calendario) queda registrado con timestamp, actor y diff antes/después. Útil para auditorías SRT y certificación.',
    bullets: [
      'Trigger DB AFTER INSERT/UPDATE/DELETE — la app no puede saltearlo.',
      'Diff guard: solo escribe filas si hubo cambio efectivo (no ruido).',
      'Multi-tenant por consultora con RLS — cada cliente ve solo el suyo.',
    ],
    imageSrc: '/landing/demo-informe-ruido-preview.png',
    imageAlt: 'Preview de la tabla audit_log con timestamps y diffs',
  },
  {
    id: 'protocolos-ar',
    index: '05',
    icon: FileTextIcon,
    title: 'Templates de protocolos técnicos argentinos',
    body: 'Ruido (Res 85/12), iluminación (Res 84/12), puesta a tierra, RGRL anual, carga de fuego y más. La IA arranca con el template + tu form estructurado y completa el resto.',
    bullets: [
      'Forms estructurados con validación Zod — no podés generar un PDF con campos faltantes.',
      'Plantillas alineadas con la normativa AR vigente — disclaimer de vigencia en cada output.',
      'Branding de tu consultora: logo, datos del matriculado, número de matrícula al pie.',
    ],
    imageSrc: '/landing/demo-planilla-epp-preview.png',
    imageAlt: 'Preview de PDF de protocolo técnico con branding del consultor',
  },
];

const ROADMAP_ITEMS = [
  'Res 84/12 (iluminación) al prompt IA con valores oficiales',
  'Chat IA contextual sobre tus datos (preguntá "¿cuándo vence X?")',
  'Importación CSV de empleados y clientes',
  'OCR de planillas papel → digitalización automática',
  'WhatsApp Business API como canal de alertas',
  'PWA offline para uso en obra sin señal',
] as const;

function FeatureSplit({ feature, index }: { feature: FeatureSection; index: number }) {
  const Icon = feature.icon;
  const isReversed = index % 2 === 1;
  const textOrderClass = isReversed ? 'md:order-2' : '';
  const imageOrderClass = isReversed ? 'md:order-1' : '';

  return (
    <section
      id={feature.id}
      className="border-t px-4 py-16 sm:py-20"
      aria-labelledby={`${feature.id}-title`}
    >
      <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-2 md:items-center md:gap-12 lg:gap-16">
        <div className={textOrderClass}>
          <div className="flex items-center gap-3">
            <span className="text-primary/40 text-xs font-bold tracking-wide">{feature.index}</span>
            <span className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-md">
              <Icon className="size-5" aria-hidden="true" />
            </span>
          </div>
          <h2
            id={`${feature.id}-title`}
            className="mt-4 text-2xl font-semibold leading-tight tracking-tight sm:text-3xl"
          >
            {feature.title}
          </h2>
          <p className="text-muted-foreground mt-4 text-base leading-relaxed">{feature.body}</p>
          <ul className="mt-5 space-y-2.5">
            {feature.bullets.map((b) => (
              <li key={b} className="flex items-start gap-2 text-sm">
                <ClipboardCheckIcon
                  className="text-severity-ok mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span className="leading-relaxed">{b}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={imageOrderClass}>
          {/*
            TODO(T-108-CP5-assets): imageSrc apunta a placeholder generado por
            scripts/dev-generate-landing-placeholders.ts. Reemplazo con asset
            real pre-CP5 sin tocar este JSX.
          */}
          <Image
            src={feature.imageSrc}
            alt={feature.imageAlt}
            width={1200}
            height={630}
            sizes="(min-width: 768px) 50vw, 100vw"
            className="bg-muted/30 h-auto w-full rounded-lg border shadow-sm"
          />
        </div>
      </div>
    </section>
  );
}

export default function FeaturesPage() {
  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-primary-foreground focus-visible:shadow-lg"
      >
        Saltar al contenido principal
      </a>

      <LandingHeader />

      <main id="main-content" className="flex-1">
        {/* ── Hero ───────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden">
          <div
            className="from-primary/8 via-primary/3 pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b to-transparent"
            aria-hidden="true"
          />
          <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                La IA argentina que cita la Resolución SRT con número exacto.
              </h1>
              <p className="text-foreground/80 mx-auto mt-6 max-w-2xl text-lg sm:text-xl">
                ConsultoraDemo no es un wrapper genérico de ChatGPT. Es un sistema con las tablas
                oficiales del SRT cargadas, multi-canal nativo y audit log inmutable.
              </p>
            </div>

            {/* Video placeholder con id="video" para deep-link desde landing CTA. */}
            <div
              id="video"
              role="region"
              aria-label="Video demo de ConsultoraDemo"
              className="bg-card/60 mx-auto mt-12 flex aspect-video max-w-3xl flex-col items-center justify-center rounded-xl border-2 border-dashed shadow-sm"
            >
              <PlayCircleIcon
                className="text-primary/40 size-16"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <p className="text-foreground mt-4 text-base font-medium">Video demo próximamente</p>
              <p className="text-muted-foreground mt-1 max-w-xs text-center text-sm">
                Mientras tanto, mirá el detalle de cada función abajo o probá las {TRIAL_DAYS} días
                gratis sin tarjeta.
              </p>
            </div>
          </section>
        </div>

        {/* ── 5 features split layout ─────────────────────────────────────── */}
        {FEATURES.map((feature, idx) => (
          <FeatureSplit key={feature.id} feature={feature} index={idx} />
        ))}

        {/* Inline CTA después de la feature 2 (post-EPP). Pero se pone abajo
            del listado completo para no romper el flujo visual del map. En su
            lugar usamos un CTA central después del map y otro al final. */}
        <div className="border-t px-4 py-12">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground text-base">
              ¿Querés probarlo con tus propios clientes y empleados?
            </p>
            <Button asChild size="lg" className="shadow-md transition-shadow hover:shadow-lg">
              <Link href="/signup">Empezar {TRIAL_DAYS} días gratis</Link>
            </Button>
          </div>
        </div>

        {/* ── Próximas features (Roadmap) ─────────────────────────────────── */}
        <section
          id="roadmap"
          aria-labelledby="roadmap-title"
          className="bg-muted/20 border-t px-4 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="roadmap-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Próximas features
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Construido con prioridad por feedback real. Sumate al beta y proponé features por
              WhatsApp — escuchamos y publicamos.
            </p>
          </div>
          <div className="mx-auto mt-10 grid max-w-5xl gap-4 sm:grid-cols-2 md:grid-cols-3">
            {ROADMAP_ITEMS.map((item) => (
              <Card key={item} className="border-dashed bg-transparent">
                <CardContent className="pt-5">
                  <Badge variant="outline" className="mb-3 text-xs font-medium">
                    Roadmap
                  </Badge>
                  <p className="text-foreground text-sm leading-relaxed">{item}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── CTA final ──────────────────────────────────────────────────── */}
        <div className="border-t">
          <CTASection
            heading={`Probalo ${TRIAL_DAYS} días sin tarjeta`}
            subheading="Sin compromiso, sin demos agendadas con vendedor. Creás la cuenta y arrancás a generar informes y cargar empleados."
            primaryLabel="Crear cuenta gratis"
          />
        </div>
      </main>

      <LandingFooter />
      <WhatsAppFloat />
    </>
  );
}
