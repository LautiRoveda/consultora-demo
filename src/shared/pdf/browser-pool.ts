import 'server-only';

import type { Browser } from 'puppeteer-core';
import { randomBytes } from 'node:crypto';
import puppeteer from 'puppeteer-core';

import { logger } from '@/shared/observability/logger';

/**
 * T-023 · Singleton de Chromium headless para generacion de PDFs.
 *
 * **Server-only.** Imposible cargar desde Client o Edge — puppeteer-core
 * requiere APIs de Node.js (child_process, net).
 *
 * Decision arquitectonica (plan T-023, seccion 4):
 *  - Singleton lazy a nivel modulo, NO pool real (overkill para concurrencia
 *    esperada: 2-3 PDFs simultaneos en MVP).
 *  - Una instancia de Browser compartida; cada PDF abre/cierra su propia Page.
 *  - Idle timeout: cierra el browser si pasaron 5 min sin uso para liberar
 *    RAM en VPS compartido con cotenants (agendalo + aruba).
 *  - Concurrency safe en Node single-threaded JS: `browserPromise` compartido,
 *    callers concurrentes esperan la misma promise. `browser.newPage()` es
 *    thread-safe en Puppeteer.
 *
 * Flags de launch:
 *  - `--no-sandbox` + `--disable-setuid-sandbox`: Alpine no expone setuid; sin
 *    esto el browser falla al boot. Aceptable: corremos como user no-root
 *    (Dockerfile, USER nextjs) y el contenido renderizado pasa por
 *    rehype-sanitize + CSP `script-src 'none'` (defensa en profundidad).
 *  - `--disable-dev-shm-usage`: Docker `/dev/shm` default = 64 MB; en su
 *    lugar usa `/tmp` que crece con el container.
 *  - `--single-process`: reduce RAM ~50% pero un crash de page tira el
 *    browser entero. Aceptable en MVP (re-init en el proximo request); si
 *    en prod vemos crashes, se saca.
 *  - `--no-zygote`: requerido junto con `--single-process` en algunos alpine.
 *  - `--font-render-hinting=none`: rendering consistente de fonts (acentos
 *    españoles) cross-platform; default 'medium' rasteriza diferente segun
 *    DPI virtual.
 */

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const LAUNCH_TIMEOUT_MS = 30_000;
const CHROMIUM_FALLBACK_PATH = '/usr/bin/chromium-browser';

let browserPromise: Promise<Browser> | null = null;
let lastUsedAt = 0;
let idleTimer: NodeJS.Timeout | null = null;
let shutdownHooked = false;

/**
 * Token internal-only, regenerado en cada boot del proceso, no se expone
 * a clientes externos. El layout.tsx del route /print valida que el header
 * `x-internal-pdf-render` matchea este token; sin match → notFound().
 *
 * Por que randomBytes y no env var: queremos que ROTE en cada boot del
 * proceso para que ningun valor leakado (logs, screenshots) sobreviva un
 * restart. Una env var en EasyPanel UI seria estable y persistente — peor
 * postura.
 *
 * Persistido en globalThis para sobrevivir HMR/module-reload en dev mode:
 * sin esto, el route handler y el layout del print page pueden cargar el
 * modulo en contextos distintos y generar tokens diferentes → mismatch
 * permanente y 404 en cada PDF. En prod (output: standalone) los modulos
 * se evaluan una sola vez y este escape no es necesario, pero la solucion
 * es la misma. Trade-off: el route /print solo es accesible desde el mismo
 * proceso (same-Node-instance fetch via INTERNAL_BASE_URL). En arquitectura
 * multi-instancia futura habria que mover el token a un store compartido.
 */
const GLOBAL_TOKEN_KEY = '__consultoraDemo_pdfInternalToken' as const;
type GlobalWithToken = typeof globalThis & { [GLOBAL_TOKEN_KEY]?: string };

function ensureToken(): string {
  const g = globalThis as GlobalWithToken;
  if (!g[GLOBAL_TOKEN_KEY]) {
    g[GLOBAL_TOKEN_KEY] = randomBytes(32).toString('hex');
  }
  return g[GLOBAL_TOKEN_KEY];
}

