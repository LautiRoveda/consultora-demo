import { MessageCircleIcon } from 'lucide-react';
import Link from 'next/link';

import { WHATSAPP_LINK_HREF } from './whatsapp';

/**
 * T-108 · Footer compartido entre /, /precios y /features.
 *
 * Server Component. 3 columnas (Producto / Legal / Contacto) en desktop,
 * stacked en mobile. Incluye disclaimer profesional obligatorio sobre
 * responsabilidad del matriculado.
 */
export function LandingFooter() {
  return (
    <footer className="border-t">
      <div className="text-muted-foreground mx-auto max-w-5xl px-4 py-12 text-sm md:py-16">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
          <div className="md:col-span-1">
            <div className="flex items-center gap-2">
              <span className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-md text-sm font-bold">
                CD
              </span>
              <span className="text-foreground font-semibold">ConsultoraDemo</span>
            </div>
            <p className="mt-3 text-xs leading-relaxed">
              IA argentina para higienistas freelance. Informes técnicos en 5 minutos + calendario
              de vencimientos normativos.
            </p>
          </div>

          <nav aria-label="Producto" className="md:col-span-1">
            <p className="text-foreground text-xs font-semibold uppercase tracking-wide">
              Producto
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/features" className="hover:text-foreground transition-colors">
                  Features
                </Link>
              </li>
              <li>
                <Link href="/precios" className="hover:text-foreground transition-colors">
                  Precios
                </Link>
              </li>
              <li>
                <Link href="/signup" className="hover:text-foreground transition-colors">
                  Empezar 14 días gratis
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-foreground transition-colors">
                  Iniciar sesión
                </Link>
              </li>
            </ul>
          </nav>

          <nav aria-label="Legal" className="md:col-span-1">
            <p className="text-foreground text-xs font-semibold uppercase tracking-wide">Legal</p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/terminos" className="hover:text-foreground transition-colors">
                  Términos
                </Link>
              </li>
              <li>
                <Link href="/privacidad" className="hover:text-foreground transition-colors">
                  Privacidad
                </Link>
              </li>
            </ul>
          </nav>

          <div className="md:col-span-1">
            <p className="text-foreground text-xs font-semibold uppercase tracking-wide">
              Contacto
            </p>
            <ul className="mt-3 space-y-2">
              <li>
                <a
                  href={WHATSAPP_LINK_HREF}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
                >
                  <MessageCircleIcon className="size-3.5" aria-hidden="true" />
                  WhatsApp
                </a>
              </li>
            </ul>
          </div>
        </div>

        <p className="mt-10 text-xs">© 2026 ConsultoraDemo · Hecho en Argentina.</p>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed">
          ConsultoraDemo genera documentos técnicos. El profesional matriculado es responsable de
          revisar y firmar todo informe antes de presentarlo legalmente. La app no reemplaza
          criterio profesional ni absuelve responsabilidad civil ni penal.
        </p>
      </div>
    </footer>
  );
}
