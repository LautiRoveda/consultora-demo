# Zod v4 + React Hook Form — gotchas y patrones

## Contexto

Zod v4 cambió el modelo de inferencia: ahora un schema tiene dos tipos asociados, `z.input<T>` y `z.output<T>`, que pueden divergir cuando intervienen `coerce`, `preprocess` o `transform`. React Hook Form (vía `@hookform/resolvers/zod`) asume que ambos coinciden: si no, `useForm<T>` se degrada silenciosamente a `useForm<FieldValues>` (el tipo genérico), perdiendo todo el typechecking del submit handler y del `UseFormReturn` que se pasa entre componentes.

T-021 nos chocó con esto tres veces antes de llegar a un schema estable. T-022 va a replicar el patrón a otros 4 tipos de informe (capacitación, relevamiento, accidente, otros) y a 4+ schemas más adelante (clientes, empleados, EPP). Este doc captura los 3 gotchas y los patrones canónicos para evitarlos.

**Stack:** `@hookform/resolvers@^5.2.2` + `zod@^4.4.3` + `react-hook-form@^7.75.0`.

## Los 3 problemas que aparecieron en T-021

### 1. `z.coerce.number()` rompe `TFieldValues`

**Síntoma.** Error TS críptico sobre el tipo `Resolver`:

```
Two different types with this name exist, but they are unrelated.
Type 'Resolver<{ ... }, any, { ... }>' is not assignable to type 'Resolver<TFieldValues, ...>'.
```

`useForm<RgrlMetadata>` se degrada a `useForm<FieldValues>` y el submit handler pierde tipado.

**Causa.** `z.coerce.number()` declara `z.input` como `unknown` y `z.output` como `number`. `zodResolver` devuelve `Resolver<unknown>` que no matchea el `TFieldValues` que pasaste a `useForm<T>`.

**Solución.** `z.number()` simple. El cast de string → number lo hace el `<Input>` manualmente:

```ts
// schema.ts
cantidad_empleados: z
  .number({ message: 'Ingresá un número.' })
  .int({ message: 'Debe ser un número entero.' })
  .min(1)
  .max(50000),
```

```tsx
// Form.tsx
<FormField
  name="cantidad_empleados"
  render={({ field }) => (
    <Input
      type="number"
      name={field.name}
      ref={field.ref}
      value={Number.isFinite(field.value) ? field.value : ''}
      onBlur={field.onBlur}
      onChange={(e) => {
        const raw = e.target.value;
        // String vacío → NaN (Zod number() rechaza con message clara).
        field.onChange(raw === '' ? Number.NaN : Number(raw));
      }}
    />
  )}
/>
```

