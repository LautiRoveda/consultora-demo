import type { InformeTipo } from '@/app/(app)/informes/schema';
import type { ComponentType } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';

import {
  accidenteMetadataDefaults,
  AccidenteMetadataForm,
} from '../accidente/AccidenteMetadataForm';
import { AccidenteMetadataSummary } from '../accidente/AccidenteMetadataSummary';
import {
  capacitacionMetadataDefaults,
  CapacitacionMetadataForm,
} from '../capacitacion/CapacitacionMetadataForm';
import { CapacitacionMetadataSummary } from '../capacitacion/CapacitacionMetadataSummary';
import { otrosMetadataDefaults, OtrosMetadataForm } from '../otros/OtrosMetadataForm';
import { OtrosMetadataSummary } from '../otros/OtrosMetadataSummary';
import {
  relevamientoMetadataDefaults,
  RelevamientoMetadataForm,
} from '../relevamiento/RelevamientoMetadataForm';
import { RelevamientoMetadataSummary } from '../relevamiento/RelevamientoMetadataSummary';
import { rgrlMetadataDefaults, RgrlMetadataForm } from '../rgrl/RgrlMetadataForm';
import { RgrlMetadataSummary } from '../rgrl/RgrlMetadataSummary';

/**
 * T-022 · Registry cliente de templates por tipo de informe.
 *
 * Provee defaults factory + FormComponent + SummaryComponent por tipo.
 * Importable desde Client Components (wizard, EditorView, page.tsx).
 *
 * Boundary clara con el registry server (`./server.ts`): este modulo arrastra
 * los Client Components al bundle; el server no.
 *
 * Type-safety:
 * Los componentes concretos (RgrlMetadataForm, etc.) estan typados a su
 * metadata especifica. Aca los almacenamos via `unknown` casts — necesario
 * porque `UseFormReturn<T>` es invariante en T y no podemos crear un
 * Record<InformeTipo, ComponentType<{ form: UseFormReturn<X> }>>` con X
 * variable.
 *
 * Garantia runtime: el consumer SIEMPRE pasa el form del tipo activo a su
 * FormComponent — el dispatch correcto se prueba por test (E2E) no por TS.
 * Discriminated union completa por tipo seria over-engineering por 5 tipos.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ClientEntry = {
  /** Factory que retorna defaults completos. RHF requiere defaults para todos los campos. */
  defaults: () => FieldValues;
  /** Form component renderizable con `<FormComponent form={uf} disabled={x} />`. */
  FormComponent: ComponentType<{ form: UseFormReturn<any>; disabled?: boolean }>;
  /** Summary component renderizable con `<SummaryComponent metadata={m} />`. */
  SummaryComponent: ComponentType<{ metadata: FieldValues }>;
};

export const TEMPLATE_CLIENT_REGISTRY: Record<InformeTipo, ClientEntry> = {
  rgrl: {
    defaults: rgrlMetadataDefaults,
    FormComponent: RgrlMetadataForm,
    SummaryComponent: RgrlMetadataSummary as unknown as ClientEntry['SummaryComponent'],
  },
  capacitacion: {
    defaults: capacitacionMetadataDefaults,
    FormComponent: CapacitacionMetadataForm,
    SummaryComponent: CapacitacionMetadataSummary as unknown as ClientEntry['SummaryComponent'],
  },
  relevamiento: {
    defaults: relevamientoMetadataDefaults,
    FormComponent: RelevamientoMetadataForm,
    SummaryComponent: RelevamientoMetadataSummary as unknown as ClientEntry['SummaryComponent'],
  },
  accidente: {
    defaults: accidenteMetadataDefaults,
    FormComponent: AccidenteMetadataForm,
    SummaryComponent: AccidenteMetadataSummary as unknown as ClientEntry['SummaryComponent'],
  },
  otros: {
    defaults: otrosMetadataDefaults,
    FormComponent: OtrosMetadataForm,
    SummaryComponent: OtrosMetadataSummary as unknown as ClientEntry['SummaryComponent'],
  },
};

/* eslint-enable @typescript-eslint/no-explicit-any */

export function getClientTemplate(tipo: InformeTipo): ClientEntry {
  return TEMPLATE_CLIENT_REGISTRY[tipo];
}
