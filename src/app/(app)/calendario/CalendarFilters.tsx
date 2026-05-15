'use client';

import type { CalendarEventStatus, CalendarEventTipo } from './defaults';
import { Filter, X } from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/shared/ui/badge';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Label } from '@/shared/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { Separator } from '@/shared/ui/separator';

import { EVENT_STATUS_VALUES, EVENT_TIPO_VALUES } from './defaults';
import { EVENT_STATUS_LABELS, EVENT_TIPO_LABELS } from './labels';

type Props = {
  value: { tipo: CalendarEventTipo[]; status: CalendarEventStatus[] };
  onChange: (next: { tipo: CalendarEventTipo[]; status: CalendarEventStatus[] }) => void;
};

/**
 * T-029 · Filtros del calendario (tipo + status multi-select).
 *
 * Pop-over con checkbox lists. Aplica al cerrar el popover (no instant) para
 * batch los cambios — evita 5 router.replace consecutivos si el user toca 5
 * checkboxes.
 *
 * Badges dismissibles muestran filtros activos al lado del trigger para que
 * el user vea sin abrir el popover.
 */
export function CalendarFilters({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  // State local mientras el popover esta abierto, commit al cerrar.
  const [draftTipo, setDraftTipo] = useState<CalendarEventTipo[]>([...value.tipo]);
  const [draftStatus, setDraftStatus] = useState<CalendarEventStatus[]>([...value.status]);

  function toggleTipo(t: CalendarEventTipo) {
    setDraftTipo((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function toggleStatus(s: CalendarEventStatus) {
    setDraftStatus((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      // Commit al cerrar: si difieren del value, propagamos.
      const tipoChanged =
        draftTipo.length !== value.tipo.length || draftTipo.some((t) => !value.tipo.includes(t));
      const statusChanged =
        draftStatus.length !== value.status.length ||
        draftStatus.some((s) => !value.status.includes(s));
      if (tipoChanged || statusChanged) {
        onChange({ tipo: draftTipo, status: draftStatus });
      }
    } else {
      // Re-sync al abrir (por si el value externo cambio).
      setDraftTipo([...value.tipo]);
      setDraftStatus([...value.status]);
    }
    setOpen(nextOpen);
  }

  function clearAll() {
    setDraftTipo([]);
    setDraftStatus(['pending']);
    onChange({ tipo: [], status: ['pending'] });
    setOpen(false);
  }

  function removeTipoBadge(t: CalendarEventTipo) {
    onChange({ tipo: value.tipo.filter((x) => x !== t), status: value.status });
  }

  function removeStatusBadge(s: CalendarEventStatus) {
    // Si remover deja status vacio, volvemos al default ['pending'].
    const next = value.status.filter((x) => x !== s);
    onChange({ tipo: value.tipo, status: next.length > 0 ? next : ['pending'] });
  }

  const isDefaultStatus = value.status.length === 1 && value.status[0] === 'pending';
  const showStatusBadges = !isDefaultStatus;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {value.tipo.map((t) => (
        <Badge key={t} variant="secondary" className="gap-1 pr-1">
          {EVENT_TIPO_LABELS[t]}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => removeTipoBadge(t)}
            className="h-4 w-4 hover:bg-transparent"
            aria-label={`Quitar filtro tipo ${EVENT_TIPO_LABELS[t]}`}
          >
            <X className="h-3 w-3" />
          </Button>
        </Badge>
      ))}
      {showStatusBadges &&
        value.status.map((s) => (
          <Badge key={s} variant="secondary" className="gap-1 pr-1">
            {EVENT_STATUS_LABELS[s]}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeStatusBadge(s)}
              className="h-4 w-4 hover:bg-transparent"
              aria-label={`Quitar filtro estado ${EVENT_STATUS_LABELS[s]}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </Badge>
        ))}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <Filter className="mr-1.5 h-3.5 w-3.5" />
            Filtros
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72" align="end">
          <div className="space-y-3">
            <div>
              <Label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Tipo
              </Label>
              <div className="mt-2 space-y-2">
                {EVENT_TIPO_VALUES.map((t) => (
                  <div key={t} className="flex items-center gap-2">
                    <Checkbox
                      id={`tipo-${t}`}
                      checked={draftTipo.includes(t)}
                      onCheckedChange={() => toggleTipo(t)}
                    />
                    <Label htmlFor={`tipo-${t}`} className="cursor-pointer text-sm font-normal">
                      {EVENT_TIPO_LABELS[t]}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            <div>
              <Label className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Estado
              </Label>
              <div className="mt-2 space-y-2">
                {EVENT_STATUS_VALUES.map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <Checkbox
                      id={`status-${s}`}
                      checked={draftStatus.includes(s)}
                      onCheckedChange={() => toggleStatus(s)}
                    />
                    <Label htmlFor={`status-${s}`} className="cursor-pointer text-sm font-normal">
                      {EVENT_STATUS_LABELS[s]}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <Separator />
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                Limpiar filtros
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
