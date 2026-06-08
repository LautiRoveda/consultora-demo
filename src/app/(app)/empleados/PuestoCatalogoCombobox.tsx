'use client';

import { Check, Loader2, Plus, Search, X } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { createPuestoAction } from '@/app/(app)/epp/catalogo/actions';
import { Button } from '@/shared/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { Popover, PopoverAnchor, PopoverContent } from '@/shared/ui/popover';

/**
 * T-128 · Combobox del catálogo de puestos para el form de empleado.
 *
 * Patrón Popover + Input manual con filtro client-side (mismo criterio que
 * `ClienteAutocomplete`: el catálogo activo es chico (<30) y viaja como prop, no
 * vale la pena `cmdk`). Single, opcional. Incluye "Crear puesto nuevo" inline
 * (solo owners — `createPuestoAction` exige owner) que abre un Dialog aparte
 * para evitar nesting de overlays; tras crear, el puesto queda seleccionado.
 *
 * Es UI controlada: el RHF del form maneja `value` (`puesto_id` o `''`) vía
 * `onChange`. NO valida — el borde Zod vive en la action.
 */

export type PuestoOption = { id: string; nombre: string };

type Props = {
  value: string;
  onChange: (puestoId: string) => void;
  catalogo: PuestoOption[];
  canCrear: boolean;
  disabled?: boolean;
};

function mergeById(base: PuestoOption[], extra: PuestoOption[]): PuestoOption[] {
  const seen = new Set(base.map((p) => p.id));
  return [...base, ...extra.filter((p) => !seen.has(p.id))];
}

