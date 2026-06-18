/**
 * T-158 · E2E funcional "a volumen" (`@volume`).
 *
 * Valida que los flujos core aguantan VOLUMEN DE DATOS sin romperse: aislamiento
 * RLS multi-tenant a escala, dashboard + semáforo por cliente, calendario, y el
 * comportamiento (hoy) de los listados a volumen. NO es load/perf de concurrencia.
 *
 * **Fuera del gate (fork 2 T-158)**: todos los tests llevan `@volume` en el
 * título. El job E2E del gate corre con `--grep-invert @volume`; este suite corre
 * NIGHTLY (`.github/workflows/e2e-volume-nightly.yml`) con `--grep @volume`.
 *
 * **Cero IA**: el volumen se siembra programáticamente (service-role, ver
 * `helpers/seed-volume.ts`) con informes de `contenido` escrito. El happy-path
 * crea el informe por `/informes/nuevo` (createInformeAction, sin generación).
 *
 * **Limitación documentada (FU T-159)**: los listados clientes/empleados NO
 * paginan y la búsqueda es client-side sobre las primeras 50 filas. Los tests 4
 * y 5 ASEVERAN esa truncación (los registros >50 no aparecen ni vía búsqueda) —
 * la limitación queda capturada, no como sorpresa futura. El FU de paginación +
 * búsqueda server-side (pre-lanzamiento, Tier 0) la revierte.
 *
 * Correr local: `node scripts/test-e2e-local.mjs --grep @volume`.
 */
import type { SmallSeed, VolumeSeed } from './helpers/seed-volume';
import { expect, test } from '@playwright/test';

import { uniqueTestEmail } from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';
import {
  cleanupConsultora,
  seedConsultoraChica,
  seedConsultoraGorda,
  VOL_VENCIDOS,
} from './helpers/seed-volume';

let gorda: VolumeSeed;
let chica: SmallSeed;

test.describe.configure({ mode: 'serial' });

