# `src/shared/pdf/` — Generación de PDFs

Módulo introducido en T-023 (Sprint 2). Provee un wrapper sobre `puppeteer-core` para renderizar HTML imprimible a PDF A4.

## API pública

```ts
import { htmlToPdf } from '@/shared/pdf/render';
import { buildPdfFilename } from '@/shared/pdf/filename';
import { getInternalPdfRenderToken } from '@/shared/pdf/browser-pool';
```

- `htmlToPdf(html, opts)` — convierte HTML a `Buffer` PDF A4. Timeouts internos: `setContent` 10s + `page.pdf` 15s. Tira `PdfRenderTimeoutError` si alguno corta.
- `buildPdfFilename({ tipo, titulo, createdAt })` → `informe-<tipo>-<slug>-YYYY-MM-DD.pdf`.
- `getInternalPdfRenderToken()` — token efímero (32 bytes random, hex) regenerado en cada boot del proceso. El layout de `/informes/[id]/print` lo valida en el header `x-internal-pdf-render` antes de renderear; sin match → `notFound()`. Cierra el side-channel de acceso directo a la ruta print desde un browser.

## Browser pooling

Singleton lazy en `browser-pool.ts`. Una instancia de Chromium reusada entre requests; cada PDF abre/cierra su propia `Page`. Idle timeout 5 min libera RAM si nadie genera PDFs.

Flags relevantes del launch (ver comments en `browser-pool.ts` para detalle):

- `--no-sandbox` (requerido por user no-root en Alpine).
- `--disable-dev-shm-usage` (Docker `/dev/shm` default 64 MB).
- `--font-render-hinting=none` (rendering consistente de acentos cross-platform).

CHORE-D · I3: retirados `--single-process` y `--no-zygote`. Ahorraban ~50% RAM
en MVP a costa de crash isolation (crash de page tiraba el browser entero).
VPS Hostinger 8GB no está RAM-constrained; ganamos resiliencia. Si memory
regression sostenida >1GB bajo carga normal post-deploy, revertir + ticket.

## Dependencias

- `puppeteer-core` (no `puppeteer` full — Chromium se instala via apk en el Dockerfile).
- Binario en `/usr/bin/chromium-browser` (configurable via env `CHROMIUM_PATH`).

## Extender

Para sumar template específico por tipo de informe (out of scope T-023, posible T-023-FU):

1. Crear `src/shared/pdf/templates/<tipo>/PrintTemplate.tsx` con layout dedicado.
2. En `src/app/(app)/informes/[id]/print/page.tsx` dispatch por `informe.tipo`.

Para sumar watermarks ("BORRADOR", "FIRMADO"):

1. Sumar `<div class="watermark">...</div>` al `PrintTemplate` con CSS `@page { @top-left { ... } }`.
2. Pasar la flag por query string al endpoint (`/api/informes/[id]/pdf?watermark=draft`).

## Riesgos conocidos

- **Chromium OOM** en VPS compartido. Mitigación: idle timeout 5 min libera el browser si nadie genera PDFs. Si vemos presión RAM sostenida (>1 GB), sumar `mem_limit: 1g` al Service en EasyPanel UI (T-023-FU1).
- **Page leak**: el `try/finally { page.close() }` en `render.ts` es no-negociable. Cualquier path que no lo respete leakea memoria de Chromium permanentemente hasta SIGTERM.
- **Concurrent generation**: safe en Node single-threaded JS — `getBrowser()` retorna la misma promesa a callers concurrentes; `newPage()` es thread-safe en Puppeteer.

## Testing

- Unit (Vitest project `unit`): `filename.test.ts` cubre slugify edge cases.
- Integration (project `integration`): `pdf-route-auth.test.ts` y `pdf-route-audit.test.ts` mockean `htmlToPdf` con `vi.mock('@/shared/pdf/render')` para no levantar Chromium real en CI.
- E2E (Playwright, T-023 PARADA #3): dispara Chromium real del container, verifica download flow end-to-end.
