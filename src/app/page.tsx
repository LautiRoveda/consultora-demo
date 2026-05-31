import type { FAQItem } from '@/shared/landing/FAQAccordion';
import type { PainGainRow } from '@/shared/landing/PainGainTable';
import type { TimelineStep } from '@/shared/landing/Timeline';
import type { LucideIcon } from 'lucide-react';
import {
  BanknoteIcon,
  BellRingIcon,
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  HardHatIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';

import { env } from '@/env';
import { CTASection } from '@/shared/landing/CTASection';
import { FAQAccordion } from '@/shared/landing/FAQAccordion';
import { LandingFooter } from '@/shared/landing/LandingFooter';
import { LandingHeader } from '@/shared/landing/LandingHeader';
import { PainGainTable } from '@/shared/landing/PainGainTable';
import { PillarCard } from '@/shared/landing/PillarCard';
import { PricingCard } from '@/shared/landing/PricingCard';
import { Timeline } from '@/shared/landing/Timeline';
import { WhatsAppFloat } from '@/shared/landing/WhatsAppFloat';
import { TRIAL_DAYS } from '@/shared/lib/trial-days';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';

/**
 * T-108 · Landing principal `/` (rewrite CP4).
 *
 * Server Component (○ Static prerendered). Reescritura completa post-T-107
 * con las 12 secciones del briefing comercial:
 *
 *   1. Hero + dual CTA + trust bar
 *   2. Sin/Con (PainGainTable variant=landing, 6 filas)
 *   3. 5 Pilares (PillarCard x5)
 *   4. Documentos reales (3 cards con preview PDF/PNG)
 *   5. Cómo es la semana (Timeline variant=semana, lun-jue)
 *   6. Tu primer día (Timeline variant=onboarding con tiempos) + CTA inline
 *   7. ¿Esto es para vos? (2 perfiles ICP + banner Team Fase 2)
 *   8. Resoluciones SRT cubiertas (grid 10)
 *   9. Transparencia (3 cards: beta + workflow real + Ley 25.326)
 *  10. Pricing teaser (PricingCard variant=mini → /precios)
 *  11. FAQ producto (FAQAccordion 9 preguntas HyS, distinto al FAQ pricing)
 *  12. CTA final anti-objection (CTASection con trust microcopy)
 *
 * Reuso 100% de componentes shared del CP1-CP3 (Header/Footer/Float +
 * Pricing/PainGain/Pillar/Timeline/FAQ/CTA). Assets cards documentos: paths
 * placeholder de CP3 — `TODO(T-108-CP5-assets)` para listar usos.
 */

const HERO_TRUST = [
  'Hecho en Argentina',
  `${TRIAL_DAYS} días sin tarjeta`,
  'IA que cita la Res SRT con número',
  'Cancelás en 1 click',
] as const;

const SINCON_ROWS: readonly PainGainRow[] = [
  {
    pain: 'Pasás 2 a 4 horas por informe técnico en Word + Excel cada vez.',
    gain: 'Generás un draft en 5 minutos con IA que cita la Res SRT con número. Vos editás y firmás.',
  },
  {
    pain: 'Recordás los vencimientos de memoria; cuando se te pasa uno, comés multa SRT y al cliente le quedás mal.',
    gain: 'Calendario te avisa por email, Telegram o push con la antelación que vos definís.',
  },
  {
    pain: 'Buscás resoluciones SRT en Infoleg y armás citas a mano cada vez que arrancás un informe.',
    gain: 'IA cita con número exacto + disclaimer de vigencia + link al SRT al pie del documento.',
  },
  {
    pain: 'Planillas EPP Res 299/11 en papel, archivadas en biblioratos por cliente que no querés perder.',
    gain: 'PDF firmado digital, archivado por empleado y accesible desde la app.',
  },
  {
    pain: 'Si llega una inspección SRT, juntás Excel y mails del último año a las apuradas.',
    gain: 'Cada cambio queda registrado con fecha y autor. Listo si te toca una auditoría SRT.',
  },
  {
    pain: 'Las alternativas suelen pedir demo agendada con un comercial antes de mostrar el precio.',
    gain: 'Plan único ARS 30.000/mes público, sin demo agendada. Te suscribís cuando querés.',
  },
];

interface Pillar {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
}

const PILLARS: readonly Pillar[] = [
  {
    icon: SparklesIcon,
    eyebrow: '01',
    title: 'IA que cita la normativa',
    body: 'Las normas SRT con número, vigencia y link oficial están cargadas. La IA cita desde ahí — sin inventar resoluciones.',
  },
  {
    icon: BellRingIcon,
    eyebrow: '02',
    title: 'Cero multas por olvido',
    body: 'Protocolos anuales, entregas de EPP cada 6 meses, calibraciones, capacitaciones y exámenes médicos al calendario. Te avisamos antes por email, Telegram o push.',
  },
  {
    icon: HardHatIcon,
    eyebrow: '03',
    title: 'Res 299/11 con firma',
    body: 'El empleado firma con el dedo en la pantalla. Generás la planilla 299/11 en PDF lista para presentar a la ART.',
  },
  {
    icon: ShieldCheckIcon,
    eyebrow: '04',
    title: 'Auditable desde el día uno',
    body: 'Cada cambio en tus informes y entregas queda registrado con fecha y autor. Listo si te toca una auditoría SRT o si tu cliente quiere certificar ISO 45001.',
  },
  {
    icon: BanknoteIcon,
    eyebrow: '05',
    title: 'Pricing transparente en ARS',
    body: `Un solo plan, ARS 30.000/mes con todo incluido. ${TRIAL_DAYS} días gratis sin tarjeta y cancelás cuando quieras.`,
  },
];

interface DocumentoCard {
  title: string;
  subtitle: string;
  imgSrc: string;
  imgAlt: string;
  pdfHref?: string;
}

// TODO(T-108-CP5-assets): los imgSrc y pdfHref apuntan a placeholders generados
// por scripts/dev-generate-landing-placeholders.ts. Lautaro reemplaza con
// assets reales del Cliente Demo SA pre-CP5 sin tocar este JSX.
const DOCUMENTOS: readonly DocumentoCard[] = [
  {
    title: 'Informe técnico de ruido',
    subtitle:
      'Res SRT 85/12 + Decreto 351/79 Anexo V. PDF con citas exactas, link al SRT y nota de vigencia al pie.',
    imgSrc: '/landing/demo-informe-ruido-preview.png',
    imgAlt: 'Vista previa del PDF de informe técnico de ruido',
    pdfHref: '/landing/demo-informe-ruido.pdf',
  },
  {
    title: 'Planilla EPP Res 299/11',
    subtitle:
      'El empleado firma con el dedo en la pantalla. Una hoja oficial Res 299/11, sin papel suelto en biblioratos.',
    imgSrc: '/landing/demo-planilla-epp-preview.png',
    imgAlt: 'Vista previa de planilla EPP Res SRT 299/11 firmada',
    pdfHref: '/landing/demo-planilla-epp.pdf',
  },
  {
    title: 'Informe de ergonomía',
    subtitle:
      'Análisis de puestos con criterios Res SRT 886/15. Recomendaciones priorizadas y nota de vigencia al pie.',
    imgSrc: '/landing/demo-informe-ergonomia-preview.png',
    imgAlt: 'Vista previa del PDF de informe técnico de ergonomía',
  },
];

const SEMANA_STEPS: readonly TimelineStep[] = [
  {
    badge: 'Lunes',
    title: 'Visita a planta del cliente',
    body: 'Relevás puestos, sacás fotos, anotás mediciones en papel o en el celular. Volvés a la oficina con material crudo.',
  },
  {
    badge: 'Martes',
    title: 'Cargás los datos en el panel',
    body: 'Subís las fotos, completás los datos del informe. El catálogo de empleados ya lo cargaste antes.',
  },
  {
    badge: 'Miércoles',
    title: 'IA arma el draft del informe',
    body: 'Ves el informe armándose en vivo. Editás, ajustás, firmás. PDF con tu logo y matrícula listo en minutos.',
  },
  {
    badge: 'Jueves',
    title: 'Enviás y agendás vencimientos',
    body: 'Descargás el PDF y lo enviás al cliente como prefieras. El calendario agendó el próximo control. Vos pasás al siguiente cliente.',
  },
];

const ONBOARDING_STEPS: readonly TimelineStep[] = [
  {
    badge: '30 seg',
    title: 'Creás la cuenta',
    body: `Email + contraseña. Sin tarjeta. Tu prueba de ${TRIAL_DAYS} días arranca al instante.`,
  },
  {
    badge: '2 min',
    title: 'Cargás tu primer cliente',
    body: 'Razón social, CUIT, domicilio. El panel del cliente queda armado y disponible para todos los informes.',
  },
  {
    badge: '5 min',
    title: 'Cargás 3 empleados con sus puestos',
    body: 'Formulario simple por empleado. El catálogo de puestos se reúsa después en informes y entregas EPP.',
  },
  {
    badge: '10 min',
    title: 'Generás tu primer informe técnico',
    body: 'Elegís el tipo (ruido, RGRL, ergonomía...), completás los datos, la IA arma el borrador. Editás y exportás el PDF para firmar.',
  },
];

interface PerfilICP {
  title: string;
  body: string;
  bullets: readonly string[];
}

const PERFILES: readonly PerfilICP[] = [
  {
    title: 'Higienista freelance con 1 a 10 clientes',
    body: 'Trabajás solo o en una consultora chica. Hacés informes técnicos, capacitaciones y asesoramiento HyS para PyMEs e industrias. Querés ahorrar tiempo en papelería para visitar más clientes y cobrar más mediciones.',
    bullets: [
      'Cartera de clientes manejable que cabe en tu cabeza pero ya no en Excel.',
      'Necesitás producir más informes sin perder calidad técnica ni horas tuyas.',
    ],
  },
  {
    title: 'Matriculado que firma sus propios informes',
    body: 'Tenés matrícula vigente y firmás cada documento que entregás. Necesitás cumplir SRT al pie de la letra y tener trazabilidad si alguna vez te toca una inspección o un reclamo.',
    bullets: [
      'Querés un registro con fecha y hora real de cada cambio que respalde tu firma profesional.',
      'Citas SRT con número y vigencia verificada en fuente primaria del SRT.',
    ],
  },
];

const SRT_RESOLUCIONES = [
  'Res SRT 85/12 — Protocolo de ruido',
  'Res SRT 84/12 — Protocolo de iluminación',
  'Res SRT 886/15 — Protocolo de ergonomía',
  'Res SRT 295/03 — Carga térmica',
  'Res SRT 905/15 — Servicios de HyS',
  'Res SRT 299/11 — Entrega de EPP firmada',
  'Res SRT 463/09 — RGRL anual',
  'Decreto 351/79 — HyS marco general',
  'Decreto 911/96 — HyS construcción',
  'Ley 19.587 — HyS marco normativo',
] as const;

interface TransparenciaCard {
  eyebrow: string;
  title: string;
  body: string;
}

const TRANSPARENCIA: readonly TransparenciaCard[] = [
  {
    eyebrow: 'Beta · 2026',
    title: 'Producto en evolución activa',
    body: 'Plataforma en beta abierta. Releases continuas con feedback de los higienistas freelance que ya están usando ConsultoraDemo. Tu opinión incide en el roadmap.',
  },
  {
    eyebrow: 'Construido desde el oficio',
    title: 'Diseñado con higienistas argentinos',
    body: 'Cada feature responde a feedback real de consultores HyS argentinos. Roadmap construido con sus aportes.',
  },
  {
    eyebrow: 'Privacidad por defecto',
    title: 'Tus datos están bajo Ley 25.326',
    body: 'Tus datos están alojados en Sudamérica y bajo la Ley 25.326 argentina. Cada consultora ve solo sus propios datos. Si cancelás, los conservamos según lo que indica la ley.',
  },
];

const FAQ_PRODUCT: readonly FAQItem[] = [
  {
    q: '¿ConsultoraDemo reemplaza mi firma profesional?',
    a: 'No. Vos sos el matriculado y firmás cada informe técnico. ConsultoraDemo te ayuda a producirlo más rápido y con menos errores, pero la responsabilidad civil y penal sigue siendo tuya y solo tuya.',
  },
  {
    q: '¿Funciona desde el celular cuando estoy en la planta?',
    a: 'Sí, la app es responsive y andá desde cualquier navegador moderno. La PWA offline con kit de jornada (uso sin señal en obra) está en Fase 3 del roadmap.',
  },
  {
    q: '¿Cuál es la diferencia con usar ChatGPT genérico para los informes?',
    a: 'ConsultoraDemo tiene las normas SRT cargadas con número y vigencia. La IA cita desde ahí, sin inventar resoluciones. Además sumás calendario que avisa por email/Telegram/push, registro de cada cambio para auditorías, EPP con firma del empleado en pantalla y tu logo en los PDFs.',
  },
  {
    q: '¿Puedo importar mi base de empleados desde Excel?',
    a: 'Hoy es carga manual por empleado. Importación CSV de empleados y clientes está priorizada en el roadmap próximo. Si te bloquea para arrancar, escribinos por WhatsApp y vemos.',
  },
  {
    q: '¿Qué pasa si la IA inventa una cita normativa?',
    a: 'La IA solo cita normas que están cargadas con número y vigencia verificada. Si todavía no cargamos la del agente que estás relevando, deja la cita genérica para que vos la completes. Siempre va una nota al pie con la fecha de verificación.',
  },
  {
    q: '¿Cómo funcionan las notificaciones multi-canal?',
    a: 'En cada evento del calendario elegís cómo te avisamos: email, Telegram o notificación del navegador. Decidís con cuántos días de anticipación querés el aviso. Y podés silenciar un canal sin perder los otros.',
  },
  {
    q: '¿Quién más ve mis datos?',
    a: 'Nadie de otras consultoras. Cada cuenta ve solo sus propios datos por separación a nivel de base de datos. El equipo de ConsultoraDemo accede solo para tareas de soporte y operación. No compartimos ni vendemos datos a terceros.',
  },
  {
    q: '¿Hay backup automático de mis datos?',
    a: 'Sí. Hacemos backups diarios automáticos de la base con retención de 7 días. Los archivos (logos, firmas, adjuntos) los respaldamos cada mes. Si pasa algo crítico, restauramos desde el último backup disponible y te avisamos cuánto puede tardar.',
  },
  {
    q: '¿Puedo personalizar los PDFs con mi logo y número de matrícula?',
    a: 'Sí. Subís logo PNG o JPG en Settings → Consultora. Los PDFs llevan tu logo en el header, datos del matriculado y número de matrícula configurable al pie. Sin marca ConsultoraDemo en los outputs.',
  },
];

export default function HomePage() {
  const priceCentavos = Number(env.ARS_PRICE_MONTHLY);

  return (
    <>
      {/* Skip-link a11y — visible solo al focus por teclado (NO al tap mobile). */}
      <a
        href="#main-content"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-3 focus-visible:py-2 focus-visible:text-primary-foreground focus-visible:shadow-lg"
      >
        Saltar al contenido principal
      </a>

      <LandingHeader />

      <main id="main-content" className="flex-1">
        {/* ── 1 · Hero ───────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden">
          <div
            className="from-primary/8 via-primary/3 pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b to-transparent"
            aria-hidden="true"
          />
          <section className="mx-auto max-w-5xl px-4 py-16 sm:py-24">
            <div className="mx-auto max-w-3xl text-center">
              <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
                La IA argentina que escribe tus informes técnicos y avisa antes de cada vencimiento
                normativo.
              </h1>
              <p className="text-foreground/80 mx-auto mt-6 max-w-2xl text-lg sm:text-xl">
                Para higienistas freelance que atienden 1 a 10 clientes y están cansados de Excel,
                planillas en papel y multas por descuido.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" className="shadow-md transition-shadow hover:shadow-lg">
                  <Link href="/signup">Empezar {TRIAL_DAYS} días gratis</Link>
                </Button>
                <Button asChild size="lg" variant="ghost">
                  <Link href="/features#video">Ver demo 30 seg →</Link>
                </Button>
              </div>
              <ul className="text-muted-foreground mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-x-6 gap-y-2 text-sm sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-5">
                {HERO_TRUST.map((item) => (
                  <li key={item} className="flex items-center gap-1.5">
                    <CheckIcon className="text-severity-ok size-4 shrink-0" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>

        {/* ── 2 · Sin/Con ────────────────────────────────────────────────── */}
        <section
          aria-labelledby="sincon-title"
          className="bg-muted/20 border-t px-4 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="sincon-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              El día a día del higienista freelance
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Lo que cambia cuando reemplazás Excel + planillas en papel + tu agenda mental por un
              sistema diseñado para HyS argentino.
            </p>
          </div>
          <div className="mt-12">
            <PainGainTable variant="landing" rows={SINCON_ROWS} />
          </div>
        </section>

        {/* ── 3 · 5 Pilares ──────────────────────────────────────────────── */}
        <section aria-labelledby="pilares-title" className="border-t px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="pilares-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Cinco diferenciadores para HyS argentino
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              No es una suite EHS multinacional traducida al castellano. Cinco cosas concretas
              resueltas con la profundidad que el rubro AR necesita.
            </p>
          </div>
          <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {PILLARS.map((p) => (
              <PillarCard
                key={p.title}
                icon={p.icon}
                eyebrow={p.eyebrow}
                title={p.title}
                body={p.body}
              />
            ))}
          </div>
        </section>

        {/* ── 4 · Documentos reales ──────────────────────────────────────── */}
        <section
          aria-labelledby="documentos-title"
          className="bg-muted/20 border-t px-4 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="documentos-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Documentos reales, no capturas trucadas
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Mirá ejemplos de los PDFs que la app genera. Todos con tu logo, tu firma de
              matriculado y citas SRT al día.
            </p>
          </div>
          <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-3">
            {DOCUMENTOS.map((doc) => (
              <Card key={doc.title} className="overflow-hidden">
                {/*
                  TODO(T-108-CP5-assets): imgSrc + pdfHref apuntan a placeholders.
                  Lautaro los reemplaza con assets reales pre-CP5 sin tocar JSX.
                */}
                <Image
                  src={doc.imgSrc}
                  alt={doc.imgAlt}
                  width={1200}
                  height={630}
                  sizes="(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw"
                  className="bg-muted/30 h-auto w-full border-b"
                />
                <CardContent className="pt-5">
                  <h3 className="text-base font-semibold leading-snug">{doc.title}</h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {doc.subtitle}
                  </p>
                  {doc.pdfHref ? (
                    <a
                      href={doc.pdfHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary mt-3 inline-flex items-center gap-1 text-sm font-medium hover:underline"
                    >
                      Ver PDF de ejemplo
                      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                    </a>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── 5 · Cómo es la semana ──────────────────────────────────────── */}
        <section aria-labelledby="semana-title" className="border-t px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="semana-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Cómo se ve tu semana con ConsultoraDemo
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Un higienista freelance promedio hace 2 a 4 visitas a planta por semana. Así entra el
              trabajo a la app sin desbordarte.
            </p>
          </div>
          <div className="mt-12">
            <Timeline variant="semana" steps={SEMANA_STEPS} />
          </div>
        </section>

        {/* ── 6 · Tu primer día ──────────────────────────────────────────── */}
        <section
          aria-labelledby="onboarding-title"
          className="bg-muted/20 border-t px-4 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="onboarding-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Tu primer día, paso a paso
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Sin onboarding asistido ni demo de 1 hora con un comercial. En 20 minutos podés tener
              tu primer informe en PDF listo para revisar.
            </p>
          </div>
          <div className="mt-12">
            <Timeline variant="onboarding" steps={ONBOARDING_STEPS} />
          </div>
          <div className="mt-12 flex justify-center">
            <Button asChild size="lg" className="shadow-md transition-shadow hover:shadow-lg">
              <Link href="/signup">Empezar {TRIAL_DAYS} días gratis</Link>
            </Button>
          </div>
        </section>

        {/* ── 7 · ¿Esto es para vos? ─────────────────────────────────────── */}
        <section aria-labelledby="icp-title" className="border-t px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="icp-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              ¿Esto es para vos?
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Diseñado pensando en dos perfiles concretos. Si te identificás con alguno, esto te va
              a ahorrar tiempo desde la primera semana.
            </p>
          </div>
          <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2">
            {PERFILES.map((p) => (
              <Card key={p.title} className="border-primary/30 h-full">
                <CardContent className="pt-6">
                  <h3 className="text-lg font-semibold leading-snug">{p.title}</h3>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{p.body}</p>
                  <ul className="mt-4 space-y-2">
                    {p.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2 text-sm">
                        <CheckIcon
                          className="text-severity-ok mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="leading-relaxed">{b}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mx-auto mt-10 max-w-3xl rounded-lg border-2 border-dashed bg-card/40 p-5 text-center">
            <p className="text-foreground text-sm">
              <span className="font-semibold">
                ¿Equipo de 3+ consultores compartiendo clientes?
              </span>{' '}
              <span className="text-muted-foreground">
                Plan Team con permisos por rol y dashboard llega en Fase 2. Escribinos por WhatsApp
                si querés acceder al beta.
              </span>
            </p>
          </div>
        </section>

        {/* ── 8 · Resoluciones SRT cubiertas ─────────────────────────────── */}
        <section aria-labelledby="srt-title" className="bg-muted/20 border-t px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="srt-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Normativa argentina cubierta
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Resoluciones SRT, decretos reglamentarios y leyes marco. Cuando la SRT actualiza una
              norma, la incorporamos textual desde la fuente oficial.
            </p>
          </div>
          <ul className="mx-auto mt-10 grid max-w-3xl gap-x-6 gap-y-3 sm:grid-cols-2">
            {SRT_RESOLUCIONES.map((r) => (
              <li key={r} className="flex items-start gap-2 text-sm">
                <CheckIcon className="text-severity-ok mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span className="leading-relaxed">{r}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* ── 9 · Transparencia ──────────────────────────────────────────── */}
        <section aria-labelledby="transparencia-title" className="border-t px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2
              id="transparencia-title"
              className="text-3xl font-semibold tracking-tight sm:text-4xl"
            >
              Transparencia primero
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Tres cosas que preferimos decir antes de que te las preguntes.
            </p>
          </div>
          <div className="mx-auto mt-12 grid max-w-5xl gap-4 md:grid-cols-3">
            {TRANSPARENCIA.map((t) => (
              <Card key={t.title} className="h-full">
                <CardContent className="pt-6">
                  <p className="text-primary text-xs font-semibold uppercase tracking-wide">
                    {t.eyebrow}
                  </p>
                  <h3 className="mt-2 text-base font-semibold leading-snug">{t.title}</h3>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{t.body}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* ── 10 · Pricing teaser ────────────────────────────────────────── */}
        <section
          aria-labelledby="pricing-title"
          className="bg-muted/20 border-t px-4 py-16 sm:py-20"
        >
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="pricing-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Plan único, pricing en ARS
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base sm:text-lg">
              Un solo plan, sin sorpresas ni columnas para comparar. Cubre todo lo que hace
              ConsultoraDemo, con {TRIAL_DAYS} días gratis sin tarjeta.
            </p>
          </div>
          <div className="mt-12">
            <PricingCard variant="mini" priceCentavos={priceCentavos} />
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/precios"
              className="text-primary inline-flex items-center gap-1 text-sm font-medium hover:underline"
            >
              Ver el detalle completo del plan
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </section>

        {/* ── 11 · FAQ producto ──────────────────────────────────────────── */}
        <section aria-labelledby="faq-title" className="border-t px-4 py-16 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 id="faq-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Preguntas sobre el producto
            </h2>
            <p className="text-muted-foreground mx-auto mt-4 max-w-2xl text-base">
              Las dudas sobre pricing están en{' '}
              <Link href="/precios" className="text-primary underline underline-offset-2">
                /precios
              </Link>
              . Acá están las del producto.
            </p>
          </div>
          <div className="mt-10">
            <FAQAccordion items={FAQ_PRODUCT} />
          </div>
        </section>

        {/* ── 12 · CTA final anti-objection ──────────────────────────────── */}
        <div className="border-t">
          <CTASection
            heading={`Probalo ${TRIAL_DAYS} días sin tarjeta`}
            subheading="Sin demo agendada con vendedor. Creás la cuenta, cargás tu primer cliente y generás tu primer informe en menos de 30 minutos."
            primaryLabel="Crear cuenta gratis"
          />
          <ul className="text-muted-foreground mx-auto -mt-8 mb-16 flex max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 text-sm sm:mb-20">
            <li className="flex items-center gap-1.5">
              <CheckIcon className="text-severity-ok size-4 shrink-0" aria-hidden="true" />
              Sin tarjeta de crédito
            </li>
            <li className="flex items-center gap-1.5">
              <CheckIcon className="text-severity-ok size-4 shrink-0" aria-hidden="true" />
              Cancelás en 1 click
            </li>
            <li className="flex items-center gap-1.5">
              <CheckIcon className="text-severity-ok size-4 shrink-0" aria-hidden="true" />
              Cada cambio queda registrado
            </li>
            <li className="flex items-center gap-1.5">
              <CheckIcon className="text-severity-ok size-4 shrink-0" aria-hidden="true" />
              Hecho en Argentina
            </li>
          </ul>
        </div>
      </main>

      <LandingFooter />
      <WhatsAppFloat />
    </>
  );
}
