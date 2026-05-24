import { z } from 'zod';

export const assignPuestoSchema = z.object({
  empleado_id: z.string().uuid({ message: 'empleado_id inválido.' }),
  puesto_id: z.string().uuid({ message: 'puesto_id inválido.' }),
});

export const removePuestoSchema = assignPuestoSchema;

export type AssignPuestoInput = z.infer<typeof assignPuestoSchema>;
export type RemovePuestoInput = z.infer<typeof removePuestoSchema>;
