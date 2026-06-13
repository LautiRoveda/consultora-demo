import type { AgenteTipo } from './schema';

/**
 * T-143 · Catálogo default de agentes de riesgo (Dto 658/96).
 *
 * FUENTE: Res. SRT 81/2019 — Anexo III "Listado de Códigos de Agentes de Riesgo"
 * (ESOP), reglamentario del Dto 658/96 y sus modificatorios
 * (IF-2019-87699049-APN-GP#SRT). Los `codigo` son los códigos ESOP reales que
 * usa la DJ del RAR; `nombre`/`cas` se transcriben del Anexo III.
 *
 * MAPEO de tipo: el Anexo III clasifica en QUIMICOS (4xxxx), BIOLOGICOS (6xxxx),
 * "TERMOHIGROMETRICOS Y OTROS" (8xxxx) y FISICOS (9xxxx). Lo proyectamos sobre la
 * taxonomía clásica de HyS de 4 tipos (`agente_riesgo_tipo`): el grupo 8xxxx se
 * reparte entre `fisico` (calor, presión) y `ergonomico` (posiciones forzadas,
 * carga lumbosacra). `enfermedad_asociada` es ORIENTATIVA (proviene del Listado
 * de Enfermedades del Dto 658/96 Anexo I, no del Anexo III de códigos).
 *
 * Set inicial CURADO por los sectores target (D03: industria + comercio +
 * servicios + construcción) — extensible por el consultor. El owner valida la
 * fidelidad legal contra el 658/96 antes del smoke productivo; el test-meta de
 * enum-sync solo valida consistencia interna (tipo ∈ enum), no fidelidad legal.
 */
export type AgenteDefault = {
  codigo: string;
  nombre: string;
  agente_tipo: AgenteTipo;
  cas?: string;
  enfermedad_asociada?: string;
};

export const AGENTES_658_DEFAULT: ReadonlyArray<AgenteDefault> = [
  // --- Físicos (Anexo III 9xxxx + 8xxxx térmicos/presión) ---
  {
    codigo: '90001',
    nombre: 'Ruido',
    agente_tipo: 'fisico',
    enfermedad_asociada: 'Hipoacusia perceptiva',
  },
  {
    codigo: '90007',
    nombre: 'Vibraciones transmitidas a la extremidad superior por maquinarias y herramientas',
    agente_tipo: 'fisico',
    enfermedad_asociada: 'Síndrome mano-brazo (vibración)',
  },
  { codigo: '90008', nombre: 'Vibraciones de cuerpo entero', agente_tipo: 'fisico' },
  {
    codigo: '90004',
    nombre: 'Radiación ultravioleta (UVA, UVB y UVC)',
    agente_tipo: 'fisico',
    enfermedad_asociada: 'Queratoconjuntivitis / lesiones cutáneas',
  },
  { codigo: '90002', nombre: 'Radiaciones ionizantes', agente_tipo: 'fisico' },
  { codigo: '90006', nombre: 'Iluminación insuficiente', agente_tipo: 'fisico' },
  {
    codigo: '80001',
    nombre: 'Calor',
    agente_tipo: 'fisico',
    enfermedad_asociada: 'Estrés térmico / golpe de calor',
  },
  {
    codigo: '80002',
    nombre: 'Presión superior a la presión atmosférica estándar',
    agente_tipo: 'fisico',
    enfermedad_asociada: 'Enfermedad por descompresión',
  },

  // --- Químicos (Anexo III 4xxxx) ---
  {
    codigo: '40153',
    nombre: 'Polvo de sílice cristalina (cuarzo o cristobalita)',
    agente_tipo: 'quimico',
    cas: '14808-60-7',
    enfermedad_asociada: 'Silicosis',
  },
  {
    codigo: '40146',
    nombre: 'Plomo (compuestos inorgánicos)',
    agente_tipo: 'quimico',
    enfermedad_asociada: 'Saturnismo',
  },
  {
    codigo: '40128',
    nombre: 'Monóxido de carbono',
    agente_tipo: 'quimico',
    cas: '630-08-0',
    enfermedad_asociada: 'Intoxicación por monóxido de carbono',
  },
  {
    codigo: '40036',
    nombre: 'Benceno',
    agente_tipo: 'quimico',
    cas: '71-43-2',
    enfermedad_asociada: 'Leucemia / aplasia medular',
  },
  { codigo: '40061', nombre: 'Cromo y sus compuestos', agente_tipo: 'quimico' },
  {
    codigo: '40115',
    nombre: 'Manganeso (humos de soldadura)',
    agente_tipo: 'quimico',
    cas: '7439-96-5',
    enfermedad_asociada: 'Manganismo',
  },
  {
    codigo: '40031',
    nombre: 'Asbestos (todas sus formas)',
    agente_tipo: 'quimico',
    cas: '1332-21-4',
    enfermedad_asociada: 'Asbestosis / mesotelioma',
  },
  { codigo: '40049', nombre: 'Cemento', agente_tipo: 'quimico', cas: '65997-15-1' },
  { codigo: '40108', nombre: 'Insecticidas organofosforados', agente_tipo: 'quimico' },
  {
    codigo: '40192',
    nombre: 'Harinas',
    agente_tipo: 'quimico',
    enfermedad_asociada: 'Asma ocupacional (asma del panadero)',
  },

  // --- Biológicos (Anexo III 6xxxx) ---
  {
    codigo: '60005',
    nombre: 'Mycobacterium tuberculosis',
    agente_tipo: 'biologico',
    enfermedad_asociada: 'Tuberculosis',
  },
  {
    codigo: '60021',
    nombre: 'Virus de la Hepatitis B (infección crónica)',
    agente_tipo: 'biologico',
    enfermedad_asociada: 'Hepatitis B',
  },

  // --- Ergonómicos (Anexo III 8xxxx, subgrupo ergonómico) ---
  {
    codigo: '80004',
    nombre: 'Posiciones forzadas y gestos repetitivos — extremidad superior',
    agente_tipo: 'ergonomico',
    enfermedad_asociada: 'Trastornos musculoesqueléticos de miembro superior',
  },
  {
    codigo: '80011',
    nombre: 'Carga, posiciones forzadas y gestos repetitivos de la columna lumbosacra',
    agente_tipo: 'ergonomico',
    enfermedad_asociada: 'Lumbalgia / hernia discal lumbosacra',
  },
] as const;
