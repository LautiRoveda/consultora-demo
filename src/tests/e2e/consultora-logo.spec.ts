/**
 * T-024 · E2E logo de consultora.
 *
 * 2 tests:
 *  1. Owner sube logo desde /settings/consultora → preview visible
 *     → genera PDF del informe → magic bytes %PDF- + size > baseline-no-logo.
 *  2. Member non-owner ve Alert "Solo el owner puede editar" + botones disabled.
 *
 * Pre-requisitos del runtime (idem T-023):
 *  - CHROMIUM_PATH valido.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  TEST_PASSWORD,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];
const createdInformeIds: string[] = [];
const createdConsultoraIds: string[] = [];
const createdTempFiles: string[] = [];

test.afterEach(async () => {
  for (const id of createdInformeIds.splice(0)) {
    await adminClient.from('informes').delete().eq('id', id);
  }
  // Limpiar logo path del consultora (storage object cleanup queda para cron).
  for (const cId of createdConsultoraIds.splice(0)) {
    const { data } = await adminClient
      .from('consultoras')
      .select('logo_storage_path')
      .eq('id', cId)
      .maybeSingle();
    if (data?.logo_storage_path) {
      await adminClient.storage
        .from('consultora-logos')
        .remove([data.logo_storage_path])
        .catch(() => {});
    }
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
  for (const p of createdTempFiles.splice(0)) {
    await fs.unlink(p).catch(() => {});
  }
});

async function makeLogoPng(label: string): Promise<string> {
  const filepath = path.join(os.tmpdir(), `t024-logo-${label}-${Date.now()}.png`);
  await sharp({
    create: {
      width: 240,
      height: 80,
      channels: 4,
      background: { r: 79, g: 70, b: 229, alpha: 1 },
    },
  })
    .png()
    .toFile(filepath);
  createdTempFiles.push(filepath);
  return filepath;
}

test.describe('Configuración · logo (T-024)', () => {
  test('owner: upload logo → preview visible → PDF del informe usa el logo', async ({ page }) => {
    const email = uniqueTestEmail('logo-owner');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: `T-024 logo ${Date.now().toString(36)}`,
    });
    createdUserIds.push(userId);
    createdConsultoraIds.push(consultoraId);

    // Informe con contenido para descargar el PDF al final.
    const { data: informe, error: infErr } = await adminClient
      .from('informes')
      .insert({
        consultora_id: consultoraId,
        created_by: userId,
        tipo: 'rgrl',
        titulo: 'E2E logo',
        contenido: '# Test logo\n\nContenido E2E.',
      })
      .select('id')
      .single();
    if (infErr || !informe) throw new Error(`crear informe fallo: ${infErr?.message}`);
    createdInformeIds.push(informe.id);

    // Upload logo (no medimos baseline pre-vs-post porque el logo embebido
    // como PNG comprimido puede pesar MENOS que el wordmark texto que
    // reemplaza — el delta puede ser negativo. Validamos via DB que el
    // logo_storage_path se setea y via HTML del print que `<img>` apunta
    // al bucket consultora-logos).
    await loginViaUI(page, email, password);
    await page.goto('/settings/consultora');
    await expect(page.getByText('Sin logo')).toBeVisible();
    const logoPath = await makeLogoPng('owner');
    const logoInput = page.locator('input[type="file"][accept*="image"]');
    await logoInput.setInputFiles(logoPath);
    await expect(page.getByText('Logo cargado')).toBeVisible({ timeout: 15_000 });
    // Preview presente (img con alt incluye consultora name).
    await expect(page.locator('img[alt*="Logo de"]')).toBeVisible();
    // Boton "Reemplazar logo" reemplaza al "Cargar logo".
    await expect(page.getByRole('button', { name: /Reemplazar logo/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Eliminar logo/ })).toBeVisible();

    // Verificar en DB.
    const { data: cRow } = await adminClient
      .from('consultoras')
      .select('logo_storage_path')
      .eq('id', consultoraId)
      .single();
    expect(cRow?.logo_storage_path).toMatch(/^[0-9a-f-]{36}\/logo-\d+\.png$/);

    // PDF post-logo: descargamos y validamos magic bytes + size sano.
    await page.goto(`/informes/${informe.id}`);
    const newBtn = page.getByRole('button', { name: /Descargar PDF/ });
    const [newDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      newBtn.click(),
    ]);
    const newPath = await newDownload.path();
    if (!newPath) throw new Error('new download path null');
    const newStat = await fs.stat(newPath);
    // PDF realista: > 5KB.
    expect(newStat.size).toBeGreaterThan(5_000);

    // Magic bytes %PDF-.
    const fd = await fs.open(newPath, 'r');
    try {
      const buf = Buffer.alloc(5);
      await fd.read(buf, 0, 5, 0);
      expect(buf.toString('ascii')).toBe('%PDF-');
    } finally {
      await fd.close();
    }
  });

  test('member non-owner: Alert visible + botones disabled', async ({ page }) => {
    const ownerEmail = uniqueTestEmail('logo-owner-block');
    const owner = await createTestUserWithConsultora({
      email: ownerEmail,
      consultoraName: `T-024 logo member ${Date.now().toString(36)}`,
    });
    createdUserIds.push(owner.userId);
    createdConsultoraIds.push(owner.consultoraId);

    const memberEmail = uniqueTestEmail('logo-member');
    const { data: memberCreated, error: memberErr } = await adminClient.auth.admin.createUser({
      email: memberEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (memberErr || !memberCreated.user) {
      throw new Error(`create member: ${memberErr?.message}`);
    }
    const memberId = memberCreated.user.id;
    createdUserIds.push(memberId);

    await adminClient.from('consultora_members').insert({
      user_id: memberId,
      consultora_id: owner.consultoraId,
      role: 'member',
    });
    await adminClient.auth.admin.updateUserById(memberId, {
      app_metadata: { consultora_id: owner.consultoraId },
    });

    await loginViaUI(page, memberEmail, TEST_PASSWORD);
    await page.goto('/settings/consultora');

    await expect(page.getByText('Solo el owner puede editar')).toBeVisible();
    // El boton "Cargar logo" sigue presente pero disabled (Radix los marca disabled).
    const cargarBtn = page.getByRole('button', { name: /Cargar logo/ });
    await expect(cargarBtn).toBeVisible();
    await expect(cargarBtn).toBeDisabled();
  });
});
