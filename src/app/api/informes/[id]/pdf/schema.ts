import { z } from 'zod';

/**
 * T-023 · Schemas del endpoint `/api/informes/[id]/pdf`.
 *
 * El path param `id` se valida como UUID antes de tocar DB — un caller con
 * shape malo come 400 en lugar de un round-trip RLS.
 *
 * Query string vacio en T-023. Schema reservado como hook futuro
 * (`?watermark=draft`, `?template=oficial`, etc.).
 */

export const pdfPathParamsSchema = z.object({
  id: z.string().uuid({ message: 'ID de informe invalido.' }),
});

export const pdfQuerySchema = z.object({}).strict();
