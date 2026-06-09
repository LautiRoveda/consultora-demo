/**
 * T-061a · E2E del runner de inspecciones (mobile-first).
 *
 * Flujo: seed de un template publicado + cliente (adminClient) → login → listado
 * de Inspecciones → Nueva → elegir template + cliente → runner → responder ítem
 * (autosave "Guardado" + fila en execution_respuestas) → foto (thumbnail + fila en
 * execution_adjuntos) → card de cierre.
 *
 * El guard EXEC_NOT_DRAFT (anular el borrador por fuera → el runner pasa a read-only)
 * vive en su propio caso aislado (T-132): sin foto ni save previo, cero escrituras
 * antes del `anulada`, así no hay ningún revalidatePath en vuelo que pueda swappear la
 * página a la vista de detalle y desmontar el toggle (la carrera que volvía flaky a
 * este mega-caso). El cierre con firma + el PDF + el calendario se prueban en T-061b.
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
  test('nueva → relevar sección → autosave + foto → DB', async ({ page }) => {
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

    // Responder "Cumple" → autosave. El radio es sr-only (no actionable en Playwright):
    // clickeamos el <label> visible (el target táctil real). exact: "Cumple" ⊂ "No cumple".
    await page.getByText('Cumple', { exact: true }).click();
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

    // Sección única = última + ítem obligatorio respondido → CTA de cierre (owner, T-061b).
    await expect(page.getByRole('link', { name: /Cerrar y firmar inspección/i })).toBeVisible();
  });

  // T-132 · Guard EXEC_NOT_DRAFT, aislado y determinístico. Cero escrituras antes del
  // `anulada` (sin foto ni save previo) → ningún revalidatePath en vuelo → page.tsx no
  // puede swappear al detalle y desmontar el toggle mientras Playwright clickea. Antes,
  // embebido en el mega-caso, el revalidate de la foto a veces llegaba DESPUÉS del anular
  // y la página rendereaba EjecucionDetailView: el locator "No cumple" no resolvía y el
  // click colgaba hasta el timeout. El borrador se siembra directo (mismas columnas que
  // createEjecucionAction) para no depender del wizard de creación.
  test('guard EXEC_NOT_DRAFT · anular por fuera → save rechazado + runner read-only', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const stamp = Date.now().toString(36);
    const email = uniqueTestEmail('insp-guard');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-132 ${stamp}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    const templateId = await seedPublishedTemplate(consultoraId, `Insp guard ${stamp}`);
    const { data: ver } = await adminClient
      .from('checklist_template_versions')
      .select('id')
      .eq('template_id', templateId)
      .eq('estado', 'published')
      .single();
    const { data: cli } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: consultoraId,
        razon_social: `ACME guard ${stamp}`,
        cuit: `30-${Date.now().toString().slice(-8)}-9`,
      })
      .select('id')
      .single();

    const { data: exec } = await adminClient
      .from('checklist_executions')
      .insert({
        consultora_id: consultoraId,
        template_version_id: ver!.id,
        cliente_id: cli!.id,
        estado: 'borrador',
        inspector_user_id: userId,
        fecha_inspeccion: new Date().toISOString().slice(0, 10),
        created_by: userId,
      })
      .select('id')
      .single();
    const executionId = exec!.id;

    await loginViaUI(page, email, password);
    await page.goto(`/checklists/ejecuciones/${executionId}`);

    // Runner montado + hidratado: los asserts + el round-trip del anular dan tiempo de
    // sobra a la hidratación (el mega-caso prueba que este mismo preámbulo basta).
    await expect(page.getByText('Seguridad')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Extintores señalizados')).toBeVisible();
    await expect(page.getByText('No cumple', { exact: true })).toBeVisible();

    // Anular por fuera (el cliente no se entera) → el próximo save da EXEC_NOT_DRAFT.
    await adminClient
      .from('checklist_executions')
      .update({ estado: 'anulada' })
      .eq('id', executionId);

    await page.getByText('No cumple', { exact: true }).click();

    // (1) Cadena disparada: onChange → saveRespuestaAction → EXEC_NOT_DRAFT → onFrozen → banner.
    await expect(page.getByText(/ya fue cerrada o anulada/i)).toBeVisible({ timeout: 10_000 });

    // (2) Escritura rechazada (assert objetivo y persistente, no un toast efímero): el guard
    // no insertó la respuesta → execution_respuestas sigue vacío para esta ejecución. El
    // assert (1) ya descarta un click perdido, así que (2) confirma el rechazo del write.
    await expect
      .poll(
        async () => {
          const { count } = await adminClient
            .from('execution_respuestas')
            .select('id', { count: 'exact', head: true })
            .eq('execution_id', executionId);
          return count ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBe(0);
  });
});