export function PuestoCatalogoCombobox({ value, onChange, catalogo, canCrear, disabled }: Props) {
  // Puestos creados inline en esta sesión — se mergean con el catálogo de props
  // (que se refresca recién en la próxima navegación / router.refresh).
  const [created, setCreated] = useState<PuestoOption[]>([]);
  const allPuestos = useMemo(() => mergeById(catalogo, created), [catalogo, created]);

  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);

  const selected = value ? allPuestos.find((p) => p.id === value) : undefined;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allPuestos;
    return allPuestos.filter((p) => p.nombre.toLowerCase().includes(q));
  }, [allPuestos, query]);

  function handleSelect(puesto: PuestoOption) {
    onChange(puesto.id);
    setSearching(false);
    setQuery('');
    setOpen(false);
  }

  function handleClear() {
    onChange('');
    setSearching(false);
    setQuery('');
    setOpen(false);
  }

  function handleCreated(puesto: PuestoOption) {
    setCreated((prev) => mergeById(prev, [puesto]));
    onChange(puesto.id);
    setSearching(false);
    setQuery('');
    setCreateOpen(false);
  }

  // --- Estado: puesto seleccionado ----------------------------------------
  if (selected && !searching) {
    return (
      <div className="bg-muted/40 flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Check className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="truncate text-sm font-medium">{selected.nombre}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setSearching(true);
              setOpen(true);
            }}
          >
            Cambiar
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={handleClear}
            aria-label="Quitar puesto"
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  // --- Estado: búsqueda (sin selección o cambiando) -----------------------
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Buscar puesto del catálogo…"
              disabled={disabled}
              className="pl-9"
              aria-label="Buscar puesto"
              aria-autocomplete="list"
              aria-expanded={open}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {filtered.length > 0 ? (
            <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
              {filtered.map((puesto) => (
                <li key={puesto.id} role="option" aria-selected={puesto.id === value}>
                  <button
                    type="button"
                    onClick={() => handleSelect(puesto)}
                    className="hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent w-full px-4 py-2 text-left text-sm focus-visible:outline-none"
                  >
                    {puesto.nombre}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-muted-foreground px-4 py-3 text-sm">
              {allPuestos.length === 0
                ? 'No hay puestos en el catálogo todavía.'
                : 'Sin resultados para tu búsqueda.'}
            </div>
          )}
          {canCrear && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setCreateOpen(true);
                }}
                className="hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm focus-visible:outline-none"
              >
                <Plus className="size-4" aria-hidden />
                Crear puesto nuevo
                {query.trim() && <span className="text-muted-foreground">«{query.trim()}»</span>}
              </button>
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Montado solo cuando abre → su useState toma el `query` actual como
          nombre inicial sin necesitar effects (Radix no dispara onOpenChange en
          cambios programáticos del prop `open`). */}
      {canCrear && createOpen && (
        <CrearPuestoDialog
          nombreInicial={query.trim()}
          onClose={() => setCreateOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </>
  );
}

// ============================ Crear inline =================================

function CrearPuestoDialog({
  nombreInicial,
  onClose,
  onCreated,
}: {
  nombreInicial: string;
  onClose: () => void;
  onCreated: (puesto: PuestoOption) => void;
}) {
  const [isPending, startTransition] = useTransition();
  // El componente se monta recién al abrir → el nombre arranca con lo que el
  // user venía buscando en el combobox, sin effects.
  const [nombre, setNombre] = useState(nombreInicial);
  const [riesgos, setRiesgos] = useState('');
  const [errors, setErrors] = useState<{ nombre?: string; riesgos?: string }>({});

  function handleOpenChange(next: boolean) {
    if (isPending) return;
    if (!next) onClose();
  }

  function handleSubmit() {
    setErrors({});
    const nombreTrim = nombre.trim();
    if (nombreTrim.length < 2) {
      setErrors({ nombre: 'Mínimo 2 caracteres.' });
      return;
    }
    // Riesgos: input separado por comas → array de tags (drop vacíos).
    const riesgosArr = riesgos
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    startTransition(async () => {
      const result = await createPuestoAction({
        nombre: nombreTrim,
        ...(riesgosArr.length > 0 ? { riesgos_asociados: riesgosArr } : {}),
      });

      if (result.ok) {
        toast.success('Puesto creado');
        onCreated({ id: result.id, nombre: nombreTrim });
        return;
      }

      switch (result.code) {
        case 'INVALID_INPUT':
          setErrors({
            nombre: result.fieldErrors.nombre?.[0],
            // los tags vienen keyados como `riesgos_asociados.N` — mostramos el primero.
            riesgos: Object.entries(result.fieldErrors).find(([k]) =>
              k.startsWith('riesgos_asociados'),
            )?.[1]?.[0],
          });
          toast.error('Revisá los campos', { description: result.message });
          return;
        case 'DUPLICATE_NAME':
          setErrors({ nombre: result.fieldErrors.nombre[0] });
          return;
        case 'FORBIDDEN_NOT_OWNER':
          toast.error('Solo el dueño de la consultora puede crear puestos', {
            description: result.message,
          });
          onClose();
          return;
        default:
          toast.error('No se pudo crear el puesto', { description: result.message });
      }
    });
  }

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear puesto</DialogTitle>
          <DialogDescription>
            Se agrega al catálogo de tu consultora y queda seleccionado para este empleado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="nuevo-puesto-nombre">Nombre del puesto *</Label>
            <Input
              id="nuevo-puesto-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Operario de máquinas"
              disabled={isPending}
              autoFocus
            />
            {errors.nombre && <p className="text-destructive text-sm">{errors.nombre}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nuevo-puesto-riesgos">Riesgos asociados</Label>
            <Input
              id="nuevo-puesto-riesgos"
              value={riesgos}
              onChange={(e) => setRiesgos(e.target.value)}
              placeholder="ruido, caída de altura, químico"
              disabled={isPending}
            />
            <p className="text-muted-foreground text-sm">
              Separá los riesgos con comas. Mejoran la sugerencia de EPP (opcional).
            </p>
            {errors.riesgos && <p className="text-destructive text-sm">{errors.riesgos}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
                Creando…
              </>
            ) : (
              'Crear y seleccionar'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
