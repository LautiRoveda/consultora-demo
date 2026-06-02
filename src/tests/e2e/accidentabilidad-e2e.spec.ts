/**
 * T-063 · E2E del módulo Accidentabilidad (libro de incidentes).
 *
 * 2 tests:
 *  1. Alta ambos tipos + listado + filtro: empty state → registrar casi_accidente
 *     (Lesión oculta) → registrar accidente (Lesión visible, gravedad) → listado
 *     muestra ambos → filtro tipo=accidente deja sólo el accidente.
 *  2. Ciclo de vida sobre un accidente seedeado: corregir (cambia lugar) →
 *     historial muestra versión previa → anular (motivo) → sale del libro vigente.
 *
 * Cleanup: borramos incidentes (FK ON DELETE RESTRICT sobre clientes/empleados)
 * → empleados → clientes → user, por consultora.
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
    await adminClient.from('incidentes').delete().eq('consultora_id', consultoraId);
    await adminClient.from('empleados').delete().eq('consultora_id', consultoraId);
    await adminClient.from('clientes').delete().eq('consultora_id', consultoraId);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Accidentabilidad · libro de incidentes (T-063)', () => {
  test('alta casi_accidente + accidente → listado → filtro por tipo', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueTestEmail('inc-alta');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-063 alta ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    await loginViaUI(page, email, password);

    // Navegar desde el sidebar — confirma que Accidentabilidad está live.
    const sidebar = page.getByRole('complementary', { name: 'Barra lateral' });
    await sidebar.getByRole('link', { name: 'Accidentabilidad' }).click();
    await expect(page).toHaveURL(/\/accidentabilidad$/, { timeout: 10_000 });
    await expect(page.getByText('Todavía no registraste incidentes')).toBeVisible();

    // ── Alta casi_accidente (tipo por defecto) ──────────────────────────────
    await page.getByRole('link', { name: 'Registrar primer incidente' }).click();
    await expect(page).toHaveURL(/\/accidentabilidad\/nuevo$/);

    // Por defecto tipo=casi_accidente → la sección Lesión NO se muestra.
    // Apuntamos al heading exacto: `getByText('Lesión')` matchea por substring
    // case-insensitive y pescaría "(sin/con lesión)" de los labels del Select.
    await expect(page.getByRole('heading', { name: 'Lesión' })).toHaveCount(0);

    const descCasi = `Casi-accidente E2E ${Date.now().toString(36)}`;
    await page.getByLabel(/Fecha/).fill('2020-06-01');
    await page.getByLabel(/Qué pasó/).fill(descCasi);
    await page.getByRole('button', { name: /Registrar incidente/i }).click();

    await expect(page).toHaveURL(/\/accidentabilidad\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    await expect(page.getByText('Casi-accidente (sin lesión)')).toBeVisible();

    // DB sanity.
    const { data: casiRows } = await adminClient
      .from('incidentes')
      .select('id, tipo, descripcion, created_by')
      .eq('consultora_id', consultoraId);
    expect(casiRows).toHaveLength(1);
    expect(casiRows![0]!.tipo).toBe('casi_accidente');
    expect(casiRows![0]!.created_by).toBe(userId);

    // ── Alta accidente (con lesión) ─────────────────────────────────────────
    await page.goto('/accidentabilidad/nuevo');
    // Cambiar el tipo a "Accidente (con lesión)" → aparece la sección Lesión.
    // El trigger de Radix es un <button role=combobox> sin label asociable de
    // forma fiable → lo ubicamos por su valor actual ("Casi-accidente …").
    await page.getByRole('combobox').filter({ hasText: 'Casi-accidente' }).click();
    await page.getByRole('option', { name: 'Accidente (con lesión)' }).click();
    await expect(page.getByRole('heading', { name: 'Lesión' })).toBeVisible();

    const descAcc = `Accidente E2E ${Date.now().toString(36)}`;
    await page.getByLabel(/Fecha/).fill('2020-06-02');
    await page.getByLabel(/Qué pasó/).fill(descAcc);
    // Gravedad (requerida para accidente). El trigger muestra el placeholder.
    await page.getByRole('combobox').filter({ hasText: 'Elegí la gravedad' }).click();
    await page.getByRole('option', { name: 'Grave (baja prolongada)' }).click();
    await page.getByRole('button', { name: /Registrar incidente/i }).click();

    await expect(page).toHaveURL(/\/accidentabilidad\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    await expect(page.getByText('Accidente (con lesión)').first()).toBeVisible();
    await expect(page.getByText('Grave (baja prolongada)').first()).toBeVisible();

    // ── Listado + filtro por tipo ───────────────────────────────────────────
    await page.goto('/accidentabilidad');
    await expect(page.getByText(descCasi)).toBeVisible();
    await expect(page.getByText(descAcc)).toBeVisible();

    // Filtrar por tipo=accidente → sólo queda el accidente. El Select de filtro
    // tiene id estable (`#filtro-tipo`).
    await page.locator('#filtro-tipo').click();
    await page.getByRole('option', { name: 'Accidente (con lesión)' }).click();
    await expect(page).toHaveURL(/tipo=accidente/, { timeout: 10_000 });
    await expect(page.getByText(descAcc)).toBeVisible();
    await expect(page.getByText(descCasi)).toHaveCount(0);
  });

  test('corregir + historial + anular sobre un accidente seedeado', async ({ page }) => {
    test.setTimeout(90_000);
    const email = uniqueTestEmail('inc-ciclo');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-063 ciclo ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    const descOriginal = `Atrapamiento ${Date.now().toString(36)}`;
    const { data: seed, error } = await adminClient
      .from('incidentes')
      .insert({
        consultora_id: consultoraId,
        created_by: userId,
        tipo: 'accidente',
        fecha: '2020-06-01',
        descripcion: descOriginal,
        gravedad: 'grave',
        lugar_especifico: 'Sector original',
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    const incidenteId = seed!.id;

    await loginViaUI(page, email, password);
    await page.goto(`/accidentabilidad/${incidenteId}`);
    await expect(page.getByText(descOriginal)).toBeVisible();

    // ── Corregir: cambiar el lugar específico ───────────────────────────────
    await page.getByRole('link', { name: 'Corregir' }).click();
    await expect(page).toHaveURL(new RegExp(`/accidentabilidad/${incidenteId}/corregir$`));

    const lugarInput = page.getByLabel('Lugar específico');
    await expect(lugarInput).toHaveValue('Sector original');
    await lugarInput.fill('Sector corregido');
    await page.getByRole('button', { name: /Guardar corrección/i }).click();

    // Cae en el detalle de la versión vigente (nuevo id) con el historial visible.
    await expect(page).toHaveURL(/\/accidentabilidad\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    await expect(page.getByText('Sector corregido')).toBeVisible();
    await expect(page.getByText('Historial de correcciones')).toBeVisible();

    // DB sanity: hay 2 registros, uno superseded por el otro vía corrige_id.
    const { data: rows } = await adminClient
      .from('incidentes')
      .select('id, corrige_id, lugar_especifico, anulacion')
      .eq('consultora_id', consultoraId)
      .order('created_at', { ascending: true });
    expect(rows).toHaveLength(2);
    const corrected = rows!.find((r) => r.corrige_id === incidenteId);
    expect(corrected?.lugar_especifico).toBe('Sector corregido');
    const vigenteId = corrected!.id;

    // ── Anular el registro vigente ──────────────────────────────────────────
    await page.goto(`/accidentabilidad/${vigenteId}`);
    await page.getByRole('button', { name: 'Anular', exact: true }).click();
    await expect(page.getByText('¿Anular este incidente?')).toBeVisible();
    await page.getByLabel('Motivo de la anulación').fill('Cargado por error en el simulacro.');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Anular incidente' }).click();
    await expect(page.getByText('Incidente anulado')).toBeVisible({ timeout: 10_000 });

    // Ya no aparece en el libro vigente.
    await page.goto('/accidentabilidad');
    await expect(page.getByText('Sector corregido')).toHaveCount(0);

    // DB sanity: existe un tombstone anulacion=true apuntando al vigente.
    const { data: tombstone } = await adminClient
      .from('incidentes')
      .select('id, anulacion, corrige_id')
      .eq('consultora_id', consultoraId)
      .eq('anulacion', true)
      .maybeSingle();
    expect(tombstone?.corrige_id).toBe(vigenteId);
  });
});
