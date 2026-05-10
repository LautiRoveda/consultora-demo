# ConsultoraDemo

Plataforma SaaS para consultores de Higiene y Seguridad Laboral en Argentina, **potenciada por IA**, con foco en dos pilares: **generación de informes técnicos** y **calendario de vencimientos con alertas proactivas**. No es una suite EHS genérica — son dos cosas hechas mejor que la competencia.

## Si sos Claude Code o un agente IA

Leé esto en orden y vas a tener todo el contexto que necesitás:

1. **`docs/discovery/`** — el porqué del producto (negocio, mercado, personas, competencia, requerimientos).
2. **`docs/technical/`** — el cómo se construye (skills, principios, arquitectura, datos, estructura, roadmap).
3. **`docs/adr/`** — decisiones puntuales con contexto y consecuencias.

Los documentos están numerados por orden de lectura. **Ningún cambio al código se hace sin antes leer los documentos relevantes.** Si algo del código no respeta lo documentado, es deuda técnica y se abre ticket.

## TL;DR del producto

Un consultor argentino de HyS atiende entre 5 y 20 clientes (PYMEs e industrias). Su día se reparte 60-70% en papelería repetitiva (informes técnicos en Word, planillas Excel, agenda papel) y 30-40% en visitas reales. Pierde clientes por descuido (vencimientos olvidados) y se come multas por entregas de EPP fuera de plazo (Resolución SRT 299/11 obliga renovación cada 6 meses).

ConsultoraDemo resuelve dos cosas con IA:
1. **Genera el informe técnico** (ruido, iluminación, puesta a tierra, RGRL, carga de fuego) en 5 minutos en lugar de 2-4 horas.
2. **Avisa antes de cada vencimiento** (protocolo anual, EPP a 6 meses, calibraciones, capacitaciones).

Pricing: USD 30/mes plan Pro. Trial de 7 días. Sin llamar a comercial.

## Stack

- **Frontend:** Next.js 16 con App Router + React 19 + TypeScript strict + Tailwind 4 + shadcn/ui.
- **Backend:** Next.js Route Handlers y Server Actions, en Vercel serverless.
- **DB / Auth / Storage:** Supabase (Postgres con RLS multi-tenant).
- **IA:** Anthropic Claude API (Sonnet 4.6 por default — ver ADR-0003).
- **Notificaciones:** Resend (email) + Telegram Bot API + push web.
- **Pagos:** Mercado Pago.
- **Tests:** Vitest + Playwright.
- **CI/CD:** GitHub Actions + Vercel deploy automático.
- **Observabilidad:** Sentry + Vercel Analytics.

Ver `docs/technical/00-skills-y-stack.md` para detalle y justificación.

## Principios no negociables

1. **Modularidad estricta.** 14 módulos independientes, conocidos solo por su API pública.
2. **Seguridad por defecto.** Auth en cada Server Action, validación Zod en cada borde, RLS en cada tabla, secrets en variables de entorno.
3. **Type safety end-to-end.** TypeScript strict, Zod en bordes, tipos generados desde schema SQL.
4. **Tests obligatorios para lógica de dominio.** > 70% cobertura. Pirámide 70/20/10.
5. **CI/CD desde el primer commit.** Branch `main` protegida, deploy automático.
6. **Observabilidad first-class.** Sentry, logs estructurados, métricas custom.
7. **Documentación viva.** ADRs, READMEs por módulo, CLAUDE.md sincronizado.
8. **Performance y accesibilidad como hard requirements.** Lighthouse > 90, WCAG AA.
9. **Costo bajo control.** Tracking de tokens IA por consultora, prompt caching, modelo según tarea.
10. **Simplicidad sobre cleverness.** Solución más simple que cumple, siempre.

Detalle en `docs/technical/01-principles.md`.

## Estructura del repo

```
consultora-demo/
├── docs/
│   ├── discovery/        ← negocio, mercado, personas, competencia, síntesis
│   ├── technical/        ← skills, principios, arquitectura, datos, estructura, roadmap
│   └── adr/              ← decisiones puntuales registradas
├── src/
│   ├── app/              ← rutas Next.js
│   ├── modules/          ← 14 módulos de negocio
│   ├── shared/           ← código compartido (UI base, supabase, ai, observability)
│   └── tests/            ← unit, integration, e2e
├── supabase/
│   ├── migrations/       ← SQL versionado
│   └── seed.sql
├── public/
├── .github/workflows/    ← CI/CD
└── ...
```

Detalle en `docs/technical/04-folder-structure.md`.

## 14 módulos

**Capa transversal:** Auth, Tenancy, Auditoría, Notificaciones.
**Capa coordinación:** Calendario.
**Capa negocio:** Informes, EPP, Checklists, Catálogo de Tareas, Accidentabilidad, Permisos de Trabajo, Documentos, Capacitaciones, Pagos.

Cada módulo en `src/modules/<nombre>/` con `actions.ts`, `queries.ts`, `schemas.ts`, `types.ts`, `index.ts`, `README.md` y, según necesidad, `components/` y subcarpetas específicas.

Detalle en `docs/technical/02-architecture.md`.

## Modelo de datos

