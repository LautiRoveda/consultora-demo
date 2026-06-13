'use client';

import { Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';

import { seedDefaultCatalogAction } from './actions';

interface Props {
  label?: string;
  variant?: 'default' | 'outline';
}

export function SeedCatalogoButton({ label = 'Sembrar catálogo', variant = 'outline' }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleSeed() {
    startTransition(async () => {
      const result = await seedDefaultCatalogAction();
      if (!result.ok) {
        switch (result.code) {
          case 'FORBIDDEN_NOT_OWNER':
            toast.error('Permisos insuficientes', { description: result.message });
            return;
          case 'UNAUTHENTICATED':
            toast.error('Sesión vencida', { description: result.message });
            router.push('/login');
            return;
          case 'NO_CONSULTORA':
            toast.error('Cuenta sin consultora', { description: result.message });
            return;
          default:
            toast.error('Error inesperado', { description: result.message });
        }
        return;
      }

      const { agentes } = result.created;
      if (agentes === 0) {
        toast.info('Tu catálogo ya tenía todos los agentes recomendados.');
      } else {
        toast.success('Catálogo sembrado', {
          description: `${agentes} agente${agentes === 1 ? '' : 's'} agregado${agentes === 1 ? '' : 's'}.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <Button variant={variant} onClick={handleSeed} disabled={isPending}>
      <Sparkles className="mr-2 h-4 w-4" aria-hidden />
      {isPending ? 'Sembrando…' : label}
    </Button>
  );
}
