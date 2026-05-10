# ADR-0002 · Elección del stack técnico inicial

**Fecha:** 2026-05-09
**Estado:** Aceptada
**Decisor:** Lautaro
**Consultados:** discovery completo, búsquedas de mercado de stacks SaaS 2026, perfil de skill del decisor (principiante)

## Contexto

Elegir stack inicial para ConsultoraDemo. El proyecto requiere: multi-tenancy seguro, IA generativa, persistencia, auth, pagos, mobile-friendly, baja deuda técnica, costos bajos al inicio. El decisor es principiante en programación y va a desarrollar con Claude Code asistiéndolo.

Criterios de evaluación:
1. Comunidad y documentación amplia (especialmente en español)
2. Compatibilidad con Claude Code (predictabilidad, convenciones claras)
3. Costos $0 hasta los primeros clientes pagos
4. Type safety end-to-end
5. Multi-tenant nativo o trivial de implementar
6. Capacidad de escalar a 100-1000 usuarios sin reescribir
7. Componentes accesibles desde el día uno
8. Deploy simple

## Opciones evaluadas

### Opción A: Next.js + Supabase + Vercel (elegida)

- **Pros:**
  - Next.js es el framework React más usado, comunidad masiva, mucho tutorial en español.
  - Supabase trae Postgres + Auth + Storage en un solo paquete. RLS nativo permite multi-tenancy seguro.
  - Vercel ofrece deploy 1-click, integración GitHub, edge functions, todo gratis para arrancar.
  - Server Actions de Next.js eliminan la mayoría del código de API tradicional.
  - shadcn/ui da componentes accesibles que se copian al repo (sin lock-in).
  - Stack que Claude Code maneja perfecto.

- **Contras:**
  - Vercel free tier tiene límites en compute time (suficientes para empezar pero hay que monitorear).
  - Supabase free tier limita 500 MB DB y 1 GB storage.
  - Vendor lock-in moderado a Vercel (mitigable: puede deployarse en otro lado).

- **Costo inicial:** USD 0/mes hasta saturar tier gratis. Después USD 45/mes (Vercel Pro + Supabase Pro).

### Opción B: Next.js + Drizzle ORM + Supabase

- Igual que A pero con Drizzle como capa de ORM sobre la DB.
- **Pros:** type safety mejor para queries complejas, mejor performance en queries grandes.
- **Contras:** curva de aprendizaje extra para principiante. Documentación menor que Supabase Client. No agrega valor para queries simples (95% de nuestro caso).
- **Decisión:** descartada por complejidad innecesaria. Posible reconsideración en Fase 4 si aparecen queries complejas.

### Opción C: Next.js + Prisma + PlanetScale (MySQL)

- **Pros:** Prisma muy popular, mucho tutorial.
- **Contras:** PlanetScale eliminó tier gratis. Prisma tiene problemas conocidos de connection pooling en serverless. Sin RLS nativo, multi-tenancy se hace por código (más vulnerable). Dos servicios en lugar de uno (más complejidad).
- **Decisión:** descartada por costos y por tener que implementar multi-tenancy a mano.

### Opción D: Remix + Supabase + Fly.io

- **Pros:** Remix tiene buen DX, Fly.io permite servidor full-time barato.
- **Contras:** Remix tiene comunidad mucho menor. Fly.io requiere más conocimiento de DevOps. Para principiante con Claude Code, Next.js es más predecible.
- **Decisión:** descartada por comunidad y predecibilidad.

### Opción E: Nuxt 3 + Supabase

- **Pros:** Vue tiene curva más suave para principiantes.
- **Contras:** ecosistema React es 5x más grande, más tutoriales, más componentes, mejor con Claude Code. Reusar tipos entre frontend y backend es más maduro en Next.js.
- **Decisión:** descartada por tamaño de ecosistema.

## Decisión

**Opción A: Next.js 15 con App Router + TypeScript strict + Supabase (Postgres + Auth + Storage) + Vercel + Anthropic SDK + Resend + Telegram Bot + Mercado Pago + Vitest + Playwright + Sentry.**

Sin ORM al inicio (`@supabase/supabase-js` directo). Si en Fase 4 aparecen queries complejas, reconsiderar Drizzle.

## Consecuencias

### Positivas

- Stack moderno y maintained con masa crítica de comunidad.
- Documentación oficial extensa, mucho contenido en español.
- Multi-tenancy seguro nativo via RLS.
- Costos $0 al inicio, escala lineal con uso.
- Claude Code rinde excelente sobre este stack.
- Componentes accesibles (shadcn) desde el día uno.
- Deploy automático sin DevOps.

### Negativas

- Vendor lock-in moderado a Vercel + Supabase. Mitigable porque Next.js es el estándar y Supabase es Postgres puro (migrable a self-hosted).
- Si pegamos los límites del free tier rápido, hay un escalón de costo (USD 45/mes).
- Sin ORM, queries complejas en Fase 4 pueden ser engorrosas. Reconsiderar Drizzle entonces.

### Inciertas

- Performance en producción a escala. Hay que medir y optimizar conforme crezca.
- Costo de IA por usuario activo. Hay que monitorear con `ai_usage_log`.
- Estabilidad de Mercado Pago Subscriptions (API ha cambiado en el pasado). Plan B: usar pagos one-time recurrentes manuales si la API rompe.

## Referencias

- [docs/technical/00-skills-y-stack.md](../technical/00-skills-y-stack.md) — análisis detallado del stack.
- [docs/discovery/04-sintesis.md](../discovery/04-sintesis.md) — síntesis de requisitos de negocio.
- [Next.js Multi-Tenant Guide oficial](https://nextjs.org/docs/app/guides/multi-tenant)
- [Supabase RLS Best Practices 2026](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices)
