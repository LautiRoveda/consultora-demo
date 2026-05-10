# ConsultoraDemo · Generador de Informes HyS con IA

Prototipo de generador de informes técnicos de Higiene y Seguridad Laboral asistido por IA, pensado para consultoras argentinas.

## Tipos de informe soportados

- **Ruido** — Resolución SRT 85/12
- **Iluminación** — Resolución SRT 84/12
- **Puesta a Tierra** — AEA 90364 / Decreto 351/79 cap. 14
- **RGRL** — Resolución SRT 463/09
- **Carga de Fuego** — Decreto 351/79 cap. 18 / IRAM 11949

## Cómo funciona

1. Elegís el tipo de informe.
2. Cargás los datos del establecimiento, instrumental, profesional y mediciones (las tablas son editables y se pueden agregar/quitar filas).
3. Editás el prompt de generación si querés ajustar tono, profundidad o criterios propios.
4. Elegís modo de generación:
   - **Demo** — usa plantillas locales con cálculos automáticos. No requiere API.
   - **IA real** — llama a la API de Anthropic (Claude) con tu propia API key.
5. El informe se renderiza en pantalla, listo para imprimir, exportar a PDF o copiar.

## Stack

Una sola página HTML autocontenida. Sin build, sin dependencias instaladas. Usa Tailwind CSS desde CDN.

## Deploy en Vercel

Como es un sitio estático, basta con apuntar Vercel al repo. No requiere configuración adicional. El archivo `vercel.json` incluido fija el caching y la rewrite a `index.html`.

## Aviso

Este prototipo es una demo. Los informes generados deben ser revisados y firmados por un profesional matriculado antes de presentarse formalmente.