Todas las tablas con `consultora_id` y RLS desde el día cero. UUIDs por defecto. Soft delete con `archived_at` donde corresponde. Audit log inmutable. Tipos TypeScript generados automáticamente desde el schema.

Schema completo en `docs/technical/03-data-model.md`.

## Roadmap

**Fase 1 (6-8 semanas) — MVP cobrable.** Auth, Tenancy, Auditoría, Notificaciones, Calendario, Informes (5 tipos), EPP con tracking y planilla Res 299/11, Checklists Lite, libro de incidentes, Pagos con Plan Pro USD 30. Trial 7 días.

**Fase 2 (4 semanas) — Plan Team.** Coordinación de equipo, asignación, aprobación, branding consultora.

**Fase 3 (5 semanas) — PWA offline + obra.** Permisos diarios, kit de jornada, captura cámara/GPS, sync diferido.

**Fase 4 (6 semanas) — Inteligencia.** Repositorio documental con OCR + RAG, capacitaciones automáticas, accidentabilidad con IA, Plan Enterprise con multi-establecimiento.

**Fase 5+** — Avanzadas (chat conversacional, visión computacional, integraciones, marketplace, internacionalización).

Roadmap detallado por tickets en `docs/technical/10-roadmap.md`.

## Estado actual

- **Discovery completo** ✅ (4 documentos en `docs/discovery/`).
- **Diseño técnico completo** ✅ (5 documentos clave en `docs/technical/`).
- **ADRs iniciales** ✅ (template + ADR-0002 stack + ADR-0003 modelo Claude default + ADR-0004 branch protection diferida).
- **Prototipo Fase 0** ✅ (`index.html` estático, ya en producción Vercel).
- **Sprint 0 — setup del repo** 🔄
  - **T-001** ✅ Next.js 16 + TS strict + Tailwind 4 + shadcn/ui base.
  - **T-002** ✅ ESLint 9 (flat) + Prettier 3 + Husky 9 (commit-msg, pre-commit, pre-push).
  - **T-003** ✅ Vitest 3 (projects: unit, component) + Playwright (chromium).
  - **T-004** ✅ GitHub Actions CI (`.github/workflows/ci.yml`) + flow PR-based + hook pre-push contra push directo a `main` (branch protection server-side diferida, ver ADR-0004).
  - **T-005** ✅ Supabase CLI instalada + proyecto remoto `consultora-demo` creado y linkeado + primera migration (`<ts>_extensions.sql`) aplicada al remote (uuid-ossp, pgcrypto, vector, pg_cron). Docker Desktop **no** instalado: trabajamos contra el remote.
  - **T-006 a T-010** 🔜 cliente Supabase + Sentry + tema shadcn + landing/login + Vercel deploy.

## Cómo arrancar a construir

1. Asegurate de tener instalado Node 20+, pnpm, git, GitHub CLI, Supabase CLI y Vercel CLI.
2. Abrí Claude Code en este repo.
3. Decile: *"Leé `CLAUDE.md` y los documentos de `docs/`. Después arrancamos con el ticket T-001 del roadmap."*
4. Claude propone plan, validás, codea, hace PR.
5. Reviewás, mergéas, deploy automático.
6. Pasás al siguiente ticket.

## Glosario rápido

- **HyS:** Higiene y Seguridad Laboral.
- **EPP:** Elementos de Protección Personal.
- **SRT:** Superintendencia de Riesgos del Trabajo (regulador).
- **ART:** Aseguradora de Riesgos del Trabajo.
- **RGRL:** Relevamiento General de Riesgos Laborales (anual).
- **Res 299/11:** planilla de entrega de EPP firmada, renovación cada 6 meses.
- **Decreto 351/79 / 911/96 / 617/97:** decretos reglamentarios HyS por sector.
- **Protocolo:** informe con vigencia 12 meses, debe renovarse anualmente.

Glosario completo en `docs/discovery/06-glossary.md`.

## Decisiones tomadas en discovery (no re-discutir)

- D01 · Cliente target: el consultor profesional, no el empleador final.
- D02 · Foco geográfico inicial: AMBA + Córdoba + Santa Fe.
- D03 · Foco sectorial: industria + comercio + servicios privados + construcción.
- D04 · Pitch principal: resguardo legal — secundario: productividad.
- D05 · Versionado de normas SRT con libre elección.
- D06 · Comparación de versiones de norma con IA.
- D07 · Monitoreo normativo incluido en planes pagos, diferenciado por nivel.
- D08 · Foco del producto: generación de informes + calendario de vencimientos.
- D09 · Pricing público: Pro USD 30 / Team USD 100 / Enterprise USD 250.
- D10 · Plan Team disponible desde Fase 2.
- D11 · Plan Enterprise disponible desde Fase 4.
- D12 · Foco geográfico inicial AMBA + canales orgánicos.
- D13 · Programa de referidos activo desde el día uno.
- D14 · Métricas de validación con cláusulas de pivot a 60/90/180 días.

Lista viva en `docs/discovery/00-decisiones.md`.

## Disclaimer profesional

ConsultoraDemo es un asistente que genera documentos. **El profesional matriculado es responsable de revisar y firmar todo informe antes de presentarlo legalmente.** La app no reemplaza criterio profesional ni absuelve responsabilidad civil/penal. Esto está claro en los términos de uso y en cada informe generado.
