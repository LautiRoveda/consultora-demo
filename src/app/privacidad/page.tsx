import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de privacidad · ConsultoraDemo',
  description:
    'Política de privacidad de ConsultoraDemo conforme Ley 25.326. Versión preliminar pendiente de revisión legal.',
  // noindex hasta que pase revisión legal pre-launch comercial.
  robots: { index: false, follow: false },
};

export default function PrivacidadPage() {
  return (
    <main id="main-content">
      <article className="mx-auto max-w-3xl px-4 py-16">
        <header className="mb-10">
          <p className="text-muted-foreground text-sm">
            <Link href="/" className="hover:text-foreground">
              ← Volver a la home
            </Link>
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">Política de privacidad</h1>
          <p className="text-muted-foreground mt-2 text-sm">Última actualización: 10/05/2026</p>
        </header>

        <div className="prose prose-zinc dark:prose-invert max-w-none space-y-6 text-sm leading-7">
          <section>
            <h2 className="text-lg font-semibold">1. Marco legal</h2>
            <p>
              Esta política se rige por la{' '}
              <strong>Ley 25.326 de Protección de Datos Personales</strong> de la República
              Argentina y normativa concordante. La Agencia de Acceso a la Información Pública es la
              autoridad de aplicación.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">2. Datos que recolectamos</h2>
            <p>Para prestar el servicio recolectamos:</p>
            <ul className="ml-5 list-disc">
              <li>
                <strong>Datos de cuenta:</strong> email, nombre, matrícula profesional, CUIT (si lo
                cargás).
              </li>
              <li>
                <strong>Datos cargados por vos:</strong> clientes, establecimientos, empleados (DNI,
                CUIL, foto, firma), mediciones, informes generados.
              </li>
              <li>
                <strong>Datos técnicos:</strong> dirección IP, navegador, sistema operativo, eventos
                de uso, logs de errores.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold">3. Cómo usamos los datos</h2>
            <p>Los datos se usan exclusivamente para:</p>
            <ul className="ml-5 list-disc">
              <li>Procesar tus informes y enviar alertas de vencimiento.</li>
              <li>Mantener el funcionamiento técnico de la plataforma.</li>
              <li>Cumplir obligaciones legales (auditoría defensible, audit log).</li>
              <li>Mejorar el servicio (analytics agregado y anónimo).</li>
            </ul>
            <p>
              <strong>No vendemos datos a terceros.</strong> No usamos los datos cargados para
              entrenar modelos de IA propios o de terceros.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">4. Datos sensibles de empleados</h2>
            <p>
              DNI, CUIL, foto y firma de los empleados que cargás en la plataforma son tratados como
              datos personales sensibles. Sos responsable de obtener consentimiento explícito del
              empleado al cargar sus datos. La plataforma actúa como{' '}
              <strong>encargado de tratamiento</strong>; vos sos el{' '}
              <strong>responsable del tratamiento</strong> respecto de tus empleados.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">5. Conservación y eliminación</h2>
            <p>
              Mantenemos tus datos mientras tu cuenta esté activa. Tras una cancelación, los datos
              se conservan 30 días para que puedas descargar lo que necesites. Pasado ese plazo se
              eliminan de los sistemas productivos. Backups cifrados se conservan hasta 90 días
              adicionales por motivos de continuidad operativa.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">6. Tus derechos</h2>
            <p>
              Conforme a la Ley 25.326 tenés derecho a acceder, rectificar, actualizar o suprimir
              tus datos personales. Para ejercerlos, escribí a{' '}
              <a href="mailto:privacidad@consultorademo.com.ar" className="text-primary underline">
                privacidad@consultorademo.com.ar
              </a>
              . Te respondemos en un plazo máximo de 10 días corridos.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">7. Seguridad</h2>
            <p>
              Aplicamos medidas técnicas y organizativas razonables: cifrado en tránsito (TLS) y en
              reposo, control de acceso por rol, autenticación con cookies httpOnly, audit log
              inmutable de acciones sensibles. Aún así, ningún sistema es 100% seguro — vos sos
              responsable de mantener tus credenciales protegidas.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold">8. Cambios a esta política</h2>
            <p>
              Podemos actualizar esta política con aviso previo de 30 días por email. La versión
              vigente está siempre disponible en esta página.
            </p>
          </section>

          <footer className="border-border text-muted-foreground mt-10 border-t pt-6 text-xs">
            <p>
              <strong>Versión preliminar.</strong> Este documento es un borrador interno pendiente
              de revisión por departamento legal antes del lanzamiento comercial.
            </p>
            <p className="mt-2">
              Ver también los{' '}
              <Link href="/terminos" className="hover:text-foreground underline">
                términos y condiciones
              </Link>
              .
            </p>
          </footer>
        </div>
      </article>
    </main>
  );
}
