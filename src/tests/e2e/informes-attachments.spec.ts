/**
 * T-024 · E2E happy path de attachments en informes.
 *
 * Flow:
 *  1. Setup: user + consultora + informe RGRL con contenido (via service-role).
 *  2. Login UI → /informes/[id]/editar.
 *  3. Upload imagen PNG (700x500 cyan, generada inline con sharp).
 *  4. Upload archivo PDF (mock minimo).
 *  5. Editar caption de la imagen via onBlur.
 *  6. Subir una segunda imagen, reorder con flecha up → la segunda pasa primero.
 *  7. Delete del archivo PDF (confirm via AlertDialog).
 *  8. Descargar PDF del informe → magic bytes `%PDF-` + size > baseline post-attachments.
 *
 * Pre-requisitos del runtime (idem T-023):
 *  - CHROMIUM_PATH apuntando a un Chromium/Chrome valido.
 *  - Sharp instalado (dep directa de T-024).
 *
 * Correr local: `set -a && source .env.local && set +a &&
 *   CHROMIUM_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"
 *   pnpm test:e2e --grep "Informes · attachments"`.
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
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];
const createdInformeIds: string[] = [];
const createdTempFiles: string[] = [];

test.afterEach(async () => {
  for (const id of createdInformeIds.splice(0)) {
    await adminClient.from('informes').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
  for (const p of createdTempFiles.splice(0)) {
    await fs.unlink(p).catch(() => {});
  }
});

async function makeTempPng(width: number, height: number, label: string): Promise<string> {
  const filepath = path.join(os.tmpdir(), `t024-${label}-${Date.now()}.png`);
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 6, g: 182, b: 212, alpha: 1 },
    },
  })
    .png()
    .toFile(filepath);
  createdTempFiles.push(filepath);
  return filepath;
}

async function makeTempPdf(label: string): Promise<string> {
  const filepath = path.join(os.tmpdir(), `t024-${label}-${Date.now()}.pdf`);
  // PDF minimo valido (4 objetos + xref + trailer).
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj
xref
0 4
0000000000 65535 f
0000000010 00000 n
0000000053 00000 n
0000000100 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
156
%%EOF`;
  await fs.writeFile(filepath, pdf);
  createdTempFiles.push(filepath);
  return filepath;
}

test.describe('Informes · attachments (T-024)', () => {
  // FLAKY: ver issue #56 — Puppeteer cross-worker en Windows sin
  // CHROMIUM_PATH provoca timeout. CI Ubuntu OK con retries=2 + Chromium
  // pre-instalado. Local Windows: export CHROMIUM_PATH antes de correr.
  // Smoke productivo del runbook valida real flow. NO investigar mas sin
  // demanda real.
  test('happy path: upload image + file + caption + reorder + delete + download PDF', async ({
    page,
  }) => {
    // T-022.5-FU4: el test entero requiere mas de 30s en CI cargado. Pasos:
    // setup admin + login UI + 3 uploads + caption + reorder + delete +
    // navegar a detail + PDF render con 2 imagenes embebidas (Puppeteer cold
    // start + signed URL fetch Supabase Storage). 90s es buffer comodo; el
    // waitForEvent('download') de 60s tambien queda dentro de este budget.
    // Sin esto, el cap global default de Playwright (30s) capa el bump del
    // waitForEvent.
    test.setTimeout(90_000);

    const email = uniqueTestEmail('att-happy');
    const consultoraName = `T-024 attachments ${Date.now().toString(36)}`;
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    // Informe con contenido (mismo patron T-023).
    const { data: informe, error: infErr } = await adminClient
      .from('informes')
      .insert({
        consultora_id: consultoraId,
        created_by: userId,
        tipo: 'rgrl',
        titulo: 'E2E attachments T-024',
        contenido: '# Informe E2E\n\n## 1. Resumen\n\nContenido para validar attachments.',
      })
      .select('id')
      .single();
    if (infErr || !informe) throw new Error(`crear informe fallo: ${infErr?.message}`);
    createdInformeIds.push(informe.id);

    await loginViaUI(page, email, password);
    await page.goto(`/informes/${informe.id}/editar`);

    // 1. Empty state visible.
    await expect(page.getByText('No hay adjuntos todavía')).toBeVisible();

    // 2. Upload primera imagen.
    const png1Path = await makeTempPng(700, 500, 'img1');
    const imageInputFirst = page.locator('input[type="file"][accept*="image"]');
    await imageInputFirst.setInputFiles(png1Path);
    await expect(page.getByText(/Imágenes \(1\)/)).toBeVisible({ timeout: 15_000 });

    // 3. Upload PDF.
    const pdfPath = await makeTempPdf('doc');
    const fileInput = page.locator('input[type="file"][accept*="application/pdf"]');
    await fileInput.setInputFiles(pdfPath);
    await expect(page.getByText(/Archivos \(1\)/)).toBeVisible({ timeout: 15_000 });

    // 4. Editar caption de la primera imagen.
    const captionInput = page.getByPlaceholder('Caption opcional').first();
    await captionInput.fill('Foto sector taller');
    await captionInput.blur();
    // El onBlur dispara la action; esperamos a que el toast aparezca.
    await expect(page.getByText('Caption guardado')).toBeVisible({ timeout: 10_000 });

    // 5. Upload segunda imagen para tener candidato a reorder.
    const png2Path = await makeTempPng(600, 400, 'img2');
    await imageInputFirst.setInputFiles(png2Path);
    await expect(page.getByText(/Imágenes \(2\)/)).toBeVisible({ timeout: 15_000 });

    // 6. Reorder: la segunda imagen (idx 1) la pasamos a idx 0 con flecha up.
    const moveUpButtons = page.getByRole('button', { name: 'Mover arriba' });
    await expect(moveUpButtons).toHaveCount(2);
    await moveUpButtons.nth(1).click();

    // Validamos via DB que las posiciones reflejan el reorder. RLS lo lee
    // como el user owner. T-024-FU6: poll en lugar de waitForTimeout(800)
    // — en CI las 2 UPDATEs + RLS checks + router.refresh() tardan mas de
    // 800ms ciegos. El poll reintenta hasta 10s o hasta que el orden
    // observado coincida con el esperado.
    // El que llego "segundo" (sin caption) deberia estar ahora en posicion 0
    // (porque clickeamos "Mover arriba" sobre la segunda).
    await expect
      .poll(
        async () => {
          const { data } = await adminClient
            .from('informe_attachments')
            .select('caption, position')
            .eq('informe_id', informe.id)
            .eq('kind', 'image')
            .order('position', { ascending: true });
          return (data ?? []).map((a) => a.caption);
        },
        { timeout: 10_000 },
      )
      .toEqual([null, 'Foto sector taller']);

    // 7. Delete del PDF con AlertDialog.
    const deleteButtons = page.getByRole('button', { name: 'Eliminar adjunto' });
    // 3 attachments: 2 images + 1 file → 3 delete buttons.
    await expect(deleteButtons).toHaveCount(3);
    // El boton de delete del file PDF es el ultimo (orden: imagen idx 0,
    // imagen idx 1, file).
    await deleteButtons.last().click();
    await expect(page.getByText(/Vas a eliminar/)).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(page.getByText('Adjunto eliminado')).toBeVisible({ timeout: 10_000 });
    // La seccion Archivos desaparece (count = 0).
    await expect(page.getByText(/Archivos \(\d\)/)).toHaveCount(0);

    // 8. Descargar PDF del informe (mismo flow T-023 pero con attachments).
    await page.goto(`/informes/${informe.id}`);
    const downloadBtn = page.getByRole('button', { name: /Descargar PDF/ });
    await expect(downloadBtn).toBeEnabled();

    // T-022.5-FU4: bump 30s→60s. PDF con anexos visuales requiere Puppeteer
    // cold start + fetch de signed URLs Supabase Storage; CI runner cargado
    // roza el cap default.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      downloadBtn.click(),
    ]);
    const downloadPath = await download.path();
    if (!downloadPath) throw new Error('download.path() null');

    const stat = await fs.stat(downloadPath);
    // Con 2 imagenes embebidas el PDF tiene > 10 KB facil.
    expect(stat.size).toBeGreaterThan(10_000);

    const fd = await fs.open(downloadPath, 'r');
    try {
      const buf = Buffer.alloc(5);
      await fd.read(buf, 0, 5, 0);
      expect(buf.toString('ascii')).toBe('%PDF-');
    } finally {
      await fd.close();
    }
  });
});
