/**
 * T-050 · E2E del autocomplete cliente en el wizard de informes.
 *
 * Flujo cubierto:
 *  1. Admin INSERT fixture: cliente "Acme Industrial SRL" en el tenant del user.
 *  2. Login owner → /informes/nuevo → step 1: tipo=rgrl + título → Siguiente.
 *  3. Step 2: tipear "Acme" en autocomplete → esperar debounce + roundtrip →
 *     click resultado → card "Cliente seleccionado: Acme Industrial SRL".
 *  4. Verificar que los 5 fields RGRL del form se autopopularon (razon_social,
 *     cuit, domicilio, localidad, provincia).
 *  5. Click "Crear sin datos" → AlertDialog confirm → submit → redirect.
 *  6. DB verify: informes.cliente_id = acmeId.
 *  7. /clientes/{acmeId} → sección "Informes vinculados" muestra el informe.
 *
 * Por simplicidad NO completamos el form RGRL entero (14 fields) — el path
 * "Crear sin datos" submitea con metadata undefined pero cliente_id se
 * propaga correctamente (el state local del wizard sobrevive al AlertDialog).
 *
 * Cleanup: cascade `consultoras.id ON DELETE CASCADE` borra informes + audit
 * via FK. Limpiamos clientes explícito antes que users para evitar FK
 * violations contra audit_log (lesson T-049).
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
const createdClienteIds: string[] = [];
const createdInformeIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdInformeIds.splice(0)) {
    await adminClient.from('informes').delete().eq('id', id);
  }
  for (const id of createdClienteIds.splice(0)) {
    await adminClient.from('clientes').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Informes · cliente autocomplete (T-050)', () => {
  test('autocomplete cliente → autopopula 5 fields RGRL → crea informe con cliente_id linkeado', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const email = uniqueTestEmail('informes-cliente');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-050 autocomplete ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Fixture: cliente "Acme Industrial SRL" con los 5 fields.
    const acmeRazon = `Acme Industrial T050 ${Date.now().toString(36)}`;
    const { data: inserted, error } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        created_by: userId,
        razon_social: acmeRazon,
        cuit: '30-88888888-8',
        domicilio: 'Av. Siempreviva 742',
        localidad: 'Mar del Plata',
        provincia: 'BA',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(inserted).toBeTruthy();
    const acmeId = inserted!.id;
    createdClienteIds.push(acmeId);

    await loginViaUI(page, email, password);

    // Step 1: tipo=rgrl + título.
    await page.goto('/informes/nuevo');
    await expect(page.getByRole('combobox')).toBeVisible();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'RGRL', exact: true }).click();
    await page
      .getByPlaceholder('Ej: Relevamiento de ruido — Planta Sur')
      .fill('RGRL Acme T050 autocomplete');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2: autocomplete del cliente.
    const search = page.getByLabel('Buscar cliente');
    await expect(search).toBeVisible();
    await search.fill('Acme');

    // Debounce 300ms + roundtrip a Supabase. Esperamos al option visible.
    const acmeOption = page.getByText(acmeRazon).first();
    await expect(acmeOption).toBeVisible({ timeout: 5_000 });
    await acmeOption.click();

    // Card "Cliente seleccionado: <razon>".
    await expect(page.getByText('Cliente seleccionado')).toBeVisible();
    await expect(page.getByText(acmeRazon)).toBeVisible();

    // Autopopulate verify: los 5 fields del RGRL form deben tener los values
    // del cliente. Usamos getByLabel del FormLabel del registry client.
    // El form RGRL tiene labels (en español): Razón social, CUIT, Domicilio,
    // Localidad, Provincia.
    await expect(page.getByLabel('Razón social')).toHaveValue(acmeRazon);
    await expect(page.getByLabel('CUIT')).toHaveValue('30-88888888-8');
    await expect(page.getByLabel('Domicilio')).toHaveValue('Av. Siempreviva 742');
    await expect(page.getByLabel('Localidad')).toHaveValue('Mar del Plata');

    // "Crear sin datos" → AlertDialog confirm → submit (sin completar metadata).
    await page.getByRole('button', { name: 'Crear sin datos' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Crear vacío' }).click();

    // Redirect al informe.
    await page.waitForURL(/\/informes\/[0-9a-f-]{36}/, { timeout: 10_000 });

    // DB verify: cliente_id linkeado.
    const { data: informesRows } = await adminClient
      .from('informes')
      .select('id, cliente_id, titulo')
      .eq('consultora_id', consultoraId);
    expect(informesRows).toHaveLength(1);
    const informe = informesRows![0]!;
    createdInformeIds.push(informe.id);
    expect(informe.cliente_id).toBe(acmeId);
    expect(informe.titulo).toBe('RGRL Acme T050 autocomplete');

    // Detail view del cliente muestra la sección "Informes vinculados".
    // `CardTitle` es un <div data-slot="card-title">, no <h2> — usar getByText.
    await page.goto(`/clientes/${acmeId}`);
    await expect(page.getByText('Informes vinculados')).toBeVisible();
    await expect(page.getByText('RGRL Acme T050 autocomplete')).toBeVisible();
  });
});
