import type { LucideIcon } from 'lucide-react';
import { Calendar, FileText, HardHat, Home, Settings, UserCheck, Users } from 'lucide-react';

/**
 * Items del sidebar autenticado. Fuente única de verdad para nav.
 *
 * `status: 'live'` → renderiza como `<Link>` clickable.
 * `status: 'soon'` → renderiza disabled + tooltip "Próximamente". El `href`
 * queda como identidad lógica (no se navega) pero permite que `usePathname()`
 * compare contra él si en el futuro habilitamos pre-render de la ruta.
 *
 * Sumar nuevos items aca y nada más — `AppSidebarNav` los itera.
 *
 * T-035: el item `/notificaciones` salio del sidebar — vive como sub-tab
 * `Notificaciones` dentro de Configuracion (`/settings/notificaciones`). El
 * item original era drift legacy T-024 placeholder y daba doble entry point
 * confuso (sidebar dummy + tab real).
 */
export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  status: 'live' | 'soon';
  /** Ticket que va a habilitar el item. Solo informativo en el tooltip. */
  ticket?: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: Home, status: 'live' },
  { href: '/informes', label: 'Informes', icon: FileText, status: 'live' },
  { href: '/clientes', label: 'Clientes', icon: Users, status: 'soon', ticket: 'T-049' },
  { href: '/empleados', label: 'Empleados', icon: UserCheck, status: 'soon', ticket: 'T-021' },
  { href: '/epp', label: 'EPP', icon: HardHat, status: 'soon', ticket: 'T-022' },
  { href: '/calendario', label: 'Calendario', icon: Calendar, status: 'live' },
  { href: '/settings/consultora', label: 'Configuración', icon: Settings, status: 'live' },
] as const;
