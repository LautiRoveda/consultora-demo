# Política de seguridad

## Reportar una vulnerabilidad

Si encontrás una vulnerabilidad de seguridad en ConsultoraDemo, **reportala en privado** — no abras un issue público ni un PR que la exponga.

Canales (en orden de preferencia):

1. **GitHub Security Advisories** — pestaña _Security_ → _Report a vulnerability_ (privado, recomendado).
2. **Email** — `lautaroeroveda@gmail.com` con asunto `[security] ...`.

Incluí, si podés: descripción del problema, pasos para reproducir, impacto estimado y versión/commit afectado. Respondemos con un acuse _best-effort_ y coordinamos la divulgación una vez que haya un fix disponible.

## Alcance

- La aplicación (`src/`) y su superficie expuesta (Server Actions, Route Handlers, autenticación, RLS multi-tenant).
- El pipeline de CI/CD (`.github/workflows/`) y la imagen de runtime (`Dockerfile`).

Fuera de alcance: el contenido de los documentos que genera la plataforma (el matriculado revisa y firma cada informe; ver el disclaimer en `CLAUDE.md`).

## Versiones soportadas

Solo se da soporte de seguridad a la rama `main` (lo que corre en producción). No hay releases versionadas con soporte retroactivo.
