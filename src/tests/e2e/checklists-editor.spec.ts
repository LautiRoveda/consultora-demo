/**
 * T-059 · E2E del editor de Checklists.
 *
 * 3 tests:
 *  1. Crear template → agregar 2 secciones + ítems → reordenar una sección →
 *     publicar → DB sanity (orden + estado published).
 *  2. Personalizar el RGRL de sistema (clone) → nuevo template propio en draft.
 *  3. Publicar con 0 ítems está bloqueado (botón disabled).
 *
 * Cleanup: borramos los checklist_templates del tenant (cascade a versions/
 * sections/items) y después el user.
 */
import { expect, test } from '@playwright/test';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];
const createdConsultoraIds: string[] = [];

test.afterEach(async () => {
  for (const consultoraId of createdConsultoraIds.splice(0)) {
    // Solo los del tenant (consultora_id != null) — nunca los de sistema.
    await adminClient.from('checklist_templates').delete().eq('consultora_id', consultoraId);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

async function addSection(page: import('@playwright/test').Page, titulo: string) {
  await page.getByRole('button', { name: /Agregar sección/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Título *').fill(titulo);
  await dialog.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByText('Sección agregada')).toBeVisible({ timeout: 10_000 });
}

async function addItem(
  page: import('@playwright/test').Page,
  sectionTitulo: string,
  texto: string,
) {
  // El botón "Agregar ítem" vive dentro de la card de la sección.
  const card = page.locator('[data-slot="card"]', { hasText: sectionTitulo });
  await card.getByRole('button', { name: /Agregar ítem/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Texto del ítem *').fill(texto);
  await dialog.getByRole('button', { name: 'Agregar' }).click();
  await expect(page.getByText('Ítem agregado')).toBeVisible({ timeout: 10_000 });
}

test.describe('Checklists · editor (T-059)', () => {
  test('crear → secciones + ítems → reordenar → publicar', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueTestEmail('checklists-crear');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-059 crear ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    await loginViaUI(page, email, password);

    // Sidebar → Checklists (confirma que está live).
    const sidebar = page.getByRole('complementary', { name: 'Barra lateral' });
    await sidebar.getByRole('link', { name: 'Checklists' }).click();
    await expect(page).toHaveURL(/\/checklists$/, { timeout: 10_000 });
    await expect(page.getByText('Todavía no tenés checklists propios')).toBeVisible();

    // Crear desde cero.
    await page.getByRole('link', { name: /Crear template desde cero/i }).click();
    await expect(page).toHaveURL(/\/checklists\/nuevo$/);
    const nombre = `Checklist E2E ${Date.now().toString(36)}`;
    await page.getByPlaceholder('RGRL planta norte').fill(nombre);
    await page.getByRole('button', { name: /Crear template/i }).click();

    // Editor del draft.
    await expect(page).toHaveURL(/\/checklists\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    const templateId = page.url().split('/').pop()!;
    await expect(page.getByText('Borrador v1')).toBeVisible();

    // 2 secciones, cada una con 1 ítem.
    await addSection(page, 'Sección 1');
    await addSection(page, 'Sección 2');
    await addItem(page, 'Sección 1', 'Ítem de la 1');
    await addItem(page, 'Sección 2', 'Ítem de la 2');

    // Reordenar: bajar la Sección 1 → queda segunda.
    await page.getByRole('button', { name: 'Bajar «Sección 1»' }).click();

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from('template_sections')
            .select('titulo, orden')
            .order('orden', { ascending: true });
          const own = (data ?? []).filter(
            (s) => s.titulo === 'Sección 1' || s.titulo === 'Sección 2',
          );
          return own.map((s) => s.titulo).join(',');
        },
        { timeout: 10_000 },
      )
      .toBe('Sección 2,Sección 1');

    // Publicar.
    await page.getByRole('button', { name: /Publicar/i }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('Versión publicada')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Publicada v1')).toBeVisible();

    // DB sanity.
    const { data: versions } = await adminClient
      .from('checklist_template_versions')
      .select('id, estado, version_number')
      .eq('template_id', templateId);
    expect(versions).toHaveLength(1);
    expect(versions![0]!.estado).toBe('published');

    const { data: items } = await adminClient
      .from('template_items')
      .select('id')
      .eq('version_id', versions![0]!.id);
    expect((items ?? []).length).toBe(2);
  });

  test('personalizar el RGRL de sistema → nuevo template propio', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueTestEmail('checklists-clone');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-059 clone ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    // Requiere que exista el RGRL de sistema (seed de la migración T-057).
    const { data: sys } = await adminClient
      .from('checklist_templates')
      .select('id')
      .is('consultora_id', null)
      .limit(1)
      .maybeSingle();
    test.skip(!sys?.id, 'No hay RGRL de sistema seedeado en este entorno.');

    await loginViaUI(page, email, password);
    await page.goto('/checklists');

    await page.getByRole('button', { name: /Personalizar RGRL/i }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Usar nombre por defecto/i })
      .click();

    // Redirige al nuevo draft propio.
    await expect(page).toHaveURL(/\/checklists\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    await expect(page.getByText('Borrador v1')).toBeVisible();

    const { data: own } = await adminClient
      .from('checklist_templates')
      .select('id')
      .eq('consultora_id', consultoraId);
    expect((own ?? []).length).toBe(1);
  });

  test('publicar con 0 ítems está bloqueado', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueTestEmail('checklists-empty');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-059 empty ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    await loginViaUI(page, email, password);
    await page.goto('/checklists/nuevo');
    const nombre = `Vacío E2E ${Date.now().toString(36)}`;
    await page.getByPlaceholder('RGRL planta norte').fill(nombre);
    await page.getByRole('button', { name: /Crear template/i }).click();

    await expect(page).toHaveURL(/\/checklists\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    // Sin ítems → el botón Publicar está disabled.
    await expect(page.getByRole('button', { name: /Publicar/i })).toBeDisabled();
  });
});
