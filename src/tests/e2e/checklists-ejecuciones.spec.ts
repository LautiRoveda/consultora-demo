/**
 * T-061a · E2E del runner de inspecciones (mobile-first).
 *
 * Flujo: seed de un template publicado + cliente (adminClient) → login → listado
 * de Inspecciones → Nueva → elegir template + cliente → runner → responder ítem
 * (autosave "Guardado" + fila en execution_respuestas) → foto (thumbnail + fila en
 * execution_adjuntos) → card de cierre. Guard: anular el borrador por fuera →
 * el siguiente save da EXEC_NOT_DRAFT → el runner pasa a read-only.
 *
 * El cierre con firma + el PDF + el calendario se prueban en el E2E de T-061b.
 *
 * Cleanup: borramos executions (cascade) + templates del tenant + el user.
 */
import { expect, test } from '@playwright/test';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

// PNG 1x1 válido (magic bytes correctos) para la evidencia.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const createdUserIds: string[] = [];
const createdConsultoraIds: string[] = [];

// Mobile-first: el caso de uso de T-061 es el celular en campo.
test.use({ viewport: { width: 390, height: 844 } });

test.afterEach(async () => {
  for (const consultoraId of createdConsultoraIds.splice(0)) {
    const { data: tpls } = await adminClient
      .from('checklist_templates')
      .select('id')
      .eq('consultora_id', consultoraId);
    for (const t of tpls ?? []) {
      const { data: versions } = await adminClient
        .from('checklist_template_versions')
        .select('id')
        .eq('template_id', t.id);
      for (const v of versions ?? []) {
        await adminClient.from('checklist_executions').delete().eq('template_version_id', v.id);
      }
    }
    await adminClient.from('checklist_templates').delete().eq('consultora_id', consultoraId);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

/** Seedea un template publicado chico (1 sección, 1 ítem cumple_no_aplica requerido). */
async function seedPublishedTemplate(consultoraId: string, nombre: string): Promise<string> {
  const { data: tpl } = await adminClient
    .from('checklist_templates')
    .insert({ consultora_id: consultoraId, nombre, tipo_inspeccion: 'generico' })
    .select('id')
    .single();
  const templateId = tpl!.id;

  const { data: version } = await adminClient
    .from('checklist_template_versions')
    .insert({
      template_id: templateId,
      consultora_id: consultoraId,
      version_number: 1,
      estado: 'published',
      published_at: new Date(0).toISOString(),
    })
    .select('id')
    .single();
  const versionId = version!.id;

  const { data: section } = await adminClient
    .from('template_sections')
    .insert({ version_id: versionId, consultora_id: consultoraId, orden: 1, titulo: 'Seguridad' })
    .select('id')
    .single();

  await adminClient.from('template_items').insert({
    section_id: section!.id,
    version_id: versionId,
    consultora_id: consultoraId,
    orden: 1,
    texto: 'Extintores señalizados',
    response_type: 'cumple_no_aplica',
    es_requerido: true,
  });

  return templateId;
}

test.describe('Inspecciones · runner (T-061a)', () => {
  test('nueva → relevar sección → autosave + foto → DB; guard EXEC_NOT_DRAFT', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now().toString(36);
    const email = uniqueTestEmail('insp-runner');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-061a ${stamp}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    const nombre = `Insp E2E ${stamp}`;
    await seedPublishedTemplate(consultoraId, nombre);
    await adminClient.from('clientes').insert({
      consultora_id: consultoraId,
      razon_social: `ACME E2E ${stamp}`,
      cuit: `30-${Date.now().toString().slice(-8)}-9`,
    });

    await loginViaUI(page, email, password);

    // Listado vacío → CTA Nueva inspección.
    await page.goto('/checklists/ejecuciones');
    await expect(page.getByText('Todavía no hay inspecciones')).toBeVisible({ timeout: 10_000 });
    await page
      .getByRole('link', { name: /Nueva inspección/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/checklists\/ejecuciones\/nueva/, { timeout: 10_000 });

    // Elegir template + cliente y comenzar.
    await page.getByLabel('Template').click();
    await page.getByRole('option', { name: nombre }).click();
    await page.getByLabel('Cliente').click();
    await page.getByRole('option', { name: `ACME E2E ${stamp}` }).click();
    await page.getByRole('button', { name: /Comenzar inspección/i }).click();

    // Runner.
    await expect(page).toHaveURL(/\/checklists\/ejecuciones\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    const executionId = page.url().split('/').pop()!;
    await expect(page.getByText('Seguridad')).toBeVisible();
    await expect(page.getByText('Extintores señalizados')).toBeVisible();

    // Responder "Cumple" → autosave.
    await page.getByRole('radio', { name: 'Cumple' }).click();
    await expect(page.getByText('Guardado')).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from('execution_respuestas')
            .select('valor')
            .eq('execution_id', executionId);
          return (data ?? []).map((r) => r.valor).join(',');
        },
        { timeout: 10_000 },
      )
      .toBe('si');

    // Foto del hallazgo → thumbnail + fila en execution_adjuntos.
    await page.locator('input[type="file"]').setInputFiles({
      name: 'evidencia.png',
      mimeType: 'image/png',
      buffer: PNG_1X1,
    });
    await expect(page.getByAltText('Foto del hallazgo')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () => {
          const { count } = await adminClient
            .from('execution_adjuntos')
            .select('id', { count: 'exact', head: true })
            .eq('execution_id', executionId);
          return count ?? 0;
        },
        { timeout: 15_000 },
      )
      .toBeGreaterThan(0);

    // Sección única = última → card de cierre (owner).
    await expect(page.getByText(/vas a poder cerrar y firmar/i)).toBeVisible();

    // Guard: anular el borrador por fuera → el próximo save da EXEC_NOT_DRAFT.
    await adminClient
      .from('checklist_executions')
      .update({ estado: 'anulada' })
      .eq('id', executionId);

    await page.getByRole('radio', { name: 'No cumple' }).click();
    await expect(page.getByText(/ya fue cerrada o anulada/i)).toBeVisible({ timeout: 10_000 });
  });
});
