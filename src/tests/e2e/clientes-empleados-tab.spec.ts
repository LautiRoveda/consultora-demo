/**
 * T-055 · E2E del tab Empleados dentro del detail view del cliente
 * (`/clientes/[id]/empleados`).
 *
 * 2 tests:
 *  1. Navegación + visualización: signup → admin INSERT cliente + 2 empleados
 *     fixtures → navegar a `/clientes/[id]` → tabs visibles → click tab
 *     Empleados → URL pasa a `/clientes/[id]/empleados` → 2 empleados visibles.
 *  2. CTA crear desde tab: cliente con 0 empleados → tab Empleados muestra
 *     empty state con CTA → click "Crear primer empleado" → URL pasa a
 *     `/empleados/nuevo?cliente_id=X` → llenar form → submit → redirect a
 *     `/empleados/[id]` (NO al tab cliente — flow canónico del módulo Empleados).
 *
 * Cleanup orden FK explícito (lesson T-050): empleados → clientes → users.
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
const createdEmpleadoIds: string[] = [];

test.afterEach(async () => {
  // Orden FK: empleados → clientes → users (lesson T-050).
  for (const id of createdEmpleadoIds.splice(0)) {
    await adminClient.from('empleados').delete().eq('id', id);
  }
  for (const id of createdClienteIds.splice(0)) {
    await adminClient.from('clientes').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Clientes · Tab Empleados (T-055)', () => {
  test('navegación + visualización: /clientes/[id] → tab Empleados → list visible', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = uniqueTestEmail('cliente-tab-empleados');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-055 tabs ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    const razonSocial = `Tabs T-055 ${Date.now().toString(36)}`;
    const { data: insertedCliente, error: cErr } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: razonSocial,
        cuit: '30-77777777-7',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(cErr).toBeNull();
    const clienteId = insertedCliente!.id;
    createdClienteIds.push(clienteId);

    const suffix = Date.now().toString(36);
    const apellidoA = `AlfaTab${suffix}`;
    const apellidoB = `BetaTab${suffix}`;
    const { data: insertedA } = await adminClient
      .from('empleados')
      .insert({
        consultora_id: consultoraId,
        cliente_id: clienteId,
        nombre: 'Empleado',
        apellido: apellidoA,
        dni: '20111222',
        created_by: userId,
      })
      .select('id')
      .single();
    createdEmpleadoIds.push(insertedA!.id);
    const { data: insertedB } = await adminClient
      .from('empleados')
      .insert({
        consultora_id: consultoraId,
        cliente_id: clienteId,
        nombre: 'Empleado',
        apellido: apellidoB,
        dni: '20333444',
        created_by: userId,
      })
      .select('id')
      .single();
    createdEmpleadoIds.push(insertedB!.id);

    await loginViaUI(page, email, password);
    await page.goto(`/clientes/${clienteId}`);

    // Tabs visibles en el detail.
    await expect(page.getByTestId('cliente-tab-detalle')).toBeVisible();
    await expect(page.getByTestId('cliente-tab-empleados')).toBeVisible();

    // Tab Detalle activo por default.
    await expect(page.getByTestId('cliente-tab-detalle')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('cliente-tab-empleados')).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    // Click tab Empleados → URL cambia.
    await page.getByTestId('cliente-tab-empleados').click();
    await expect(page).toHaveURL(new RegExp(`/clientes/${clienteId}/empleados$`), {
      timeout: 10_000,
    });

    // Tab Empleados ahora activo.
    await expect(page.getByTestId('cliente-tab-empleados')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('cliente-tab-detalle')).not.toHaveAttribute(
      'aria-current',
      'page',
    );

    // Los 2 empleados visibles en el list.
    await expect(page.getByText(`${apellidoA}, Empleado`)).toBeVisible();
    await expect(page.getByText(`${apellidoB}, Empleado`)).toBeVisible();

    // CTA "Nuevo empleado" visible (hay empleados → sub-header con CTA aparece).
    await expect(page.getByRole('link', { name: 'Nuevo empleado' })).toBeVisible();

    // Volver al tab Detalle.
    await page.getByTestId('cliente-tab-detalle').click();
    await expect(page).toHaveURL(new RegExp(`/clientes/${clienteId}$`), { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: razonSocial })).toBeVisible();
  });

  test('empty state del tab → CTA "Crear primer empleado" → flujo de creación canónico', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = uniqueTestEmail('cliente-tab-empty');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-055 empty ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    const razonSocial = `Empty T-055 ${Date.now().toString(36)}`;
    const { data: insertedCliente } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: razonSocial,
        cuit: '30-66666666-6',
        created_by: userId,
      })
      .select('id')
      .single();
    const clienteId = insertedCliente!.id;
    createdClienteIds.push(clienteId);

    await loginViaUI(page, email, password);
    await page.goto(`/clientes/${clienteId}/empleados`);

    // Empty state del tab (sin empleados, sin filtros).
    await expect(page.getByText('Todavía no tenés empleados en este cliente')).toBeVisible();

    // CTA empty state → /empleados/nuevo?cliente_id=X (flow canónico del módulo Empleados).
    await page.getByRole('link', { name: 'Crear primer empleado' }).click();
    await expect(page).toHaveURL(new RegExp(`/empleados/nuevo\\?cliente_id=${clienteId}$`));

    // Form preheader con la razón social del cliente fijado (T-054 prepopulate).
    await expect(page.getByText(razonSocial).first()).toBeVisible();

    const apellido = `EmptyTester${Date.now().toString(36)}`;
    await page.getByPlaceholder('Juan', { exact: true }).fill('Juana');
    await page.getByPlaceholder('Pérez').fill(apellido);
    await page.getByPlaceholder('12345678', { exact: true }).fill('20.555.666');

    await page.getByRole('button', { name: /Crear empleado/i }).click();

    // Redirect a /empleados/[id] (flow canónico del módulo Empleados,
    // NO al tab cliente — decisión arquitectural cerrada T-055).
    await expect(page).toHaveURL(/\/empleados\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: `${apellido}, Juana` })).toBeVisible();

    // Cleanup: tomamos el id del empleado creado para el afterEach.
    const { data: rows } = await adminClient
      .from('empleados')
      .select('id')
      .eq('cliente_id', clienteId);
    for (const row of rows ?? []) {
      createdEmpleadoIds.push(row.id);
    }
  });
});
