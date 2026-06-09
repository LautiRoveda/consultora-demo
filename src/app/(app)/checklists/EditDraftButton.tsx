'use client';

import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';

import { editPublishedTemplateAction } from './actions';

interface Props {
  templateId: string;
  size?: 'sm' | 'default';
}

/**
 * "Editar" un template publicado → clona la última versión publicada a un nuevo
 * draft (editPublishedTemplateAction) y navega al editor. Si ya hay un draft abierto
 * (DRAFT_ALREADY_EXISTS), navega al detalle igual (que prioriza el draft).
 */
export function EditDraftButton({ templateId, size = 'default' }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleEdit() {
    startTransition(async () => {
      const result = await editPublishedTemplateAction({ templateId });

      if (result.ok) {
        toast.success('Borrador creado. Ya podés editar.');
        router.push(`/checklists/${templateId}`);
        router.refresh();
        return;
      }

      switch (result.code) {
        case 'DRAFT_ALREADY_EXISTS':
          toast.info('Ya había un borrador abierto. Te llevamos ahí.');
          router.push(`/checklists/${templateId}`);
          router.refresh();
          return;
        case 'NOT_FOUND':
          toast.error('No se encontró una versión publicada para editar');
          router.refresh();
          return;
        case 'FORBIDDEN_NOT_OWNER':
          toast.error('Permisos insuficientes', { description: result.message });
          return;
        case 'BILLING_GATED':
          toast.error('Suscripción requerida', { description: result.message });
          return;
        case 'UNAUTHENTICATED':
          toast.error('Sesión vencida', { description: result.message });
          router.push('/login');
          return;
        default:
          toast.error('Error inesperado', { description: result.message });
      }
    });
  }

  return (
    <Button onClick={handleEdit} disabled={isPending} size={size}>
      <Pencil className="mr-2 size-4" aria-hidden />
      {isPending ? 'Creando borrador…' : 'Editar'}
    </Button>
  );
}
