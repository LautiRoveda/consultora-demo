'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { createEjecucionAction } from '../actions';

export type TemplateOption = { id: string; nombre: string; isSystem: boolean };
export type ClienteOption = { id: string; razon_social: string };

export type NuevaInspeccionFormProps = {
  templates: TemplateOption[];
  clientes: ClienteOption[];
  /** Preselección desde el atajo "Ejecutar" del detalle de template (?template=<id>). */
  initialTemplateId?: string;
};

export function NuevaInspeccionForm({
  templates,
  clientes,
  initialTemplateId,
}: NuevaInspeccionFormProps) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState(initialTemplateId ?? '');
  const [clienteId, setClienteId] = useState('');
  const [isPending, setIsPending] = useState(false);
  const [errors, setErrors] = useState<{ template?: string; cliente?: string }>({});

  async function handleSubmit() {
    const next: { template?: string; cliente?: string } = {};
    if (!templateId) next.template = 'Elegí un template.';
    if (!clienteId) next.cliente = 'Elegí un cliente.';
    setErrors(next);
    if (next.template || next.cliente) return;

    setIsPending(true);
    const result = await createEjecucionAction({ templateId, clienteId });

    if (result.ok) {
      toast.success('Inspección iniciada', { description: 'Ya podés relevar en obra.' });
      router.push(`/checklists/ejecuciones/${result.executionId}`);
      router.refresh();
      return;
    }

    setIsPending(false);

    switch (result.code) {
      case 'INVALID_INPUT':
        setErrors({
          template: result.fieldErrors.templateId?.[0],
          cliente: result.fieldErrors.clienteId?.[0],
        });
        toast.error('Revisá los datos', { description: result.message });
        return;
      case 'VERSION_NOT_PUBLISHED':
        setErrors({ template: 'Ese template no tiene una versión publicada.' });
        toast.error('Template sin publicar', { description: result.message });
        return;
      case 'NO_CLIENTE':
        setErrors({ cliente: 'Cliente inválido.' });
        toast.error('Cliente inválido', { description: result.message });
        return;
      case 'BILLING_GATED':
        toast.error('Suscripción requerida', { description: result.message });
        return;
      case 'UNAUTHENTICATED':
        toast.error('Sesión vencida', { description: result.message });
        router.push('/login');
        return;
      case 'NO_CONSULTORA':
        toast.error('Cuenta sin consultora', { description: result.message });
        return;
      case 'FORBIDDEN_NOT_OWNER':
        toast.error('Acción reservada al titular', { description: result.message });
        return;
      case 'INTERNAL_ERROR':
        toast.error('Error inesperado', { description: result.message });
        return;
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardContent className="grid gap-5 pt-6">
        <div className="grid gap-2">
          <Label htmlFor="template-select">Template</Label>
          <Select
            value={templateId}
            onValueChange={(v) => {
              setTemplateId(v);
              setErrors((e) => ({ ...e, template: undefined }));
            }}
          >
            <SelectTrigger id="template-select" aria-invalid={errors.template ? true : undefined}>
              <SelectValue placeholder="Elegí un template publicado" />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.nombre}
                  {t.isSystem ? ' · Sistema' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.template && <p className="text-destructive text-sm">{errors.template}</p>}
        </div>

        <div className="grid gap-2">
          <Label htmlFor="cliente-select">Cliente</Label>
          <Select
            value={clienteId}
            onValueChange={(v) => {
              setClienteId(v);
              setErrors((e) => ({ ...e, cliente: undefined }));
            }}
          >
            <SelectTrigger id="cliente-select" aria-invalid={errors.cliente ? true : undefined}>
              <SelectValue placeholder="Elegí el cliente inspeccionado" />
            </SelectTrigger>
            <SelectContent>
              {clientes.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.razon_social}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.cliente && <p className="text-destructive text-sm">{errors.cliente}</p>}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void handleSubmit()} disabled={isPending}>
            {isPending ? 'Iniciando…' : 'Comenzar inspección'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
