/**
 * T-054 · E2E del módulo Empleados (CRUD + archive flow).
 *
 * 3 tests:
 *  1. Landing → crear empleado end-to-end: signup → admin INSERT cliente fixture
 *     → sidebar Empleados → click cliente del índice → empty state → crear →
 *     DB sanity (cliente_id correcto + DNI normalizado + created_by).
 *  2. Editar empleado: admin INSERT empleado fixture → /empleados/[id]/editar
 *     → cambiar puesto → submit → DB updated.
 *  3. Archive + Desarchive: admin INSERT 2 empleados (target + sentinel para
 *     no caer en empty state al volver al list) → AlertDialog confirm → list
 *     default oculta → toggle archivados → aparece → desarchive → activo.
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

test.describe('Empleados · CRUD (T-054)', () => {
  test('landing → crear empleado: /empleados → click cliente → /nuevo → fill → submit → detail + DB sanity', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = uniqueTestEmail('empleados-crear');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-054 crear ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    // Cliente fixture para que el landing tenga algo que listar.
    const razonSocial = `Acme T-054 ${Date.now().toString(36)}`;
    const { data: insertedCliente, error: cErr } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: razonSocial,
        cuit: '30-88888888-8',
        created_by: userId,
      })
      .select('id')
      .single();
    expect(cErr).toBeNull();
    const clienteId = insertedCliente!.id;
    createdClienteIds.push(clienteId);

    await loginViaUI(page, email, password);

    // Sidebar Empleados — confirma que pasó de soon → live.
    const sidebar = page.getByRole('complementary', { name: 'Barra lateral' });
    await sidebar.getByRole('link', { name: 'Empleados' }).click();
    await expect(page).toHaveURL(/\/empleados$/, { timeout: 10_000 });

    // Landing muestra el cliente del índice.
    await page.getByRole('link', { name: new RegExp(razonSocial) }).click();
    await expect(page).toHaveURL(new RegExp(`/empleados\\?cliente_id=${clienteId}$`), {
      timeout: 10_000,
    });
    await expect(page.getByText('Todavía no tenés empleados en este cliente')).toBeVisible();

    // CTA empty state → /empleados/nuevo?cliente_id=...
    await page.getByRole('link', { name: 'Crear primer empleado' }).click();
    await expect(page).toHaveURL(new RegExp(`/empleados/nuevo\\?cliente_id=${clienteId}$`));

    // Form preheader debe mostrar la razón social del cliente fijado.
    await expect(page.getByText(razonSocial).first()).toBeVisible();

    const apellido = `Tester${Date.now().toString(36)}`;
    // exact:true para evitar matches parciales:
    //  - 'Juan' vs placeholder Email 'juan@acme.com.ar'
    //  - '12345678' vs placeholder CUIL '20-12345678-9'
    await page.getByPlaceholder('Juan', { exact: true }).fill('Juan');
    await page.getByPlaceholder('Pérez').fill(apellido);
    // DNI con puntos — el action normaliza pre-DB.
    await page.getByPlaceholder('12345678', { exact: true }).fill('12.345.678');
    await page.getByPlaceholder('Operario de máquinas').fill('Operario E2E');

    await page.getByRole('button', { name: /Crear empleado/i }).click();

    // Redirect a /empleados/[id].
    await expect(page).toHaveURL(/\/empleados\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: `${apellido}, Juan` })).toBeVisible();
    // DNI visible en formato XX.XXX.XXX en el header + card.
    await expect(page.getByText('12.345.678').first()).toBeVisible();

    // DB sanity.
    const { data: rows } = await adminClient
      .from('empleados')
      .select('id, nombre, apellido, dni, puesto, cliente_id, consultora_id, created_by')
      .eq('cliente_id', clienteId);
    expect(rows).toHaveLength(1);
    const row = rows![0]!;
    createdEmpleadoIds.push(row.id);
    expect(row.nombre).toBe('Juan');
    expect(row.apellido).toBe(apellido);
    expect(row.dni).toBe('12345678');
    expect(row.puesto).toBe('Operario E2E');
    expect(row.consultora_id).toBe(consultoraId);
    expect(row.created_by).toBe(userId);
  });

  test('editar empleado: admin INSERT fixture → /editar → cambiar puesto → submit + DB updated', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = uniqueTestEmail('empleados-editar');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-054 editar ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    const { data: insertedCliente } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: `Cliente editar ${Date.now().toString(36)}`,
        cuit: '30-99999999-9',
        created_by: userId,
      })
      .select('id')
      .single();
    const clienteId = insertedCliente!.id;
    createdClienteIds.push(clienteId);

    const originalPuesto = `Original ${Date.now().toString(36)}`;
    const { data: insertedEmpleado } = await adminClient
      .from('empleados')
      .insert({
        consultora_id: consultoraId,
        cliente_id: clienteId,
        nombre: 'Juana',
        apellido: 'Editora',
        dni: '23456789',
        puesto: originalPuesto,
        created_by: userId,
      })
      .select('id')
      .single();
    const empleadoId = insertedEmpleado!.id;
    createdEmpleadoIds.push(empleadoId);

    await loginViaUI(page, email, password);
    await page.goto(`/empleados/${empleadoId}/editar`);
    await expect(page.getByRole('heading', { name: 'Editar empleado' })).toBeVisible();

    const puestoInput = page.getByPlaceholder('Operario de máquinas');
    await expect(puestoInput).toHaveValue(originalPuesto);

    const nuevoPuesto = `Editado ${Date.now().toString(36)}`;
    await puestoInput.fill(nuevoPuesto);
    await page.getByRole('button', { name: /Guardar cambios/i }).click();

    await expect(page).toHaveURL(new RegExp(`/empleados/${empleadoId}$`), { timeout: 10_000 });
    await expect(page.getByText(nuevoPuesto)).toBeVisible();

    const { data: updated } = await adminClient
      .from('empleados')
      .select('puesto')
      .eq('id', empleadoId)
      .single();
    expect(updated?.puesto).toBe(nuevoPuesto);
  });

  test('archive + desarchive flow: AlertDialog confirm → list filter → toggle archivados', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const email = uniqueTestEmail('empleados-archive');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-054 archive ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);

    const { data: insertedCliente } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: `Cliente archive ${Date.now().toString(36)}`,
        cuit: '30-11111111-1',
        created_by: userId,
      })
      .select('id')
      .single();
    const clienteId = insertedCliente!.id;
    createdClienteIds.push(clienteId);

    // Insertamos DOS empleados: el target (que archivamos) + un sentinel que
    // permanece activo. Sin sentinel, la lista cae en empty state y el switch
    // "Ver archivados" no aparece — el flujo se rompe.
    const suffix = Date.now().toString(36);
    const apellidoTarget = `Target${suffix}`;
    const apellidoSentinel = `Sentinel${suffix}`;
    const { data: insertedTarget } = await adminClient
      .from('empleados')
      .insert({
        consultora_id: consultoraId,
        cliente_id: clienteId,
        nombre: 'Para',
        apellido: apellidoTarget,
        dni: '34567890',
        created_by: userId,
      })
      .select('id')
      .single();
    const empleadoId = insertedTarget!.id;
    createdEmpleadoIds.push(empleadoId);

    const { data: insertedSentinel } = await adminClient
      .from('empleados')
      .insert({
        consultora_id: consultoraId,
        cliente_id: clienteId,
        nombre: 'Activo',
        apellido: apellidoSentinel,
        dni: '45678901',
        created_by: userId,
      })
      .select('id')
      .single();
    createdEmpleadoIds.push(insertedSentinel!.id);

    await loginViaUI(page, email, password);
    await page.goto(`/empleados/${empleadoId}`);
    await expect(page.getByRole('heading', { name: `${apellidoTarget}, Para` })).toBeVisible();

    // Archive via AlertDialog confirm.
    await page.getByRole('button', { name: 'Archivar', exact: true }).click();
    await expect(page.getByText(`¿Archivar a ${apellidoTarget}, Para?`)).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByText('Empleado archivado')).toBeVisible({ timeout: 10_000 });

    // Volver a la lista — target NO debe aparecer; sentinel sí.
    await page.goto(`/empleados?cliente_id=${clienteId}`);
    await expect(page.getByRole('switch', { name: /Ver archivados/i })).toBeVisible();
    await expect(page.getByText(`${apellidoTarget}, Para`)).toHaveCount(0);
    await expect(page.getByText(`${apellidoSentinel}, Activo`)).toBeVisible();

    // DB sanity: archived_at != null.
    const { data: archivado } = await adminClient
      .from('empleados')
      .select('archived_at')
      .eq('id', empleadoId)
      .single();
    expect(archivado?.archived_at).not.toBeNull();

    // Toggle "Ver archivados" → target aparece.
    await page.getByRole('switch', { name: /Ver archivados/i }).click();
    await expect(page).toHaveURL(/archived=1/, { timeout: 10_000 });
    await expect(page.getByText(`${apellidoTarget}, Para`)).toBeVisible();

    // Click la card del target → detail.
    await page.getByRole('link', { name: new RegExp(apellidoTarget) }).click();
    await expect(page).toHaveURL(new RegExp(`/empleados/${empleadoId}$`));
    await expect(page.getByText('Archivado').first()).toBeVisible();

    // Desarchive.
    await page.getByRole('button', { name: 'Desarchivar', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Desarchivar' }).click();
    await expect(page.getByText('Empleado desarchivado')).toBeVisible({ timeout: 10_000 });

    const { data: desarchivado } = await adminClient
      .from('empleados')
      .select('archived_at')
      .eq('id', empleadoId)
      .single();
    expect(desarchivado?.archived_at).toBeNull();
  });
});