Ver [`src/shared/templates/rgrl/schema.ts:211`](../../src/shared/templates/rgrl/schema.ts#L211) + [`RgrlMetadataForm.tsx:299-313`](../../src/shared/templates/rgrl/RgrlMetadataForm.tsx#L299-L313).

### 2. `z.preprocess()` rompe `TFieldValues`

**Síntoma.** Idéntico al anterior; degrade silencioso a `FieldValues`.

**Causa.** `z.preprocess((v) => normalize(v), z.string().optional())` declara `z.input` como `unknown` por diseño (el preprocessor "preprocesa cualquier cosa"). RHF requiere `z.input<T> === z.output<T>` para que `zodResolver` infiera el `Resolver<T>` correcto.

**Solución.** Para opcionales que aceptan `''` desde RHF inputs controlados, usar `.refine + .optional`:

```ts
// schema.ts
codigo_ciiu: z
  .string()
  .trim()
  .refine((v) => v === '' || CIIU_REGEX.test(v), {
    message: 'CIIU: 4 a 6 dígitos (sin punto).',
  })
  .optional(),
```

Si necesitás convertir `''` → `undefined` antes de persistir (jsonb más limpio, comparaciones DB más simples), hacelo en un helper aparte que corra post-validate — **nunca con `transform` en el schema**.

Ver [`src/shared/templates/rgrl/schema.ts:196-202`](../../src/shared/templates/rgrl/schema.ts#L196-L202) + el helper `normalizeRgrlMetadata` en [`schema.ts:284-294`](../../src/shared/templates/rgrl/schema.ts#L284-L294).

### 3. `z.transform()` rompe `TFieldValues`

**Síntoma.** Idéntico.

**Causa.** `.transform(fn)` separa input type de output type — esa es exactamente su definición. Cualquier transform encadenado (incluso uno trivial tipo `.transform((v) => v.trim())`) hace que `z.input<T> !== z.output<T>` y rompe la inferencia de RHF.

**Solución.** Normalización en helpers post-validate, no en el schema. El schema valida shape + constraints; el helper se encarga de limpiar/normalizar antes de persistir o renderizar.

Ejemplo del repo: en T-021 quisimos meter `normalizeCuit` como `.transform` dentro del schema CUIT y rompió la inferencia. Lo sacamos a [`normalizeCuit` y `normalizeRgrlMetadata` en `schema.ts:273-294`](../../src/shared/templates/rgrl/schema.ts#L273-L294), y se llaman desde:
- Form `onBlur` (UX inmediata).
- Server action `pre-persist` (defensa en profundidad).

## Patrón canónico para schemas de templates

Esqueleto que sirve forward para T-022 (replicar a capacitación/relevamiento/accidente/otros):

```ts
// src/shared/templates/<tipo>/schema.ts
import { z } from 'zod';

// — Constantes para UI (objetos con label) Y para Zod (array de codes) —
export const MI_ENUM = [
  { value: 'a', label: 'Opción A' },
  { value: 'b', label: 'Opción B' },
] as const;
export type MiEnumValue = (typeof MI_ENUM)[number]['value'];
const MI_ENUM_VALUES = ['a', 'b'] as const satisfies readonly MiEnumValue[];

// — Regex compartidos —
const MI_REGEX = /^\d{4,6}$/;

// — Schema principal —
export const miMetadataSchema = z.object({
  // String obligatorio.
  campo_obligatorio: z.string().trim().min(2).max(120),

  // Enum.
  campo_enum: z.enum(MI_ENUM_VALUES, { message: 'Elegí una opción.' }),

  // Number (sin coerce — cast manual en el <Input>).
  campo_numero: z.number().int().min(1).max(100),

  // Opcional que acepta '' desde RHF.
  campo_opcional: z
    .string()
    .trim()
    .refine((v) => v === '' || MI_REGEX.test(v), { message: '...' })
    .optional(),

  // Array con bounds.
  campo_array: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
});

export type MiMetadata = z.infer<typeof miMetadataSchema>;

// — Normalizadores (NO `.transform()` en el schema) —
export function normalizeMiMetadata(m: MiMetadata): MiMetadata {
  return {
    ...m,
    campo_opcional: m.campo_opcional?.length ? m.campo_opcional : undefined,
  };
}
```

Checklist forward para T-022, cada nuevo template:

- [ ] Sin `'use server'` ni `'use client'` en el archivo `schema.ts` (importable desde ambos).
- [ ] Sin `z.coerce.*`, `z.preprocess`, `z.transform` en el schema.
- [ ] Constantes UI y constantes Zod separadas (objetos con label + array de codes).
- [ ] Normalizadores en helpers exportados aparte.
- [ ] `z.infer<typeof schema>` como única fuente de verdad para el tipo.

## Anti-patterns

- `z.coerce.number()` / `z.coerce.string()` — input type `unknown`, rompe RHF.
- `z.preprocess(fn, inner)` — idem.
- `z.transform(fn)` — separa input/output, idem.
- `z.string().min(2).optional().or(z.literal(''))` — funciona pero genera union types feos en `z.infer`. Preferir `.refine + .optional`.
- `'use server'` en el archivo de schema — Next.js convierte los exports en RSC proxies y `zodResolver` falla en runtime cuando RHF lo invoca client-side.
- Validar checksums (CUIT módulo 11, CBU, etc.) con `.refine` dentro del schema. El schema valida shape; helpers validan semántica de negocio. Mantiene mensajes de error parejos y permite reuso server-side sin acarrear lógica RHF.
- Defaults parciales en `useForm({ defaultValues: {...} })`. RHF requiere defaults completos para mantener el form controlado desde el primer render (sino warning "changing uncontrolled → controlled"). Exportar una factory `tipoMetadataDefaults(): TipoMetadata` que cubra todos los campos.

## Otros patrones útiles (descubiertos en T-021)

- **`useMediaQuery` con `useSyncExternalStore`** (NO `useState + useEffect`). El lint rule `react-hooks/set-state-in-effect` prohíbe el patrón clásico. Ver [`src/shared/lib/use-media-query.ts`](../../src/shared/lib/use-media-query.ts).
- **`sessionCache` por email en helpers integration**: cookies snapshot por user mitiga rate limit `over_request_rate_limit` del Supabase remote (30 signins/hr default) sin sacrificar cobertura por test. Ver helpers en `src/tests/e2e/helpers/` y patrón equivalente en integration.
- **Metadata al `user message`, no al `system`**: cuando inyectás contexto variable al prompt de Claude, va al user message para preservar el `cache_control: ephemeral` del system block. Ver [`generateInformeContentAction` en `src/app/(app)/informes/[id]/actions.ts`](../../src/app/(app)/informes/[id]/actions.ts) — patrón aplica forward a cualquier template con contexto.

## Referencias

- Issue [#32](https://github.com/LautiRoveda/consultora-demo/issues/32) (este follow-up).
- PR [#29](https://github.com/LautiRoveda/consultora-demo/pull/29) — T-021 Templates parametrizados (RGRL piloto); commits donde refactorizamos cada gotcha.
- Schema canónico de referencia: [`src/shared/templates/rgrl/schema.ts`](../../src/shared/templates/rgrl/schema.ts).
- [Zod v4 changelog · type inference](https://zod.dev/v4/changelog).
- [react-hook-form/resolvers · zod](https://github.com/react-hook-form/resolvers#zod).
