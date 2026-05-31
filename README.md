# ConsultoraDemo

Plataforma SaaS para consultores de Higiene y Seguridad Laboral en Argentina, potenciada por IA. Dos pilares: generación de informes técnicos y calendario inteligente de vencimientos.

## Empezar a desarrollar

```bash
pnpm install
pnpm dev
```

App en `http://localhost:3000`. Prototipo Fase 0 (referencia visual histórica) en `http://localhost:3000/prototipo/`.

## Tests

```bash
pnpm test              # unit + component
pnpm test:integration  # integration contra un Supabase local efímero (requiere Docker)
pnpm test:e2e          # end-to-end (Playwright)
```

`pnpm test:integration` levanta un stack Supabase local (`supabase start` + `db reset`) y **nunca toca prod**. Para debug puntual contra el proyecto remoto: `pnpm test:integration:remote` (requiere `set -a && source .env.local && set +a`).

## Documentación

- [`CLAUDE.md`](./CLAUDE.md) — índice maestro y contexto para agentes IA.
- [`docs/discovery/`](./docs/discovery/) — el porqué del producto: mercado, personas, competencia, síntesis.
- [`docs/technical/`](./docs/technical/) — el cómo se construye: stack, principios, arquitectura, datos, estructura, roadmap.
- [`docs/adr/`](./docs/adr/) — Architecture Decision Records.

Ningún cambio al código se hace sin antes leer los documentos relevantes.

## Disclaimer profesional

ConsultoraDemo es un asistente que genera documentos. El profesional matriculado es responsable de revisar y firmar todo informe antes de presentarlo legalmente. La app no reemplaza criterio profesional.
