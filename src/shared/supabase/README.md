# Supabase clients

Tres clientes Supabase + helper de middleware. Cada uno cubre un escenario distinto y **no son intercambiables** — usar el incorrecto es bug de seguridad.

Referencias:

- [docs/technical/02-architecture.md](../../../docs/technical/02-architecture.md) — módulos, contratos, RLS.
- [docs/technical/00-skills-y-stack.md](../../../docs/technical/00-skills-y-stack.md) — best practices Next.js + Supabase 2026.
- [docs/adr/0002-stack-eleccion.md](../../../docs/adr/0002-stack-eleccion.md) — por qué Supabase.

## Cuándo usar cada cliente

| Cliente | Archivo | Cuándo | Auth |
|---|---|---|---|
| **Server** | [`server.ts`](server.ts) | Server Components, Server Actions, Route Handlers | JWT del usuario logueado (RLS aplica) |
| **Browser** | [`client.ts`](client.ts) | Client Components (`'use client'`) | JWT del usuario logueado (RLS aplica) |
| **Service role** | [`service-role.ts`](service-role.ts) | Jobs, cron, webhooks externos | Service role key (**bypass RLS**) |

El [`middleware.ts`](middleware.ts) se invoca desde [`src/proxy.ts`](../../proxy.ts) para refrescar la sesión en cada request — no se usa directamente desde lógica de negocio.

## Server Component / Server Action

```ts
'use server'

import { createClient } from '@/shared/supabase/server'

export async function generarInforme(input: unknown) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('UNAUTHORIZED')

  // Las queries respetan RLS: el usuario solo ve datos de su consultora.
  const { data, error } = await supabase.from('informes').select('*')
  if (error) throw error
  return data
}
```

## Client Component

```tsx
'use client'

import { useEffect } from 'react'

import { createClient } from '@/shared/supabase/client'

export function RealtimeIndicator() {
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('informes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'informes' }, (payload) => {
        console.log('Change!', payload)
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [])

  return null
}
```

`client.ts` lee `process.env.NEXT_PUBLIC_*` directo (no importa `@/env` que es server-only). Next.js inlinea esas vars en el bundle del cliente en build time.

## Service role (admin, bypass RLS)

```ts
import { createServiceRoleClient } from '@/shared/supabase/service-role'

// Solo para webhooks/jobs server-side. Tipicamente desde Route Handlers
// internos o cron tasks programadas con pg_cron.
export async function POST(request: Request) {
  const event = await verifyMercadoPagoWebhook(request)
  const supabase = createServiceRoleClient() // bypass RLS

  await supabase.from('subscriptions').update({ status: event.status }).eq('mp_subscription_id', event.id)

  return new Response('ok')
}
```

**Reglas críticas:**

- El cliente service-role **bypassea RLS**. Cualquier query accede a todas las consultoras. Auditá manualmente el alcance de cada query.
- **Nunca importar desde un Client Component.** [`service-role.ts`](service-role.ts) tiene `import 'server-only'` que rompe el build si pasa. Adicionalmente, el step "Verify service_role not in client bundle" del CI verifica el bundle final como defensa en profundidad.
- `persistSession: false` y `autoRefreshToken: false` están seteados a propósito — no queremos que el SDK guarde la sesión service-role en cookies/storage.

## Tipos generados (`types.ts`)

`pnpm db:types` regenera `types.ts` desde el schema remoto. Cada cliente está parametrizado con `<Database>` para que las queries sean tipadas (TypeScript chequea nombres de tabla, columnas, tipos de retorno).

Cuando se agrega/modifica una tabla en `supabase/migrations/`, después de `pnpm db:push` correr `pnpm db:types` y commitear el diff de `types.ts`.

## Middleware / proxy

[`middleware.ts`](middleware.ts) exporta `updateSession(request)`. El entry point [`src/proxy.ts`](../../proxy.ts) lo invoca en cada request matcheado. Refresca tokens vencidos sin forzar auth — la landing pública sigue funcionando igual sin sesión.

> El helper interno usa el nombre `middleware` por el patrón conceptual (cookie sync entre request y response). El entry point de Next.js usa `proxy.ts` (convención stable desde Next.js 16; el archivo `middleware.ts` quedó deprecado).
