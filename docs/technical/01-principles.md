# Technical 01 · Principios rectores

Estos son los principios no negociables que aplican a todo el código que se escribe en este repositorio. Cuando hay duda entre dos formas de hacer algo, gana la que respeta más principios. Si una decisión los viola, tiene que estar justificada por escrito en un ADR.

## P1 · Modularidad estricta

El sistema está dividido en módulos de negocio (Auth, Tenancy, Auditoría, Notificaciones, Calendario, Informes, EPP, Checklists, Catálogo de Tareas, Accidentabilidad, Permisos, Documentos, Capacitaciones, Pagos). Cada módulo:

- Vive en su carpeta `src/modules/<nombre>/`.
- Expone una **API pública** explícita en `index.ts`. Lo que no se exporta desde ahí, no existe afuera del módulo.
- Conoce a otros módulos solo por su API pública, nunca por archivos internos.
- Tiene su propio `README.md` que explica qué hace, qué expone y qué consume.
- Sus tablas en la base llevan un prefijo opcional o un namespace claro.

Un módulo se reemplaza completo sin tocar los demás. Si esto no es cierto, hay deuda de modularidad y se abre un ticket para corregirla.

## P2 · Seguridad por defecto

- **Auth verificada en cada Server Action.** Una `page.tsx` autenticada NO autentica las acciones que define. Cada `'use server'` empieza con `getUser()` y rechaza si no hay sesión.
- **Validación Zod en cada borde.** Cualquier input que llega del exterior (formulario, query string, webhook, IA) pasa por un schema antes de tocar lógica.
- **Row Level Security activo en todas las tablas.** No hay tabla sin RLS. Las pruebas verifican que un usuario de consultora A no puede leer datos de B.
- **Secrets solo en variables de entorno cifradas.** Service role key, API keys, tokens de bot — nada hardcoded, nada en repo, nada accesible desde el cliente.
- **Audit log para acciones sensibles.** Firmar informe, eliminar empleado, cambiar plan, conectar Telegram quedan registrados en una tabla append-only.

## P3 · Type safety end-to-end

- TypeScript en modo `strict: true`. El uso de `any` requiere comentario explicando por qué.
- Tipos de la base de datos generados automáticamente desde el schema Supabase. Si una columna cambia, los tipos cambian, los lugares que la usan rompen en compilación.
- Schemas Zod para inputs y outputs externos. Los tipos derivan de los schemas con `z.infer`.
- Los componentes React reciben props tipadas. Las Server Actions devuelven tipos explícitos, no `any`.

## P4 · Tests obligatorios para lógica de dominio

- Cobertura > 70% en código de dominio (cálculos de fechas, generadores, validaciones, lógica de negocio).
- Cobertura no es objetivo en código de UI. Tests de UI solo para flujos críticos.
- Tests obligatorios para:
  - Cada generador de informe
  - Cálculo de fechas de vencimiento de EPP
  - Detección de doble entrega
  - Validación de RLS (usuarios cruzados no se ven)
  - Auth y refresh de sesión
- Pirámide: 70% unit, 20% integration, 10% E2E. Si los E2E pesan más, hay olor a test.

## P5 · CI/CD desde el primer commit

- Cada PR debe pasar typecheck + lint + tests + build en GitHub Actions antes de mergear.
- Branch `main` protegida. No hay push directo.
- Deploy automático a Vercel desde cada merge a `main`. Sin "subo a mano".
- Migraciones SQL versionadas en `supabase/migrations/` y aplicadas automáticamente por CI a la DB de staging antes de producción.

## P6 · Observabilidad como ciudadano de primera clase

- Todo error en producción se captura en Sentry con stack trace y contexto.
- Logs estructurados (JSON) con `request_id`, `user_id`, `consultora_id` en cada línea.
- Métricas custom para acciones de negocio (informe generado, EPP entregado, alerta enviada).
- Alertas automáticas en Sentry para tasas de error anómalas.
- Las decisiones se toman con dashboards, no con `console.log`.

## P7 · Documentación viva

- Cada módulo tiene un `README.md` actualizado con cada cambio relevante.
- Las decisiones de arquitectura se registran como ADR en `docs/adr/`.
- El `CLAUDE.md` raíz se mantiene sincronizado con la realidad del repo.
- Cuando el código cambia y la doc no, la PR no se mergea.

## P8 · Performance y accesibilidad como hard requirements

- Lighthouse > 90 en performance, accessibility y SEO en cada deploy a producción.
- Bundle size monitoreado (`next build` muestra cada chunk).
- WCAG AA mínimo: contraste de colores, navegación por teclado, screen readers.
- Tiempos objetivo: First Contentful Paint < 2s en mobile 4G. Generación de informe extremo a extremo < 30s p95.

## P9 · Costo bajo control

- Cada llamada a Anthropic registra `input_tokens`, `output_tokens`, `cache_read_tokens`, `model`, `consultora_id`.
- Rate limits propios por plan (Pro: N informes/día, Team: M, Enterprise: K).
- Prompt caching activo para todos los prompts sistémicos (90% off del costo de input).
- Modelo según complejidad: Haiku para simple, Sonnet para informes (default), Opus solo cuando hace falta.
- Alerta automática si una consultora supera USD 25/mes en consumo de IA.

## P10 · Simplicidad sobre cleverness

- Si una solución sencilla cubre el 95% de los casos, se elige sobre una sofisticada que cubre 100%.
- No abstraer lo que no se va a reusar.
- No agregar dependencias para problemas que se resuelven con código propio en menos de 50 líneas.
- Comentarios cuando el código no es obvio. No comentarios obvios.

## Cómo se aplica esto en revisiones

Cualquier PR que se abra debe poder responder afirmativamente a estas preguntas:

- ¿Respeta la modularidad (P1)?
- ¿Verifica auth y valida inputs (P2)?
- ¿Tiene tipos correctos sin `any` injustificado (P3)?
- ¿Tiene tests para la lógica nueva (P4)?
- ¿Pasa el CI completo (P5)?
- ¿Loguea/instrumenta lo nuevo (P6)?
- ¿Actualiza los `README.md` afectados (P7)?
- ¿No degrada Lighthouse ni accesibilidad (P8)?
- ¿Considera el costo de IA si suma llamadas (P9)?
- ¿Es la solución más simple que cumple (P10)?

Si una respuesta es "no" justificado, lo justificás en la descripción de la PR. Si es "no" sin justificar, la PR no se mergea.
