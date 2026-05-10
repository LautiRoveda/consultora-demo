import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Términos y condiciones · ConsultoraDemo',
  description:
    'Términos de uso del servicio ConsultoraDemo. Versión preliminar pendiente de revisión legal.',
  // noindex hasta que pase revisión legal pre-launch comercial.
  // Ver follow-up del PR de T-009.
  robots: { index: false, follow: false },
};

export default function TerminosPage() {
  return (
    <main id="main-content">
      <article className="mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10">
          <p className="text-muted-foreground text-sm">
            <Link href="/" className="hover:text-foreground">
              ← Volver a la home
            </Link>
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">Términos y condiciones</h1>
          <p className="text-muted-foreground mt-2 text-sm">Última actualización: 10/05/2026</p>
        </header>

        <div className="prose prose-zinc dark:prose-invert max-w-none space-y-6 text-sm leading-7">
          <section>
            <h2 className="text-lg font-semibold">1. Servicio</h2>
            <p>
              ConsultoraDemo es una plataforma SaaS que asiste a profesionales matriculados en
              Higiene y Seguridad Laboral en la generación de informes técnicos protocolarios y la
              gestión de vencimientos normativos exigidos por la Superintendencia de Riesgos del
              Trabajo (SRT) de la República Argentina.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">2. Uso del servicio</h2>
            <p>
              El servicio está dirigido exclusivamente a profesionales matriculados o consultoras
              que prestan servicios de Higiene y Seguridad Laboral. Al registrarte declarás contar
              con la matrícula vigente correspondiente para firmar los informes que la plataforma te
              ayuda a generar.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">3. Prueba gratuita y cancelación</h2>
            <p>
              La prueba gratuita es de 7 días corridos desde la fecha de registro y no requiere
              tarjeta de crédito. Podés cancelar tu suscripción en cualquier momento desde tu cuenta
              sin penalidad. El servicio mantiene el acceso completo durante 30 días posteriores a
              la cancelación para que descargues tu información.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">4. Responsabilidad profesional</h2>
            <p>
              <strong>ConsultoraDemo es una herramienta de asistencia.</strong> Los informes y
              documentos que la plataforma ayuda a generar deben ser revisados, validados y firmados
              por el profesional matriculado correspondiente antes de ser presentados ante
              autoridades, clientes o terceros. La plataforma no reemplaza criterio profesional ni
              absuelve responsabilidad civil, penal o administrativa derivada del ejercicio
              profesional.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">5. Propiedad intelectual</h2>
            <p>
              El contenido generado en tu cuenta (informes, registros, mediciones) es de tu
              propiedad. La plataforma se reserva los derechos sobre el código, las plantillas
              normativas, los prompts de IA y el resto de los componentes propios del servicio.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">6. Modificación de los términos</h2>
            <p>
              Podemos modificar estos términos con aviso previo de 30 días por email. El uso
              continuado del servicio después de la modificación implica aceptación de los nuevos
              términos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">7. Jurisdicción</h2>
            <p>
              Estos términos se rigen por las leyes de la República Argentina. Cualquier
              controversia se resolverá ante los tribunales ordinarios con sede en la Ciudad
              Autónoma de Buenos Aires.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">8. Contacto</h2>
            <p>
              Para consultas sobre estos términos, escribí a{' '}
              <a href="mailto:legal@consultorademo.com.ar" className="text-primary underline">
                legal@consultorademo.com.ar
              </a>
              .
            </p>
          </section>

          <footer className="border-border text-muted-foreground mt-10 border-t pt-6 text-xs">
            <p>
              <strong>Versión preliminar.</strong> Este documento es un borrador interno pendiente
              de revisión por departamento legal antes del lanzamiento comercial.
            </p>
            <p className="mt-2">
              Ver también la{' '}
              <Link href="/privacidad" className="hover:text-foreground underline">
                política de privacidad
              </Link>
              .
            </p>
          </footer>
        </div>
      </article>
    </main>
  );
}
