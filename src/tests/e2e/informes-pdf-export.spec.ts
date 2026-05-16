/**
 * T-023 · E2E del flow de export PDF de informes.
 *
 * 2 tests:
 *   1. Happy path UI: crear user + consultora + informe RGRL con contenido
 *      via service-role → login UI → goto /informes/[id] → click "Descargar
 *      PDF" → page.waitForEvent('download') → asserts:
 *        - suggestedFilename matchea /^informe-rgrl-.*-\d{4}-\d{2}-\d{2}\.pdf$/
 *        - download.path() != null
 *        - file size > 5_000 bytes (PDF realista minimo)
 *        - magic bytes %PDF- en los primeros 5 bytes
 *   2. Informe SIN contenido → boton "Descargar PDF" disabled con tooltip
 *      "Generá contenido antes de descargar".
 *
 * Pre-requisitos del runtime:
 *   - `pnpm dev` accesible en localhost:3000 (Playwright webServer lo lanza).
 *   - CHROMIUM_PATH apunta a un Chromium o Chrome valido (env del shell que
 *     corre `pnpm test:e2e`). Sin esto el endpoint /pdf falla con 500.
 *
 * Correr local: `set -a && source .env.local && set +a &&
 *   CHROMIUM_PATH="/c/Program Files/Google/Chrome/Application/chrome.exe"
 *   pnpm test:e2e --grep "PDF export"`.
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
const createdInformeIds: string[] = [];

test.afterEach(async () => {
  // Cleanup primero del informe (FK on delete cascade no aplica entre
  // informes e informe_metadata; metadata se cascadea por su PK=FK), luego
  // del user (cascadea consultora_members).
  for (const id of createdInformeIds.splice(0)) {
    await adminClient.from('informes').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Informes · export PDF (T-023)', () => {
  // FLAKY: ver issue #56 — Puppeteer cross-worker en Windows sin
  // CHROMIUM_PATH provoca timeout. CI Ubuntu OK con retries=2 + Chromium
  // pre-instalado. Local Windows: export CHROMIUM_PATH antes de correr.
  // Smoke productivo del runbook valida real flow. NO investigar mas sin
  // demanda real.
  test('happy path: login → click Descargar PDF → download triggered con PDF valido', async ({
    page,
  }) => {
    const email = uniqueTestEmail('pdf-happy');
    const consultoraName = `Test PDF Happy ${Date.now().toString(36)}`;
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    // Informe RGRL con contenido markdown via service-role.
    const contenido = `# Informe RGRL — E2E test

## 1. Identificación

- **Razón social:** Acme E2E SA
- **CUIT:** 30-12345678-9
- **Domicilio:** Av. Industrial 1234

## 2. Hallazgos

1. Salidas de emergencia sin señalizar en planta.
2. EPP vencido en planilla Res. SRT 299/11.

## 3. Recomendaciones

| Item | Plazo | Norma |
|------|-------|-------|
| Cartelería | 30 días | Decreto 351/79 |
| Renovación EPP | 15 días | Res. SRT 299/11 |

_Documento generado por ConsultoraDemo._
`;
    const { data: informe, error: infErr } = await adminClient
      .from('informes')
      .insert({
        consultora_id: consultoraId,
        created_by: userId,
        tipo: 'rgrl',
        titulo: 'E2E PDF happy path',
        contenido,
      })
      .select('id')
      .single();
    if (infErr || !informe) throw new Error(`crear informe fallo: ${infErr?.message}`);
    createdInformeIds.push(informe.id);

    await loginViaUI(page, email, password);
    await page.goto(`/informes/${informe.id}`);

    const downloadBtn = page.getByRole('button', { name: /Descargar PDF/ });
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toBeEnabled();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      downloadBtn.click(),
    ]);

    // Filename: `informe-rgrl-<slug>-YYYY-MM-DD.pdf`.
    expect(download.suggestedFilename()).toMatch(/^informe-rgrl-.*-\d{4}-\d{2}-\d{2}\.pdf$/);

    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    if (!downloadPath) throw new Error('download.path() null');

    const stat = await fs.stat(downloadPath);
    // Un PDF de informe realista tiene minimo varios KB (header + fonts +
    // contenido + footer). 5KB es un piso conservador.
    expect(stat.size).toBeGreaterThan(5_000);

    // Magic bytes %PDF- en los primeros 5 bytes.
    const fd = await fs.open(downloadPath, 'r');
    try {
      const buf = Buffer.alloc(5);
      await fd.read(buf, 0, 5, 0);
      expect(buf.toString('ascii')).toBe('%PDF-');
    } finally {
      await fd.close();
    }
  });

  test('informe sin contenido: boton "Descargar PDF" disabled con tooltip explicativo', async ({
    page,
  }) => {
    const email = uniqueTestEmail('pdf-empty');
    const consultoraName = `Test PDF Empty ${Date.now().toString(36)}`;
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    const { data: informe, error: infErr } = await adminClient
      .from('informes')
      .insert({
        consultora_id: consultoraId,
        created_by: userId,
        tipo: 'otros',
        titulo: 'E2E PDF empty',
        contenido: null,
      })
      .select('id')
      .single();
    if (infErr || !informe) throw new Error(`crear informe fallo: ${infErr?.message}`);
    createdInformeIds.push(informe.id);

    await loginViaUI(page, email, password);
    await page.goto(`/informes/${informe.id}`);

    const downloadBtn = page.getByRole('button', { name: /Descargar PDF/ });
    await expect(downloadBtn).toBeVisible();
    await expect(downloadBtn).toBeDisabled();

    // El tooltip aparece al hover del span wrapper (Radix swallows hover
    // sobre <button disabled>). Hover y verificamos el texto.
    await page.locator(':has(> button[aria-label="Descargar PDF del informe"])').hover();
    await expect(
      page.getByText('Generá contenido antes de descargar', { exact: true }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
