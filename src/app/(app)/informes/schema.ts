import { z } from 'zod';

/**
 * T-019 · Schemas de input + constantes del modulo Informes.
 *
 * NO `'use server'` — este modulo se importa desde Client Components (RHF +
 * zodResolver). Si fuera server, Next.js convierte los exports en RSC proxies
 * y zodResolver rompe.
 *
 * Las constantes `INFORME_TIPOS` / `INFORME_STATUSES` son espejo TS de los
 * `check constraint` de `public.informes` (ver `supabase/migrations/
 * 20260511232802_informes.sql`). Mantenerlas en sync — el test
 * `informes-rls.test.ts` cubre que un tipo/status fuera de spec sea rechazado
 * por la DB.
 */

export const INFORME_TIPOS = [
  'relevamiento',
  'capacitacion',
  'rgrl',
  'accidente',
  'otros',
] as const;
export type InformeTipo = (typeof INFORME_TIPOS)[number];

export const INFORME_STATUSES = ['draft', 'published', 'archived'] as const;
export type InformeStatus = (typeof INFORME_STATUSES)[number];

export const INFORME_TIPO_LABELS: Record<InformeTipo, string> = {
  relevamiento: 'Relevamiento',
  capacitacion: 'Capacitación',
  rgrl: 'RGRL',
  accidente: 'Accidente',
  otros: 'Otros',
};

export const INFORME_STATUS_LABELS: Record<InformeStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado',
};

export const createInformeSchema = z.object({
  tipo: z.enum(INFORME_TIPOS, { message: 'Elegí un tipo de informe.' }),
  titulo: z
    .string()
    .trim()
    .min(3, { message: 'Mínimo 3 caracteres.' })
    .max(200, { message: 'Máximo 200 caracteres.' }),
  /**
   * T-021 · Metadata opcional para tipos con template estructurado.
   * Por ahora solo RGRL. El action valida el shape con `rgrlMetadataSchema`
   * cuando viene. Si la validacion falla, el informe se crea igual y el
   * user completa los datos despues en /editar (no bloqueante).
   */
  metadata: z.unknown().optional(),
});

export type CreateInformeInput = z.infer<typeof createInformeSchema>;
