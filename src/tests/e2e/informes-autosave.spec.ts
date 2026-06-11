/**
 * T-141 Fase C · E2E del autosave de borrador + integridad legal del publish.
 *
 * Verifica el requisito no negociable: al PUBLICAR, lo firmado DEBE ser la última
 * edición autoguardada, no el contenido canónico. Flujo:
 *   editar (autosave a contenido_borrador) → publicar SIN "Guardar" → el publicado
 *   (informes.contenido) == el borrador editado.
 *
 * También chequea el indicador visible (Guardando… → Guardado) y que el autosave
 * NO toca el contenido canónico mientras tanto.
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

test.afterEach(async () => {
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

async function createDraftInforme(args: {
  consultoraId: string;
  createdBy: string;
  contenido: string;
}): Promise<string> {
  const { data, error } = await adminClient
    .from('informes')
    .insert({
      consultora_id: args.consultoraId,
      created_by: args.createdBy,
      tipo: 'otros',
      titulo: `E2E autosave ${Date.now().toString(36)}`,
      status: 'draft',
      contenido: args.contenido,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`createDraftInforme falló: ${error?.message}`);
  return data.id;
}

const INITIAL = 'Contenido canónico inicial del informe.';
const MARKER = 'EDICION-AUTOSAVE';

test.describe('Informes · autosave de borrador + publish (T-141 Fase C)', () => {
  test('editar → autosave → publicar sin Guardar → publicado == borrador', async ({ page }) => {
    const email = uniqueTestEmail('autosave');
    const { userId, password, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: `Autosave ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);
    const informeId = await createDraftInforme({
      consultoraId,
      createdBy: userId,
      contenido: INITIAL,
    });

    await loginViaUI(page, email, password);
    await page.goto(`/informes/${informeId}/editar`);

    // Editor lazy (ssr:false): esperar que monte y deserialice el contenido.
    const editor = page.locator('[data-slate-editor="true"]');
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(editor).toContainText('Contenido canónico inicial');

    // Editar: cursor al final + tipear el marcador (sin "Guardar cambios").
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(` ${MARKER}`);

    // El indicador de autosave aparece (Guardando… → Guardado HH:MM).
    await expect(page.getByText(/^Guardado /)).toBeVisible({ timeout: 15_000 });

    // El borrador se persistió; el contenido canónico NO cambió todavía.
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from('informes')
            .select('contenido, contenido_borrador')
            .eq('id', informeId)
            .single();
          return data;
        },
        { timeout: 10_000 },
      )
      .toMatchObject({ contenido: INITIAL });
    const { data: midState } = await adminClient
      .from('informes')
      .select('contenido, contenido_borrador')
      .eq('id', informeId)
      .single();
    expect(midState?.contenido).toBe(INITIAL); // canónico intacto
    expect(midState?.contenido_borrador).toContain(MARKER); // borrador con la edición

    // Publicar SIN "Guardar cambios": el onBeforePublish promueve el borrador.
    await page.getByRole('button', { name: 'Publicar' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('Informe publicado')).toBeVisible({ timeout: 15_000 });

    // Lo publicado == el borrador editado; el borrador quedó limpio.
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from('informes')
            .select('status, contenido, contenido_borrador')
            .eq('id', informeId)
            .single();
          return data;
        },
        { timeout: 10_000 },
      )
      .toMatchObject({ status: 'published', contenido_borrador: null });
    const { data: finalState } = await adminClient
      .from('informes')
      .select('contenido')
      .eq('id', informeId)
      .single();
    expect(finalState?.contenido).toContain(MARKER); // firmado == la última edición
  });
});
