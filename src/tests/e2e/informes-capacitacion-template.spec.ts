/**
 * T-022 · E2E del template Capacitacion. Espeja la estructura de
 * `informes-rgrl-template.spec.ts` para validar que el wizard generalizado
 * funciona para los 4 tipos nuevos (capacitacion como representante).
 *
 * 2 tests:
 *   1. Wizard happy path: login → /informes/nuevo → tipo=capacitacion →
 *      step 2 form CapacitacionMetadataForm → submit → redirect a /editar
 *      con valores pre-poblados visibles.
 *   2. Save metadata desde /editar: editar un campo del form → "Guardar datos"
 *      → toast success → refresh → valor persistido visible (re-read del server).
 *
 * Los otros 3 tipos (relevamiento, accidente, otros) quedan cubiertos por
 * integration tests (informes-metadata-actions.test.ts con describe.each).
 */
import { expect, test } from '@playwright/test';

import { createTestUserWithConsultora, deleteTestUser, uniqueTestEmail } from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Informes · template Capacitacion (T-022)', () => {
  test('wizard 2 steps: tipo capacitacion → form → crear con datos → redirect /editar con datos pre-pobladas', async ({
    page,
  }) => {
    const email = uniqueTestEmail('cap-wizard');
    const consultoraName = `Test Cap Wizard ${Date.now().toString(36)}`;
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);
    await page.goto('/informes/nuevo');

    // === STEP 1: tipo + titulo ===
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Capacitación' }).click();
    await page.getByLabel('Título').fill('E2E Capacitacion Wizard Test');

    // El boton ahora dice "Siguiente: cargar datos" (porque tipo tiene metadata).
    await page.getByRole('button', { name: /Siguiente/ }).click();

    // === STEP 2: form Capacitacion ===
    await expect(page.getByRole('heading', { name: /Datos de la capacitación/i })).toBeVisible();

    // Llenar campos obligatorios (defaults cubren modalidad, duracion, asistentes, fecha).
    await page.getByLabel('Razón social').fill('Construcciones del Plata SA');
    await page.getByLabel('CUIT').fill('30-98765432-1');
    await page.getByLabel('Domicilio').fill('Av. Mitre 567');
    await page.getByLabel('Tema principal').fill('Uso correcto de EPP en altura');
    await page.getByLabel('Capacitador', { exact: true }).fill('Juan Pérez');

    // Submit con datos.
    await page.getByRole('button', { name: /Crear informe con datos/ }).click();

    // === Verificacion: redirect a /editar con valores pre-poblados ===
    await expect(page).toHaveURL(/\/informes\/[0-9a-f-]+\/editar$/, { timeout: 15_000 });

    // El panel metadata esta arriba con los datos pre-pobladas.
    await expect(page.getByText(/Datos de la capacitación/i).first()).toBeVisible();
    await expect(page.getByLabel('Razón social')).toHaveValue('Construcciones del Plata SA');
    await expect(page.getByLabel('CUIT')).toHaveValue('30-98765432-1');
    await expect(page.getByLabel('Tema principal')).toHaveValue('Uso correcto de EPP en altura');
    await expect(page.getByLabel('Capacitador', { exact: true })).toHaveValue('Juan Pérez');
  });

  test('save metadata desde /editar: editar valor → Guardar datos → toast → refresh persistido', async ({
    page,
  }) => {
    const email = uniqueTestEmail('cap-save');
    const consultoraName = `Test Cap Save ${Date.now().toString(36)}`;
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);
    await page.goto('/informes/nuevo');

    // Crear capacitacion via wizard (sin datos primero — flow alternativo).
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Capacitación' }).click();
    await page.getByLabel('Título').fill('E2E Cap Save Test');
    await page.getByRole('button', { name: /Siguiente/ }).click();

    // Llenar lo minimo para crear con datos.
    await page.getByLabel('Razón social').fill('Empresa Inicial SA');
    await page.getByLabel('CUIT').fill('30-11122233-4');
    await page.getByLabel('Domicilio').fill('Inicial 100');
    await page.getByLabel('Tema principal').fill('Tema inicial');
    await page.getByLabel('Capacitador', { exact: true }).fill('Capacitador Inicial');
    await page.getByRole('button', { name: /Crear informe con datos/ }).click();
    await expect(page).toHaveURL(/\/informes\/[0-9a-f-]+\/editar$/, { timeout: 15_000 });

    // Editar el tema desde /editar y guardar.
    await page.getByLabel('Tema principal').fill('Tema actualizado E2E');
    await page.getByRole('button', { name: /Guardar datos/ }).click();

    // Toast confirma + valor persiste tras refresh.
    await expect(page.getByText(/Datos guardados/i)).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.getByLabel('Tema principal')).toHaveValue('Tema actualizado E2E');
  });
});