export function getInternalPdfRenderToken(): string {
  return ensureToken();
}

/**
 * Devuelve el Browser singleton, creandolo si no existe o si la instancia
 * anterior se desconecto. `puppeteer.launch()` es relativamente caro
 * (~500 ms en alpine), por eso amortizamos.
 *
 * Concurrent callers comparten `browserPromise` — el primero dispara el
 * launch, el resto await sobre la misma promesa. No hay race.
 */
export async function getBrowser(): Promise<Browser> {
  // Path de re-uso: tenemos una promesa cacheada Y la instancia esta connected.
  if (browserPromise) {
    const browser = await browserPromise;
    if (browser.connected) {
      bumpIdle();
      return browser;
    }
    // El browser murio (crash, OOM, disconnect). Invalidamos y rebooteamos.
    logger.warn('pdf_browser_pool: browser desconectado, recreando');
    browserPromise = null;
  }

  const executablePath = process.env.CHROMIUM_PATH ?? CHROMIUM_FALLBACK_PATH;

  browserPromise = puppeteer
    .launch({
      executablePath,
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
        '--font-render-hinting=none',
      ],
    })
    .then((browser) => {
      logger.info(
        { executablePath, pid: browser.process()?.pid ?? null },
        'pdf_browser_pool: browser launched',
      );
      // Si el browser muere fuera de un htmlToPdf (e.g. OOM kill externo),
      // descacheamos para que el proximo getBrowser() levante uno nuevo.
      browser.on('disconnected', () => {
        logger.warn('pdf_browser_pool: disconnected event');
        browserPromise = null;
      });
      return browser;
    })
    .catch((err: unknown) => {
      // Reset para que el proximo intento no quede pegado a una promesa fallida.
      browserPromise = null;
      logger.error({ err: String(err), executablePath }, 'pdf_browser_pool: launch fallo');
      throw err;
    });

  ensureShutdownHook();
  bumpIdle();
  return browserPromise;
}

/**
 * Marca el browser como recien usado y reprograma el cierre idle. Llamar
 * justo despues de cualquier operacion (`getBrowser`, `htmlToPdf`).
 */
export function bumpIdle(): void {
  lastUsedAt = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  // setTimeout firma `() => void`; envolvemos para no tirar el promise al
  // void (que dispara no-misused-promises) y para hacer el catch defensivo.
  idleTimer = setTimeout(() => {
    void maybeCloseIfIdle();
  }, IDLE_TIMEOUT_MS);
  // Sin unref el timer mantiene el proceso vivo en scripts CLI corta-duracion.
  idleTimer.unref();
}

async function maybeCloseIfIdle(): Promise<void> {
  if (Date.now() - lastUsedAt < IDLE_TIMEOUT_MS) {
    // Otro request entro mientras el timer corria. Reprogramamos.
    bumpIdle();
    return;
  }
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
    logger.info('pdf_browser_pool: browser cerrado por idle timeout');
  } catch (err) {
    logger.warn({ err: String(err) }, 'pdf_browser_pool: error cerrando browser idle');
  } finally {
    browserPromise = null;
  }
}

/**
 * Cierra el browser explicitamente en shutdown del proceso. EasyPanel manda
 * SIGTERM al re-deploy; sin esto Chromium queda zombie hasta SIGKILL.
 */
function ensureShutdownHook(): void {
  if (shutdownHooked) return;
  shutdownHooked = true;
  const handler = (): void => {
    if (!browserPromise) return;
    void browserPromise
      .then((b) => b.close())
      .catch(() => {})
      .finally(() => {
        browserPromise = null;
      });
  };
  process.once('SIGTERM', handler);
  process.once('SIGINT', handler);
}

/**
 * Helper de testing: fuerza el cierre del browser singleton. **No usar en
 * runtime** — solo para tests que verifican lifecycle.
 */
export async function __resetBrowserPoolForTests(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (browserPromise) {
    try {
      const b = await browserPromise;
      await b.close();
    } catch {
      // El browser puede ya estar muerto; no nos importa.
    }
    browserPromise = null;
  }
  lastUsedAt = 0;
}
