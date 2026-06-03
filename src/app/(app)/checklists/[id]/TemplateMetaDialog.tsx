'use client';

import { Settings2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';

import { type TipoInspeccion } from '../schema';
import { TemplateMetaForm } from '../TemplateMetaForm';

interface Props {
  templateId: string;
  initialValues: { nombre: string; descripcion: string | null; tipo_inspeccion: TipoInspeccion };
}

export function TemplateMetaDialog({ templateId, initialValues }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Settings2 className="mr-2 size-4" aria-hidden />
          Editar datos
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Datos del template</DialogTitle>
          <DialogDescription>Nombre, tipo de inspección y descripción.</DialogDescription>
        </DialogHeader>
        <TemplateMetaForm
          mode="edit"
          templateId={templateId}
          initialValues={initialValues}
          onSaved={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
