'use client';

import type { InformeTipo } from '@/app/(app)/informes/schema';
import { Archive, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
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

import { INFORME_TIPO_LABELS, INFORME_TIPOS } from '../schema';
import { archivePlantillaAction, renamePlantillaAction } from './actions';
import { PLANTILLA_NOMBRE_MAX, plantillaNombreSchema } from './schema';

/**
 * T-139 · Gestion de "Mis plantillas": lista agrupada por tipo + renombrar +
 * archivar. Las plantillas se CREAN desde el form de personalizacion de un
 * informe ("Guardar como plantilla") — aca no hay alta: una plantilla sin
 * config de origen no tiene sentido.
 *
 * Rows como cards apiladas (patron movil T-127): el volumen por tenant es
 * chico (presets), no amerita tabla.
 */

export type PlantillaListItem = {
  id: string;
  tipo: InformeTipo;
  nombre: string;
  /** Resumen legible de la config, armado server-side ("3 campos · instrucciones"). */
  resumen: string;
};

export function PlantillasView({ plantillas }: { plantillas: PlantillaListItem[] }) {
  const router = useRouter();
  const [renameTarget, setRenameTarget] = useState<PlantillaListItem | null>(null);
  const [nombre, setNombre] = useState('');
  const [nombreError, setNombreError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<PlantillaListItem | null>(null);
  const [isPending, setIsPending] = useState(false);

  function openRename(p: PlantillaListItem) {
    setRenameTarget(p);
    setNombre(p.nombre);
    setNombreError(null);
  }

  async function handleRename() {
    if (!renameTarget) return;
    const parsed = plantillaNombreSchema.safeParse(nombre);
    if (!parsed.success) {
      setNombreError(parsed.error.issues[0]?.message ?? 'Nombre inválido.');
      return;
    }
    setIsPending(true);
    const result = await renamePlantillaAction({ id: renameTarget.id, nombre: parsed.data });
    setIsPending(false);

    if (result.ok) {
      toast.success('Plantilla renombrada');
      setRenameTarget(null);
      router.refresh();
      return;
    }
    if (result.code === 'INVALID_INPUT' && result.fieldErrors.nombre) {
      setNombreError(result.fieldErrors.nombre[0] ?? 'Nombre inválido.');
      return;
    }
    toast.error('No se pudo renombrar', { description: result.message });
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    setIsPending(true);
    const result = await archivePlantillaAction(archiveTarget.id);
    setIsPending(false);
    setArchiveTarget(null);

    if (result.ok) {
      toast.success('Plantilla archivada', {
        description: 'Los informes que ya la aplicaron no cambian.',
      });
      router.refresh();
      return;
    }
    toast.error('No se pudo archivar', { description: result.message });
  }

  if (plantillas.length === 0) {
    return (
      <Card>
        <CardContent className="text-muted-foreground space-y-2 pt-6 text-sm">
          <p>Todavía no guardaste plantillas.</p>
          <p>
            Se crean desde el formulario de un informe: personalizá campos, instrucciones o
            estructura y tocá «Guardar como plantilla».{' '}
            <Link href="/informes/nuevo" className="text-foreground underline underline-offset-4">
              Crear un informe
            </Link>
          </p>
        </CardContent>
      </Card>
    );
  }

  // Orden canonico de INFORME_TIPOS, no alfabetico del label.
  const grupos = INFORME_TIPOS.map((tipo) => ({
    tipo,
    items: plantillas.filter((p) => p.tipo === tipo),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {grupos.map(({ tipo, items }) => (
        <section key={tipo} className="space-y-2">
          <h2 className="text-muted-foreground text-sm font-medium tracking-tight uppercase">
            {INFORME_TIPO_LABELS[tipo]}
          </h2>
          <div className="space-y-2">
            {items.map((p) => (
              <Card key={p.id}>
                <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{p.nombre}</p>
                    <p className="text-muted-foreground text-sm">{p.resumen}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openRename(p)}
                      disabled={isPending}
                    >
                      <Pencil className="mr-2 size-4" aria-hidden />
                      Renombrar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setArchiveTarget(p)}
                      disabled={isPending}
                    >
                      <Archive className="mr-2 size-4" aria-hidden />
                      Archivar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}

      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renombrar plantilla</DialogTitle>
            <DialogDescription>El nombre es único por tipo entre las activas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-nombre">Nombre</Label>
            <Input
              id="rename-nombre"
              value={nombre}
              maxLength={PLANTILLA_NOMBRE_MAX}
              onChange={(e) => {
                setNombre(e.target.value);
                setNombreError(null);
              }}
              disabled={isPending}
            />
            {nombreError && <p className="text-destructive text-sm">{nombreError}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleRename()} disabled={isPending}>
              {isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Archivar «{archiveTarget?.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de aparecer en «Aplicar plantilla». Los informes que ya la aplicaron conservan su
              configuración (la plantilla se copia al aplicar, no se referencia).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleArchive()} disabled={isPending}>
              Archivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
