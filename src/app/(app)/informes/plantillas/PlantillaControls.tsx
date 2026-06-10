'use client';

import type { InformeTipo } from '@/app/(app)/informes/schema';
import type {
  DegradePlantillaResult,
  PlantillaConfig,
} from '@/shared/templates/registry/plantilla-config';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { BookmarkPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { defaultSeccionesConfig } from '@/shared/templates/common/secciones';
import {
  degradePlantillaConfig,
  isPlantillaConfigVacia,
  normalizePlantillaConfig,
  PLANTILLA_CONFIG_SCHEMA_BY_TIPO,
  PLANTILLA_SECCION_IDS_BY_TIPO,
} from '@/shared/templates/registry/plantilla-config';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select';

import { createPlantillaAction } from './actions';
import { PLANTILLA_NOMBRE_MAX, plantillaNombreSchema } from './schema';

/**
 * T-139 · Controles de plantillas montados sobre el form de metadata (wizard
 * de alta + editor). A NIVEL PAGINA, no dentro de los 5 MetadataForm: la firma
 * `{form, disabled}` del registry cliente queda intacta y las plantillas
 * llegan fetcheadas server-side por la page.
 *
 * - "Aplicar": snapshot-on-apply — COPIA la config al form (degradada si la
 *   plantilla quedo vieja); se persiste por el flujo normal del informe.
 * - "Guardar como plantilla": toma el slice de personalizacion del form
 *   actual (nunca los datos del cliente) y lo persiste via action.
 */

/** Subset client-safe de la row (la page no manda consultora_id/created_by). */
export type PlantillaClientItem = {
  id: string;
  tipo: InformeTipo;
  nombre: string;
  config: unknown;
};

/**
 * Aplica la config (degradada si hace falta) a los campos de personalizacion
 * del form. Keys ausentes vuelven al default RHF — aplicar una plantilla "sin
 * secciones" resetea la estructura al catalogo canonico, no deja la previa.
 *
 * Exportada pura para test: la interaccion con el Select de Radix no suma
 * cobertura del comportamiento que importa (que el form quede bien populado).
 */
export function aplicarPlantillaAlForm(
  tipo: InformeTipo,
  configRaw: unknown,
  form: UseFormReturn<FieldValues>,
): DegradePlantillaResult {
  const result = degradePlantillaConfig(tipo, configRaw);
  if (!result.ok) return result;

  const opts = { shouldDirty: true, shouldValidate: true } as const;
  form.setValue('campos_personalizados', result.config.campos_personalizados ?? [], opts);
  form.setValue('instrucciones_adicionales', result.config.instrucciones_adicionales ?? '', opts);
  const ids = PLANTILLA_SECCION_IDS_BY_TIPO[tipo];
  if (ids) {
    form.setValue('secciones', result.config.secciones ?? defaultSeccionesConfig(ids), opts);
  }
  return result;
}

export function PlantillaControls({
  tipo,
  form,
  plantillas,
  disabled,
}: {
  tipo: InformeTipo;
  form: UseFormReturn<FieldValues>;
  /** Plantillas activas DEL TIPO (la page filtra antes de pasar). */
  plantillas: PlantillaClientItem[];
  disabled?: boolean;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [nombre, setNombre] = useState('');
  const [nombreError, setNombreError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // Controlado para volver al placeholder post-apply (re-aplicar la misma
  // plantilla debe re-disparar onValueChange).
  const [selectValue, setSelectValue] = useState('');

  function handleAplicar(plantillaId: string) {
    setSelectValue('');
    const plantilla = plantillas.find((p) => p.id === plantillaId);
    if (!plantilla) return;

    const result = aplicarPlantillaAlForm(tipo, plantilla.config, form);
    if (!result.ok) {
      toast.error('Plantilla incompatible', {
        description:
          'Su configuración ya no es válida para este tipo de informe. Revisala desde Mis plantillas.',
      });
      return;
    }
    if (result.degradado) {
      toast.warning('Plantilla aplicada parcialmente', {
        description: 'Parte de la configuración guardada ya no existe en el catálogo y se omitió.',
      });
      return;
    }
    toast.success(`Plantilla "${plantilla.nombre}" aplicada`);
  }

  async function handleGuardar() {
    const nombreParsed = plantillaNombreSchema.safeParse(nombre);
    if (!nombreParsed.success) {
      setNombreError(nombreParsed.error.issues[0]?.message ?? 'Nombre inválido.');
      return;
    }

    // Slice de personalizacion del form actual — NUNCA los datos del cliente
    // (razon_social/cuit/etc. son por-informe). `secciones` solo si el tipo es
    // configurable y hay algo elegido (un [] transitorio no es config).
    const values = form.getValues();
    const ids = PLANTILLA_SECCION_IDS_BY_TIPO[tipo];
    const secciones = ids ? (values.secciones as unknown[] | undefined) : undefined;
    const config = {
      campos_personalizados: values.campos_personalizados as unknown,
      instrucciones_adicionales: values.instrucciones_adicionales as unknown,
      ...(secciones && secciones.length > 0 ? { secciones } : {}),
    };

    // Pre-validacion local para errores accionables (el action re-valida igual).
    const configParsed = PLANTILLA_CONFIG_SCHEMA_BY_TIPO[tipo].safeParse(config);
    if (!configParsed.success) {
      toast.error('Revisá la personalización', {
        description: 'Hay campos incompletos o inválidos en la personalización del informe.',
      });
      return;
    }
    if (
      isPlantillaConfigVacia(normalizePlantillaConfig(tipo, configParsed.data as PlantillaConfig))
    ) {
      toast.error('Plantilla vacía', {
        description: 'Personalizá algo (campos, instrucciones o secciones) antes de guardar.',
      });
      return;
    }

    setIsSaving(true);
    const result = await createPlantillaAction({ tipo, nombre: nombreParsed.data, config });
    setIsSaving(false);

    if (result.ok) {
      toast.success('Plantilla guardada', {
        description: 'La tenés disponible en "Aplicar plantilla" y en Mis plantillas.',
      });
      setDialogOpen(false);
      setNombre('');
      setNombreError(null);
      // Refetch RSC: el selector recibe la plantilla nueva desde la page.
      router.refresh();
      return;
    }

    if (result.code === 'INVALID_INPUT') {
      if (result.fieldErrors.nombre) {
        setNombreError(result.fieldErrors.nombre[0] ?? 'Nombre inválido.');
        return;
      }
      toast.error('No se pudo guardar', { description: result.message });
      return;
    }
    if (result.code === 'UNAUTHENTICATED') {
      toast.error('Sesión vencida', { description: result.message });
      router.push('/login');
      return;
    }
    toast.error('No se pudo guardar la plantilla', { description: result.message });
  }

  return (
    <div className="bg-muted/40 flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <span className="text-muted-foreground shrink-0 text-sm font-medium">Plantillas</span>
        {plantillas.length > 0 ? (
          <Select value={selectValue} onValueChange={handleAplicar} disabled={disabled}>
            <SelectTrigger className="sm:w-64" aria-label="Aplicar plantilla">
              <SelectValue placeholder="Aplicar plantilla…" />
            </SelectTrigger>
            <SelectContent>
              {plantillas.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-muted-foreground text-sm">
            Sin plantillas guardadas para este tipo.
          </span>
        )}
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setNombreError(null);
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled}>
            <BookmarkPlus className="mr-2 size-4" aria-hidden />
            Guardar como plantilla
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Guardar como plantilla</DialogTitle>
            <DialogDescription>
              Guarda la personalización actual (campos, instrucciones y estructura) para
              reutilizarla en informes nuevos. Los datos del cliente no se incluyen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="plantilla-nombre">Nombre</Label>
            <Input
              id="plantilla-nombre"
              value={nombre}
              maxLength={PLANTILLA_NOMBRE_MAX}
              onChange={(e) => {
                setNombre(e.target.value);
                setNombreError(null);
              }}
              placeholder="Ej: Mi relevamiento de ruido"
              disabled={isSaving}
            />
            {nombreError && <p className="text-destructive text-sm">{nombreError}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleGuardar()} disabled={isSaving}>
              {isSaving ? 'Guardando…' : 'Guardar plantilla'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
