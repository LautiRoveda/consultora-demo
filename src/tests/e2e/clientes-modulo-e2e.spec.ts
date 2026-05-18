/**
 * T-051 · E2E consolidado del módulo Clientes (flow real end-to-end).
 *
 * Cubre el flow completo del consultor desde signup hasta informe vinculado:
 *  1. Signup user + consultora (NO admin shortcut — simula primer login real).
 *  2. Crear cliente con CUIT autoformat onBlur + provincia Select.
 *  3. Editar cliente (cambio razon_social + sumar nombre_fantasia).
 *  4. Crear informe RGRL con autocomplete cliente → 4 fields autopopulados.
 *  5. DB sanity: informe creado con cliente_id linkeado.
 *  6. Audit_log sanity: 1 INSERT cliente + 1 UPDATE cliente + 1 INSERT informe.
 *  7. Detail cliente: sección "Informes vinculados" muestra el informe.
 *  8. Archive flow (AlertDialog confirm) → lista default no muestra.
 *  9. Toggle "Ver archivados" → cliente aparece con Badge.
 *  10. Desarchivar → archived_at=null + informe sigue linkeado.
 *
 * Cleanup orden FK: informes → clientes → users (lesson T-049 + T-050).
 *
 * Provincia NO se verifica con toHaveValue (el Select muestra name "Buenos
 * Aires" no code "BA"; misma decisión que T-050 spec).
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

test.describe('Módulo Clientes · E2E consolidado (T-051)', () => {
  test('flow real signup → crear → editar → informe RGRL con autocomplete → archive/unarchive', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const suffix = Date.now().toString(36);
    const email = uniqueTestEmail('clientes-modulo');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-051 módulo ${suffix}`,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);

    // === FASE 1: crear cliente con CUIT autoformat + provincia Select ===
    const razonSocialOriginal = `Smoke E2E ${suffix}`;
    await page.goto('/clientes/nuevo');
    await page.getByPlaceholder('Acme S.A.').fill(razonSocialOriginal);
    // CUIT sin guiones — onBlur autoformat canonicaliza.
    await page.getByPlaceholder('30-12345678-9').fill('30912345678');
    await page.getByPlaceholder('30-12345678-9').blur();
    await page.getByPlaceholder('Av. Siempre Viva 1234').fill('Av. Test 100');
    await page.getByPlaceholder('San Justo').fill('La Plata');
    // Provincia Select (PROVINCIAS_AR enum).
    await page.getByRole('combobox', { name: /provincia/i }).click();
    await page.getByRole('option', { name: 'Buenos Aires', exact: true }).click();

    await page.getByRole('button', { name: /Crear cliente/i }).click();

    // Redirect a /clientes/[id].
    await expect(page).toHaveURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    const clienteUrl = page.url();
    const clienteId = clienteUrl.split('/').pop()!;
    createdClienteIds.push(clienteId);

    // Verificar header + CUIT canonicalizado.
    await expect(page.getByRole('heading', { name: razonSocialOriginal })).toBeVisible();
    await expect(page.getByText('30-91234567-8').first()).toBeVisible();

    // === FASE 2: editar cliente (cambio razon_social + sumar nombre_fantasia) ===
    await page.getByRole('link', { name: /Editar/i }).click();
    await expect(page).toHaveURL(new RegExp(`/clientes/${clienteId}/editar$`));
    await expect(page.getByRole('heading', { name: 'Editar cliente' })).toBeVisible();

    const razonSocialEditado = `${razonSocialOriginal} EDITADO`;
    await page.getByPlaceholder('Acme S.A.').fill(razonSocialEditado);
    await page.getByPlaceholder('El Galpón').fill('Acme');

    await page.getByRole('button', { name: /Guardar cambios/i }).click();
    await expect(page).toHaveURL(new RegExp(`/clientes/${clienteId}$`), { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: razonSocialEditado })).toBeVisible();

    // === FASE 3: crear informe RGRL con autocomplete ===
    await page.goto('/informes/nuevo');
    await expect(page.getByRole('combobox')).toBeVisible();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'RGRL', exact: true }).click();
    await page.getByPlaceholder('Ej: Relevamiento de ruido — Planta Sur').fill('RGRL E2E T-051');
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2: autocomplete cliente.
    const search = page.getByLabel('Buscar cliente');
    await expect(search).toBeVisible();
    await search.fill('Smoke E2E');

    // Debounce 300ms + roundtrip — esperar al option visible.
    const option = page.getByText(razonSocialEditado).first();
    await expect(option).toBeVisible({ timeout: 5_000 });
    await option.click();

    // Card "Cliente seleccionado".
    await expect(page.getByText('Cliente seleccionado')).toBeVisible();
    await expect(page.getByText(razonSocialEditado)).toBeVisible();

    // Autopopulate: 4 fields verificables (razón social, cuit, domicilio,
    // localidad). Provincia NO se verifica con toHaveValue — el Select muestra
    // el name "Buenos Aires" no el code "BA" (mismo approach T-050 spec).
    await expect(page.getByLabel('Razón social')).toHaveValue(razonSocialEditado);
    await expect(page.getByLabel('CUIT')).toHaveValue('30-91234567-8');
    await expect(page.getByLabel('Domicilio')).toHaveValue('Av. Test 100');
    await expect(page.getByLabel('Localidad')).toHaveValue('La Plata');

    // Path "Crear sin datos" → AlertDialog confirm.
    await page.getByRole('button', { name: 'Crear sin datos' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Crear vacío' }).click();

    // Redirect al informe.
    await page.waitForURL(/\/informes\/[0-9a-f-]{36}/, { timeout: 10_000 });

    // === FASE 4: DB sanity informe ===
    const { data: informesRows } = await adminClient
      .from('informes')
      .select('id, cliente_id, titulo')
      .eq('consultora_id', consultoraId);
    expect(informesRows).toHaveLength(1);
    const informe = informesRows![0]!;
    createdInformeIds.push(informe.id);
    expect(informe.cliente_id).toBe(clienteId);
    expect(informe.titulo).toBe('RGRL E2E T-051');

    // === FASE 5: audit_log sanity ===
    const { data: auditRows } = await adminClient
      .from('audit_log')
      .select('action, entity_type, after_data')
      .eq('consultora_id', consultoraId)
      .order('created_at', { ascending: true });

    const clientesInserts =
      auditRows?.filter((r) => r.entity_type === 'clientes' && r.action === 'created') ?? [];
    const clientesUpdates =
      auditRows?.filter((r) => r.entity_type === 'clientes' && r.action === 'updated') ?? [];
    const informesInserts =
      auditRows?.filter((r) => r.entity_type === 'informes' && r.action === 'created') ?? [];

    expect(clientesInserts).toHaveLength(1);
    expect(clientesUpdates).toHaveLength(1);
    expect(informesInserts).toHaveLength(1);

    // El INSERT del informe debe tener cliente_id en after_data (audit trigger
    // T-050 extendido captura la FK).
    const informeInsert = informesInserts[0]!;
    const afterData = informeInsert.after_data as Record<string, unknown>;
    expect(afterData.cliente_id).toBe(clienteId);

    // === FASE 6: detail cliente muestra Informes vinculados ===
    await page.goto(`/clientes/${clienteId}`);
    await expect(page.getByText('Informes vinculados')).toBeVisible();
    await expect(page.getByText('RGRL E2E T-051')).toBeVisible();

    // === FASE 7: archive flow ===
    // Setup defensivo: agregar segundo cliente activo via admin INSERT antes
    // del archive. Sino el switch "Ver archivados" no se renderea — la lista
    // cae al empty state cuando el único activo se archiva (lesson T-049
    // documentada en T-049 desviación 7 + follow-up T-049-FU2).
    const { data: insertedOther } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        created_by: userId,
        razon_social: `Activo siempre ${suffix}`,
        cuit: '30-77777777-7',
      })
      .select('id')
      .single();
    createdClienteIds.push(insertedOther!.id);

    await page.getByRole('button', { name: 'Archivar', exact: true }).click();
    await expect(page.getByText(`¿Archivar a ${razonSocialEditado}?`)).toBeVisible();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Archivar' }).click();
    await expect(page.getByText('Cliente archivado')).toBeVisible({ timeout: 10_000 });

    // Lista default NO muestra archivados.
    await page.goto('/clientes');
    await expect(page.getByText(razonSocialEditado)).toHaveCount(0);

    // === FASE 8: toggle "Ver archivados" → aparece con Badge ===
    await page.getByRole('switch', { name: /Ver archivados/i }).click();
    await expect(page).toHaveURL(/\?archived=1$/, { timeout: 10_000 });
    await expect(page.getByText(razonSocialEditado)).toBeVisible();

    // === FASE 9: desarchivar ===
    await page.goto(`/clientes/${clienteId}`);
    await page.getByRole('button', { name: 'Desarchivar', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Desarchivar' }).click();
    await expect(page.getByText('Cliente desarchivado')).toBeVisible({ timeout: 10_000 });

    // DB sanity final: archived_at = null + informe sigue linkeado (FK ON
    // DELETE SET NULL no se dispara con archive/unarchive, solo con DELETE).
    const { data: finalCliente } = await adminClient
      .from('clientes')
      .select('archived_at')
      .eq('id', clienteId)
      .single();
    expect(finalCliente?.archived_at).toBeNull();

    const { data: finalInforme } = await adminClient
      .from('informes')
      .select('cliente_id')
      .eq('id', informe.id)
      .single();
    expect(finalInforme?.cliente_id).toBe(clienteId);
  });
});
