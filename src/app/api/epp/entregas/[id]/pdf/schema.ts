import { z } from 'zod';

/**
 * T-104 · Schemas para GET /api/epp/entregas/[id]/pdf.
 *
 * Path param: UUID strict. Query string vacío (reservado para futuras flags
 * tipo `?watermark=draft` en Ola 2).
 */
export const pdfPathParamsSchema = z.object({
  id: z.string().uuid({ message: 'ID de entrega inválido.' }),
});

export const pdfQuerySchema = z.object({}).strict();
