import type { FAQItem } from '@/shared/landing/FAQAccordion';
import type { PainGainRow } from '@/shared/landing/PainGainTable';
import type { Metadata } from 'next';

import { env } from '@/env';
import { CTASection } from '@/shared/landing/CTASection';
import { FAQAccordion } from '@/shared/landing/FAQAccordion';
import { LandingFooter } from '@/shared/landing/LandingFooter';
import { LandingHeader } from '@/shared/landing/LandingHeader';
import { PainGainTable } from '@/shared/landing/PainGainTable';
import { PricingCard } from '@/shared/landing/PricingCard';
import { WhatsAppFloat } from '@/shared/landing/WhatsAppFloat';
import { TRIAL_DAYS } from '@/shared/lib/trial-days';

/**
 * T-108 · Página pública `/precios`.
 *
 * Server Component. Reutiliza la infra shared del CP1: LandingHeader/Footer,
 * PricingCard (variant="full"), PainGainTable (variant="precios"),
 * FAQAccordion, CTASection, WhatsAppFloat.
 *
 * Pricing: el caller server-side lee `env.ARS_PRICE_MONTHLY` y lo pasa a
 * PricingCard como `priceCentavos`. La página es Static (prerendered al
 * build): un bump del env var en EasyPanel se refleja recién después del
 * próximo rebuild + redeploy (el webhook EasyPanel lo dispara automático al
 * salvar la env). El trade-off es aceptable — preferimos Lighthouse alto en
 * landing comercial sobre freshness inmediato de un precio que se actualiza
 * 1-2 veces al año.
 *
 * OG dynamic: cada página genera su propia preview con `title` + `tagline`
 * via el endpoint `/api/og` (edge runtime, CP1).
 */

const OG_TITLE = 'Precios';
const OG_TAGLINE = 'Plan único · 14 días gratis sin tarjeta';
const OG_PARAMS = `?title=${encodeURIComponent(OG_TITLE)}&tagline=${encodeURIComponent(OG_TAGLINE)}`;

