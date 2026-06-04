/**
 * T-061b · E2E punta a punta del cierre de inspecciones (cierra el módulo).
 *
 * Flujo (mobile-first): seed template publicado + cliente → login (owner) → Nueva
 * → runner → responder "No cumple" (genera 1 CAPA) → CTA "Cerrar y firmar" →
 * /[id]/cerrar → preview de la CAPA + firmar el canvas + nombre del matriculado →
 * cerrar → detalle: score + "Acciones correctivas (1)" + deep-link al calendario
 * → DB: execution cerrada + acciones_correctivas con calendar_event → Descargar
 * PDF (magic bytes %PDF-) → Anular (motivo) → banner "anulada" + sin PDF/anular +
 * tombstone en DB.
 *
 * Pre-requisito PDF: CHROMIUM_PATH válido (ver informes-pdf-export.spec.ts). Sin
 * él el endpoint /pdf da 500. CI Ubuntu OK con retries; local Windows export.
 *
 * Cleanup: acciones + calendar_events + executions + templates + clientes del
 * tenant, luego el user.
 */
import { promises as fs } from 'node:fs';
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

// Mobile-first: el matriculado firma en obra desde el celular.
test.use({ viewport: { width: 390, height: 844 } });

test.afterEach(async () => {
  for (const consultoraId of createdConsultoraIds.splice(0)) {
    await adminClient.from('acciones_correctivas').delete().eq('consultora_id', consultoraId);
    await adminClient.from('calendar_events').delete().eq('consultora_id', consultoraId);
    await adminClient.from('checklist_executions').delete().eq('consultora_id', consultoraId);
    await adminClient.from('checklist_templates').delete().eq('consultora_id', consultoraId);
    await adminClient.from('clientes').delete().eq('consultora_id', consultoraId);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

/** Template publicado chico: 1 sección, 1 ítem cumple_no_aplica requerido. */
async function seedPublishedTemplate(consultoraId: string, nombre: string): Promise<void> {
  const { data: tpl } = await adminClient
    .from('checklist_templates')
    .insert({ consultora_id: consultoraId, nombre, tipo_inspeccion: 'generico' })
    .select('id')
    .single();

  const { data: version } = await adminClient
    .from('checklist_template_versions')
    .insert({
      template_id: tpl!.id,
      consultora_id: consultoraId,
      version_number: 1,
      estado: 'published',
      published_at: new Date(0).toISOString(),
    })
    .select('id')
    .single();

  const { data: section } = await adminClient
    .from('template_sections')
    .insert({ version_id: version!.id, consultora_id: consultoraId, orden: 1, titulo: 'Seguridad' })
    .select('id')
    .single();

  await adminClient.from('template_items').insert({
    section_id: section!.id,
    version_id: version!.id,
    consultora_id: consultoraId,
    orden: 1,
    texto: 'Extintores señalizados',
    response_type: 'cumple_no_aplica',
    es_requerido: true,
  });
}

test.describe('Inspecciones · cierre + detalle + PDF + anular (T-061b)', () => {
  test('relevar → cerrar/firmar → CAPA en calendario → PDF → anular', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = Date.now().toString(36);
    const email = uniqueTestEmail('insp-cierre');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-061b ${stamp}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    const nombre = `Insp Cierre ${stamp}`;
    await seedPublishedTemplate(consultoraId, nombre);
    await adminClient.from('clientes').insert({
      consultora_id: consultoraId,
      razon_social: `ACME Cierre ${stamp}`,
      cuit: `30-${Date.now().toString().slice(-8)}-9`,
    });

    await loginViaUI(page, email, password);

    // Nueva inspección → template + cliente → runner.
    await page.goto('/checklists/ejecuciones/nueva');
    await page.getByLabel('Template').click();
    await page.getByRole('option', { name: nombre }).click();
    await page.getByLabel('Cliente').click();
    await page.getByRole('option', { name: `ACME Cierre ${stamp}` }).click();
    await page.getByRole('button', { name: /Comenzar inspección/i }).click();

    await expect(page).toHaveURL(/\/checklists\/ejecuciones\/[0-9a-f-]{36}$/, { timeout: 10_000 });
    const executionId = page.url().split('/').pop()!;

    // Responder "No cumple" (genera CAPA) → autosave.
    await page.getByText('No cumple', { exact: true }).click();
    await expect(page.getByText('Guardado')).toBeVisible({ timeout: 10_000 });

    // CTA owner → /[id]/cerrar.
    await page.getByRole('link', { name: /Cerrar y firmar inspección/i }).click();
    await expect(page).toHaveURL(new RegExp(`/checklists/ejecuciones/${executionId}/cerrar$`), {
      timeout: 10_000,
    });

    // Preview de la CAPA a generar.
    await expect(page.getByText(/Se generarán 1 acción/i)).toBeVisible();
    await expect(page.getByTestId('capa-preview')).toBeVisible();

    // Firmar el canvas (pointer drag) + nombre del matriculado.
    await page.getByLabel(/Nombre del matriculado/i).fill('Ing. Juana Pérez');
    const canvas = page.getByRole('img', { name: /Pad de firma/i });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas de firma sin boundingBox');
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 10 });
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.3, { steps: 10 });
    await page.mouse.up();

    const submit = page.getByRole('button', { name: 'Cerrar y firmar inspección' });
    await expect(submit).toBeEnabled();
    await submit.click();

    // → detalle de la cerrada.
    await expect(page).toHaveURL(new RegExp(`/checklists/ejecuciones/${executionId}$`), {
      timeout: 15_000,
    });
    await expect(page.getByText(/Acciones correctivas \(1\)/)).toBeVisible({ timeout: 10_000 });

    // DB: execution cerrada + 1 CAPA con calendar_event.
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from('checklist_executions')
            .select('estado')
            .eq('id', executionId)
            .maybeSingle();
          return data?.estado ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe('cerrada');

    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from('acciones_correctivas')
            .select('calendar_event_id')
            .eq('execution_id', executionId);
          return (data ?? []).filter((a) => a.calendar_event_id != null).length;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);

    // Deep-link al calendario (event + month).
    const calLink = page.getByRole('link', { name: /Ver en el calendario/i });
    await expect(calLink).toHaveAttribute(
      'href',
      /\/calendario\?event=[0-9a-f-]{36}&month=\d{4}-\d{2}/,
    );

    // Descargar PDF (magic bytes %PDF-).
    const pdfLink = page.getByRole('link', { name: /Descargar PDF/i });
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      pdfLink.click(),
    ]);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('download.path() null');
    const fd = await fs.open(downloadPath, 'r');
    try {
      const buf = Buffer.alloc(5);
      await fd.read(buf, 0, 5, 0);
      expect(buf.toString('ascii')).toBe('%PDF-');
    } finally {
      await fd.close();
    }

    // Anular (motivo obligatorio) → banner + sin PDF/anular.
    await page.getByRole('button', { name: 'Anular' }).click();
    await page.getByLabel(/Motivo de la anulación/i).fill('Cargada por error en el E2E');
    await page.getByRole('button', { name: 'Anular inspección' }).click();

    await expect(page.getByText(/Esta inspección fue anulada/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: /Descargar PDF/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Anular' })).toHaveCount(0);

    // DB: tombstone que corrige a la cerrada.
    await expect
      .poll(
        async () => {
          const { count } = await adminClient
            .from('checklist_executions')
            .select('id', { count: 'exact', head: true })
            .eq('corrige_id', executionId)
            .eq('anulacion', true);
          return count ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThan(0);
  });
});
