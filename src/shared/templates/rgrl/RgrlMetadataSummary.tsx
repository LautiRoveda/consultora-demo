'use client';

import type { RgrlMetadata } from './schema';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Button } from '@/shared/ui/button';
import { Card, CardContent } from '@/shared/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';
import { Separator } from '@/shared/ui/separator';

import { PersonalizacionSummary } from '../common/PersonalizacionSummary';
import {
  distribucionTurnoLabel,
  modalidadOperativaLabel,
  provinciaName,
  servicioHysModalidadLabel,
} from './schema';

/**
 * T-021 · Resumen del metadata RGRL para read view (`/informes/[id]`).
 *
 * Renderiza arriba del MarkdownPreview. Estructura en 2 partes:
 *  - SIEMPRE visible: razón social, CUIT, domicilio (1 linea), empleados,
 *    fecha, areas (lista corta hasta 3 + "+N más" si excede).
 *  - Collapsible "Ver datos completos": el resto de fields (provincia,
 *    localidad, actividad, CIIU, distribución turnos, modalidad,
 *    ART, servicio HyS, áreas completas, riesgos pre-detectados).
 *
 * Responsive default open behavior:
 *  - Desktop (>=md): collapsible abierto por default. Espacio horizontal
 *    sobra y la info aporta context al markdown sin obstruir.
 *  - Mobile: collapsible cerrado por default. Evita scroll hasta el markdown.
 *
 * Es client component porque el Collapsible + el hook useMediaQuery requieren
 * estado en el navegador. El server component padre (page.tsx) fetcha la
 * metadata via getInformeMetadata y la pasa como prop.
 */

type Props = {
  metadata: RgrlMetadata;
};

export function RgrlMetadataSummary({ metadata: m }: Props) {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState<boolean | undefined>(undefined);

  // SSR-safe: undefined hasta que el hook estabiliza → cae al defaultOpen
  // computado server-side (mobile-first false). Despues del primer effect,
  // el state lo gobierna y el responsive default es isDesktop.
  const effectiveOpen = open ?? isDesktop;

  const areasShown = m.areas_relevadas.slice(0, 3);
  const areasMore = m.areas_relevadas.length - areasShown.length;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Collapsible open={effectiveOpen} onOpenChange={setOpen}>
          {/* ===========================================
                CABECERA + RESUMEN COMPACTO (siempre visible)
              =========================================== */}
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                <h2 className="text-base font-semibold tracking-tight">Datos del relevamiento</h2>
                <StatusBadge metadata={m} />
              </div>

              <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Item label="Razón social" value={m.razon_social} />
                <Item label="CUIT" value={m.cuit} />
                <Item label="Domicilio" value={`${m.domicilio}, ${m.localidad}`} />
                <Item label="Empleados" value={m.cantidad_empleados.toLocaleString('es-AR')} />
                <Item label="Fecha relevamiento" value={formatFecha(m.fecha_relevamiento)} />
                <Item
                  label="Áreas relevadas"
                  value={
                    areasMore > 0
                      ? `${areasShown.join(', ')} +${areasMore} más`
                      : areasShown.join(', ')
                  }
                />
              </dl>
            </div>

            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                aria-label={effectiveOpen ? 'Ocultar datos completos' : 'Ver datos completos'}
              >
                <ChevronDown
                  className={`size-4 transition-transform ${effectiveOpen ? 'rotate-180' : ''}`}
                />
              </Button>
            </CollapsibleTrigger>
          </div>

          {/* ===========================================
                DETALLE COMPLETO (colapsable)
              =========================================== */}
          <CollapsibleContent className="space-y-3 pt-4">
            <Separator />

            <div className="grid grid-cols-1 gap-x-6 gap-y-1 pt-3 text-sm sm:grid-cols-2">
              <Item label="Provincia" value={`${provinciaName(m.provincia)} (${m.provincia})`} />
              <Item label="Actividad principal" value={m.actividad_principal} />
              {m.codigo_ciiu && <Item label="Código CIIU" value={m.codigo_ciiu} />}
              <Item
                label="Distribución de turnos"
                value={distribucionTurnoLabel(m.distribucion_turno)}
              />
              <Item
                label="Modalidad operativa"
                value={modalidadOperativaLabel(m.modalidad_operativa)}
              />
              <Item label="ART contratada" value={m.art_contratada} />
              <Item
                label="Servicio HyS"
                value={servicioHysModalidadLabel(m.servicio_hys_modalidad)}
              />
            </div>

            {m.areas_relevadas.length > areasShown.length && (
              <div className="pt-2 text-sm">
                <dt className="text-muted-foreground">Áreas relevadas (completas):</dt>
                <dd className="mt-1">
                  <ul className="ml-4 list-disc space-y-0.5">
                    {m.areas_relevadas.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}

            {m.riesgos_pre_detectados && (
              <div className="pt-2 text-sm">
                <dt className="text-muted-foreground">Riesgos pre-detectados:</dt>
                <dd className="mt-1 whitespace-pre-wrap">{m.riesgos_pre_detectados}</dd>
              </div>
            )}

            <PersonalizacionSummary
              campos={m.campos_personalizados}
              instrucciones={m.instrucciones_adicionales}
            />
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function StatusBadge({ metadata: m }: { metadata: RgrlMetadata }) {
  // Todos los obligatorios estan presentes si el Zod parse pasa (lo cual ya
  // ocurrio en getInformeMetadata). El check de "completo" es contra los 2
  // opcionales: codigo_ciiu + riesgos_pre_detectados.
  const isComplete = m.codigo_ciiu !== undefined && m.riesgos_pre_detectados !== undefined;
  if (isComplete) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
        Datos completos
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
      Datos parciales
    </span>
  );
}

function formatFecha(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY (es-AR).
  const [y, mo, d] = iso.split('-');
  return `${d}/${mo}/${y}`;
}