export const metadata: Metadata = {
  title: 'Precios',
  description: `Plan único ARS 30.000/mes con ${TRIAL_DAYS} días gratis sin tarjeta. Descuento 15% pagando anual. Sin trucos, sin cláusulas escondidas — hecho para higienistas freelance argentinos.`,
  alternates: { canonical: '/precios' },
  openGraph: {
    title: 'Precios · ConsultoraDemo',
    description: `Plan único ARS 30.000/mes con ${TRIAL_DAYS} días gratis sin tarjeta. Descuento 15% pagando anual.`,
    url: '/precios',
    type: 'website',
    locale: 'es_AR',
    siteName: 'ConsultoraDemo',
    images: [
      { url: `/api/og${OG_PARAMS}`, width: 1200, height: 630, alt: 'ConsultoraDemo · Precios' },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Precios · ConsultoraDemo',
    description: `Plan único ARS 30.000/mes con ${TRIAL_DAYS} días gratis sin tarjeta.`,
    images: [`/api/og${OG_PARAMS}`],
  },
};

const PAIN_GAIN_ROWS: readonly PainGainRow[] = [
  {
    pain: 'Pasás 2 a 4 horas redactando cada informe técnico a mano en Word + Excel.',
    gain: 'Informe en 5 minutos con IA que cita la Res SRT con número y vigencia. Vos firmás el resultado.',
  },
  {
    pain: 'Llevás empleados, EPP y vencimientos en Excels separados que no se hablan entre sí.',
    gain: 'Todo centralizado en un panel: cada empleado con su histórico EPP, exámenes médicos y capacitaciones.',
  },
  {
    pain: 'Recordás los vencimientos de protocolos anuales y entregas EPP 6m de memoria.',
    gain: 'Calendario que te avisa por el canal que elijas (email, Telegram o push) con la antelación que vos definís.',
  },
  {
    pain: 'Buscás resoluciones SRT en Infoleg y armás citas a mano cada vez.',
    gain: 'IA con Res 85/12 (ruido) y normas relacionadas ya cargadas — cita con número exacto y disclaimer de vigencia.',
  },
  {
    pain: 'Cobrás $200.000 a $500.000 ARS por un solo protocolo de ruido bien hecho.',
    gain: 'ARS 30.000/mes te cuesta entre 6% y 15% de UN protocolo. El resto de tu cartera entra al margen.',
  },
];

const FAQ_ITEMS: readonly FAQItem[] = [
  {
    q: '¿Puedo cambiar de plan o cancelar cuando quiera?',
    a: 'Sí. Hoy ofrecemos un plan único, así que no hay tiers que comparar. Si querés cancelar lo hacés desde tu cuenta con 1 click — no se renueva al ciclo siguiente y mantenés acceso hasta el fin del período pago.',
  },
  {
    q: '¿Cómo funciona el descuento del 15% pagando anual?',
    a: 'Al activar la suscripción elegís facturación anual y MP cobra los 12 meses adelantados con el 15% de descuento aplicado. Equivale a pagar ARS 25.500/mes en lugar de 30.000. Si cancelás antes del año, MP te reembolsa los meses no consumidos.',
  },
  {
    q: '¿El precio incluye IVA?',
    a: 'El precio publicado es lo que cobra Mercado Pago en tu tarjeta o débito. La factura electrónica te llega por mail con el desglose impositivo correspondiente — emitimos factura A si nos pasás CUIT con responsabilidad inscripta, factura B en otro caso.',
  },
  {
    q: '¿Qué tipo de factura emiten?',
    a: 'Emitimos factura A para responsables inscriptos (con CUIT) y factura B para monotributistas y consumidores finales. La elección se hace al activar la suscripción y podés cambiarla más adelante desde tu perfil. Llega por email automáticamente cada mes.',
  },
  {
    q: '¿Qué métodos de pago aceptan?',
    a: 'Cobramos por Mercado Pago, así que aceptamos tarjeta de crédito (Visa, Mastercard, Amex, Naranja), tarjeta de débito y dinero en cuenta MP. No tenemos transferencia bancaria directa en MVP.',
  },
  {
    q: '¿Qué pasa si la inflación sube y el precio queda desfasado?',
    a: 'Ajustamos el precio cuando hay drift inflacionario significativo, no por reglas automáticas. Si bumpeamos avisamos por mail con 30 días de anticipación. Los suscriptos anuales mantienen el precio del momento de activación hasta el próximo ciclo de renovación.',
  },
  {
    q: '¿Qué pasa con mis datos si cancelo?',
    a: `Tenés 30 días de acceso completo post-cancelación para exportar informes, PDFs de EPP, listados de empleados y log de calendario en formatos abiertos. Pasado ese plazo eliminamos los datos personales según la Ley 25.326 de Protección de Datos Personales. El trial de ${TRIAL_DAYS} días opera con la misma lógica si decidís no activar.`,
  },
];

export default function PreciosPage() {
  const priceCentavos = Number(env.ARS_PRICE_MONTHLY);

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
        {/* ── Hero pricing ───────────────────────────────────────────────── */}
        <div className="relative overflow-hidden">
          <div
            className="from-primary/8 via-primary/3 pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b to-transparent"
            aria-hidden="true"
          />
          <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                Pricing pensado para higienistas freelance argentinos
              </h1>
              <p className="text-foreground/80 mx-auto mt-6 max-w-2xl text-lg sm:text-xl">
                Sin trucos ni cláusulas escondidas. {TRIAL_DAYS} días gratis con todas las
                funciones, sin tarjeta de crédito.
              </p>
            </div>
            <div className="mt-12">
              <PricingCard variant="full" priceCentavos={priceCentavos} />
            </div>
          </section>
        </div>

        {/* ── Lo que cambia en tu día a día ──────────────────────────────── */}
        <section className="border-t bg-muted/20 px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Lo que cambia en tu día a día
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Si hoy trabajás con Excel, planillas en papel y tu propia agenda, esto es lo que pasa
              cuando entra ConsultoraDemo.
            </p>
          </div>
          <div className="mt-12">
            <PainGainTable variant="precios" rows={PAIN_GAIN_ROWS} />
          </div>
        </section>

        {/* ── FAQ pricing ────────────────────────────────────────────────── */}
        <section className="border-t px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Preguntas sobre los planes
            </h2>
            <p className="text-muted-foreground mt-4 text-base">
              Si tu duda no está acá, mandanos un mensaje por WhatsApp y la respondemos.
            </p>
          </div>
          <div className="mt-10">
            <FAQAccordion items={FAQ_ITEMS} />
          </div>
        </section>

        {/* ── CTA final ──────────────────────────────────────────────────── */}
        <div className="border-t">
          <CTASection
            heading={`Probalo ${TRIAL_DAYS} días sin tarjeta`}
            subheading={`Si en ${TRIAL_DAYS} días no te ahorrás varias horas de trabajo, no pagás nada. Simple.`}
          />
        </div>
      </main>

      <LandingFooter />
      <WhatsAppFloat />
    </>
  );
}