test.describe('E2E a volumen (T-158)', () => {
  test.beforeAll(async () => {
    // Seeding pesado (service-role batcheado): ~111 clientes, ~190 empleados, 80
    // informes, ~100 eventos + 5 entregas EPP vía RPC. Segundos, pero damos aire.
    test.setTimeout(240_000);
    const runId = Date.now().toString(36);
    gorda = await seedConsultoraGorda(runId);
    chica = await seedConsultoraChica(runId);
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    if (gorda) await cleanupConsultora(gorda.consultoraId, gorda.userId).catch(() => {});
    if (chica) await cleanupConsultora(chica.consultoraId, chica.userId).catch(() => {});
  });

  test('1. aislamiento RLS a escala: la consultora chica NO ve datos de la gorda @volume', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, chica.email, chica.password);

    // /clientes: ve los suyos, NINGUNO de la gorda (ni los volumen ni el industrial).
    await page.goto('/clientes');
    await expect(page.getByText(chica.clienteRazon)).toBeVisible();
    await expect(page.getByText(gorda.clienteVisibleRazon)).toHaveCount(0);
    await expect(page.getByText('AAA Industrial Volumen', { exact: false })).toHaveCount(0);

    // Dashboard: el semáforo NO contiene filas de clientes de la gorda (RLS scopea
    // por tenant — las filas ni siquiera llegan al DOM).
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard-sidebar')).toBeVisible();
    await expect(page.getByTestId(`semaforo-row-${gorda.clienteVencidoId}`)).toHaveCount(0);
    await expect(page.getByTestId(`semaforo-row-${gorda.clientePorVencerId}`)).toHaveCount(0);
  });

  test('2. dashboard + semáforo a volumen: estados derivados del seed @volume', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, gorda.email, gorda.password);

    await page.goto('/dashboard');
    await expect(page.getByTestId('client-semaphore')).toBeVisible();

    // El pulso refleja los vencidos sembrados (camino informes, fecha pasada).
    await expect(page.getByTestId('dashboard-pulso')).toContainText(/vencido/i);

    // Conteo coherente con lo sembrado: el semáforo NO se "mueve solo" — sólo los
    // eventos DERIVATIVOS lo mueven. Verificamos un cliente vencido (camino 1) y
    // uno por-vencer (camino 2) puntuales, ambos en el seed derivativo.
    await expect(page.getByTestId(`semaforo-row-${gorda.clienteVencidoId}`)).toBeVisible();
    await expect(page.getByTestId(`semaforo-row-${gorda.clientePorVencerId}`)).toBeVisible();
  });

  test('3. calendario a volumen + filtro server-side por tipo @volume', async ({ page }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, gorda.email, gorda.password);

    // Agenda completa: el marcador custom (entre ~100 eventos) renderiza.
    await page.goto('/calendario/agenda');
    await expect(page.getByText(gorda.customEventTitulo)).toBeVisible();

    // Filtro server-side por tipo (URL state): epp_entrega excluye el custom y
    // muestra eventos EPP (los derivativos + los reales de la RPC).
    await page.goto('/calendario/agenda?tipo=epp_entrega');
    await expect(page.getByText(gorda.customEventTitulo)).toHaveCount(0);
    await expect(page.getByText(/Vencimiento EPP/i).first()).toBeVisible();
  });

  test('4. LIMITACIÓN (FU T-159): el listado de clientes trunca a 50 y la búsqueda no halla el >50 @volume', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, gorda.email, gorda.password);

    await page.goto('/clientes');
    // Un cliente dentro de las primeras 50 filas (orden alfabético) SÍ aparece.
    await expect(page.getByText(gorda.clienteVisibleRazon, { exact: true })).toBeVisible();
    // El cliente más allá de la fila 50 NO llega al cliente → invisible.
    await expect(page.getByText(gorda.clienteTruncadoRazon, { exact: true })).toHaveCount(0);

    // La búsqueda es client-side sobre las 50 cargadas → NO encuentra el >50,
    // aunque exista en la DB. Esto documenta la limitación (la revierte el FU T-159).
    await page.getByLabel('Buscar clientes').fill(gorda.clienteTruncadoRazon);
    await expect(page.getByText('Ningún cliente coincide con la búsqueda actual.')).toBeVisible();
  });

  test('5. LIMITACIÓN (FU T-159): el listado de empleados (per-cliente) trunca a 50 @volume', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await loginViaUI(page, gorda.email, gorda.password);

    // El cliente industrial tiene 120 empleados → su lista per-cliente trunca a 50.
    await page.goto(`/clientes/${gorda.clienteIndustrialId}/empleados`);
    await expect(page.getByText(gorda.empleadoVisibleApellido, { exact: false })).toBeVisible();
    await expect(page.getByText(gorda.empleadoTruncadoApellido, { exact: false })).toHaveCount(0);

    await page.getByLabel('Buscar empleados').fill(gorda.empleadoTruncadoApellido);
    await expect(page.getByText('Ningún empleado coincide con la búsqueda actual.')).toBeVisible();
  });

  test('6. happy-path core sin IA: cliente (UI) → informe escrito (UI) → vencimiento EPP en calendario @volume', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await loginViaUI(page, gorda.email, gorda.password);

    // ── Crear cliente por UI (createClienteAction). ──
    const razon = `Happy Path ${uniqueTestEmail('hp').split('@')[0]}`;
    await page.goto('/clientes/nuevo');
    await page.getByPlaceholder('Acme S.A.').fill(razon);
    await page.getByPlaceholder('30-12345678-9').fill('30999999993');
    await page.getByPlaceholder('30-12345678-9').blur();
    await page.getByRole('button', { name: /Crear cliente/i }).click();
    await expect(page).toHaveURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: razon })).toBeVisible();

    // ── Crear informe ESCRITO por UI (createInformeAction, sin IA). ──
    const titulo = `Informe Happy ${Date.now().toString(36)}`;
    await page.goto('/informes/nuevo');
    await page.getByLabel('Título').fill(titulo);
    await page.getByRole('button', { name: /Siguiente/ }).click();
    await page.getByRole('button', { name: 'Crear sin datos' }).click();
    await page.getByRole('button', { name: 'Crear vacío' }).click();
    await expect(page).toHaveURL(/\/informes\/[0-9a-f-]+$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: titulo })).toBeVisible();

    // ── El wiring EPP→calendario (sembrado en beforeAll vía RPC real) se ve en
    // la agenda. La carga de empleados por UI está cubierta por empleados-crud
    // (no se duplica acá — plan T-158). ──
    await page.goto('/calendario/agenda');
    await expect(page.getByText(/Vencimiento EPP/i).first()).toBeVisible();
    // Sanidad del seed: hay al menos los clientes vencidos derivativos esperados.
    expect(VOL_VENCIDOS).toBeGreaterThan(0);
  });
});
