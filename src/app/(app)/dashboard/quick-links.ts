import {
  Bot,
  Calendar,
  ClipboardCheck,
  FileText,
  HardHat,
  ListChecks,
  ShieldAlert,
  UserCheck,
  Users,
} from 'lucide-react';

/**
 * Accesos rápidos del dashboard — una card por módulo de negocio `live`.
 *
 * Data pura (sin server stuff) para que pueda importarse desde tests sin
 * arrastrar el Server Component `DashboardView`. El guard
 * `src/tests/unit/dashboard-quick-links-coverage.test.ts` (T-127) verifica que
 * cubra todos los módulos de negocio de `NAV_ITEMS`, evitando que el dashboard
 * "se quede corto" cuando se suma un módulo nuevo al sidebar.
 */
export const QUICK_LINKS = [
  {
    href: '/informes',
    icon: FileText,
    title: 'Informes',
    description: 'Generá informes técnicos con IA.',
  },
  {
    href: '/clientes',
    icon: Users,
    title: 'Clientes',
    description: 'Gestioná tu cartera de empresas.',
  },
  {
    href: '/empleados',
    icon: UserCheck,
    title: 'Empleados',
    description: 'Empleados por cliente con tracking.',
  },
  {
    href: '/epp',
    icon: HardHat,
    title: 'EPP',
    description: 'Catálogo, entregas y padrón de EPP.',
  },
  {
    href: '/asistente',
    icon: Bot,
    title: 'Asistente',
    description: 'Consultá tus datos en lenguaje natural.',
  },
  {
    href: '/checklists',
    icon: ClipboardCheck,
    title: 'Checklists',
    description: 'Plantillas de inspección reutilizables.',
  },
  {
    href: '/checklists/ejecuciones',
    icon: ListChecks,
    title: 'Inspecciones',
    description: 'Ejecutá inspecciones en campo.',
  },
  {
    href: '/accidentabilidad',
    icon: ShieldAlert,
    title: 'Accidentabilidad',
    description: 'Incidentes y acciones correctivas.',
  },
  {
    href: '/calendario',
    icon: Calendar,
    title: 'Calendario',
    description: 'Vencimientos y alertas proactivas.',
  },
] as const;
