/**
 * T-049 · E2E del módulo Clientes (CRUD + archive flow).
 *
 * 3 tests:
 *  1. Crear cliente end-to-end via UI → admin DB sanity.
 *  2. Editar cliente: admin INSERT fixture → /editar → cambiar razon_social →
 *     submit → DB updated + audit_log row.
 *  3. Archive + Desarchive: AlertDialog confirm → no aparece en lista default →
 *     toggle "Ver archivados" → aparece → desarchivar → archived_at null.
 *
 * Cleanup: el cascade `consultoras.id ON DELETE` borra `clientes` y `audit_log`
 * via FK. El user delete dispara la cascade end-to-end (mismo patrón consultora-
 * logo.spec.ts T-024).
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

test.afterEach(async () => {
  // Limpiar clientes antes de los users — la FK ON DELETE CASCADE igual lo
  // haría, pero limpiar explícito evita FK violations en audit_log.
  for (const id of createdClienteIds.splice(0)) {
    await adminClient.from('clientes').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Clientes · CRUD (T-049)', () => {
  test('crear cliente end-to-end: /clientes/nuevo → fill form → submit → detail + DB sanity', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = uniqueTestEmail('clientes-crear');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-049 crear ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);

    // Navegar desde el sidebar — confirma que Clientes está live.
    const sidebar = page.getByRole('complementary', { name: 'Barra lateral' });
    await sidebar.getByRole('link', { name: 'Clientes' }).click();
    await expect(page).toHaveURL(/\/clientes$/, { timeout: 10_000 });
    await expect(page.getByText('Todavía no tenés clientes')).toBeVisible();

    // CTA empty state → /clientes/nuevo.
    await page.getByRole('link', { name: 'Crear primer cliente' }).click();
    await expect(page).toHaveURL(/\/clientes\/nuevo$/);

    const razonSocial = `Acme E2E ${Date.now().toString(36)}`;
    await page.getByPlaceholder('Acme S.A.').fill(razonSocial);
    // CUIT sin guiones — el onBlur autoformat lo canonicaliza.
    await page.getByPlaceholder('30-12345678-9').fill('30444444443');
    await page.getByPlaceholder('30-12345678-9').blur();
    await page.getByPlaceholder('El Galpón').fill('Galpón E2E');
    await page.getByPlaceholder('Juan Pérez').fill('Tester QA');

    await page.getByRole('button', { name: /Crear cliente/i }).click();

    // Redirect a /clientes/[id].
    await expect(page).toHaveURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: razonSocial })).toBeVisible();
    // El CUIT canonicalizado aparece en el header. Usamos `first()` porque el
    // CUIT aparece 2x: en el subheader y en el Card "Identificación".
    await expect(page.getByText('30-44444444-3').first()).toBeVisible();

    // DB sanity: el row existe con el shape esperado.
    const { data: rows } = await adminClient
      .from('clientes')
      .select('id, razon_social, cuit, nombre_fantasia, contacto_nombre, consultora_id, created_by')
      .eq('consultora_id', consultoraId);
    expect(rows).toHaveLength(1);
    const row = rows![0]!;
    createdClienteIds.push(row.id);
    expect(row.razon_social).toBe(razonSocial);
    expect(row.cuit).toBe('30-44444444-3');
    expect(row.nombre_fantasia).toBe('Galpón E2E');
    expect(row.contacto_nombre).toBe('Tester QA');
    expect(row.created_by).toBe(userId);
  });

  test('editar cliente: admin INSERT fixture → /editar → cambiar razon_social → submit + DB updated', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = uniqueTestEmail('clientes-editar');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-049 editar ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    const originalRazon = `Original ${Date.now().toString(36)}`;
    const { data: inserted, error } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: originalRazon,
        cuit: '30-55555555-5',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(inserted).toBeTruthy();
    const clienteId = inserted!.id;
    createdClienteIds.push(clienteId);

    await loginViaUI(page, email, password);
    await page.goto(`/clientes/${clienteId}/editar`);
    await expect(page.getByRole('heading', { name: 'Editar cliente' })).toBeVisible();

    // El field pre-popula con el valor admin-inserted.
    const razonInput = page.getByPlaceholder('Acme S.A.');
    await expect(razonInput).toHaveValue(originalRazon);

    const nuevoRazon = `Editado ${Date.now().toString(36)}`;
    await razonInput.fill(nuevoRazon);
    await page.getByRole('button', { name: /Guardar cambios/i }).click();

    // Redirect al detail con razon_social actualizado.
    await expect(page).toHaveURL(new RegExp(`/clientes/${clienteId}$`), { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: nuevoRazon })).toBeVisible();

    // DB sanity: el cambio persistió.
    const { data: updated } = await adminClient
      .from('clientes')
      .select('razon_social')
      .eq('id', clienteId)
      .single();
    expect(updated?.razon_social).toBe(nuevoRazon);
  });

  test('archive + desarchive flow: AlertDialog confirm → lista filter → toggle archivados', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = uniqueTestEmail('clientes-archive');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-049 archive ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Insertamos DOS clientes: uno permanece activo (sino la lista cae en
    // empty state que no muestra el switch "Ver archivados"). El otro es el
    // que archivamos + desarchivamos.
    const suffix = Date.now().toString(36);
    const razon = `Para archivar ${suffix}`;
    const otherRazon = `Activo siempre ${suffix}`;
    const { data: insertedTarget } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: razon,
        cuit: '30-66666666-6',
        created_by: userId,
      })
      .select('id')
      .single();
    const clienteId = insertedTarget!.id;
    createdClienteIds.push(clienteId);

    const { data: insertedOther } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: otherRazon,
        cuit: '30-77777777-7',
        created_by: userId,
      })
      .select('id')
      .single();
    createdClienteIds.push(insertedOther!.id);

    await loginViaUI(page, email, password);
    await page.goto(`/clientes/${clienteId}`);
    await expect(page.getByRole('heading', { name: razon })).toBeVisible();

    // Archivar via AlertDialog confirm.
    await page.getByRole('button', { name: 'Archivar', exact: true }).click();
    await expect(page.getByText(`¿Archivar a ${razon}?`)).toBeVisible();
    // El botón confirm del dialog tiene name="Archivar"; targetea adentro del
    // AlertDialog content para desambiguar del trigger.
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archivar' }).click();

    // Esperar al toast de éxito antes de navegar — sino el goto puede correr
    // antes de que la action server-side complete + revalidate (race entre
    // setDialogOpen(false) sincronico y startTransition async).
    await expect(page.getByText('Cliente archivado')).toBeVisible({ timeout: 10_000 });

    // Volver a la lista — el cliente NO debe aparecer en el listado default.
    await page.goto('/clientes');
    await expect(page.getByRole('switch', { name: /Ver archivados/i })).toBeVisible();
    await expect(page.getByText(razon)).toHaveCount(0);

    // DB sanity: archived_at != null.
    const { data: archivado } = await adminClient
      .from('clientes')
      .select('archived_at')
      .eq('id', clienteId)
      .single();
    expect(archivado?.archived_at).not.toBeNull();

    // Toggle "Ver archivados" → el cliente aparece.
    await page.getByRole('switch', { name: /Ver archivados/i }).click();
    await expect(page).toHaveURL(/\?archived=1$/, { timeout: 10_000 });
    await expect(page.getByText(razon)).toBeVisible();

    // Click sobre la card del cliente → detail.
    await page.getByRole('link', { name: new RegExp(razon) }).click();
    await expect(page).toHaveURL(new RegExp(`/clientes/${clienteId}$`));
    await expect(page.getByText('Archivado').first()).toBeVisible();

    // Desarchivar.
    await page.getByRole('button', { name: 'Desarchivar', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Desarchivar' }).click();
    await expect(page.getByText('Cliente desarchivado')).toBeVisible({ timeout: 10_000 });

    // DB sanity: archived_at = null.
    const { data: desarchivado } = await adminClient
      .from('clientes')
      .select('archived_at')
      .eq('id', clienteId)
      .single();
    expect(desarchivado?.archived_at).toBeNull();
  });
});
