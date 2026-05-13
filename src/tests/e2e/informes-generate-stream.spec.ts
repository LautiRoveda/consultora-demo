/**
 * T-025 · E2E del flow de streaming en EditorView.
 *
 * Cubre los dos paths principales del UI:
 *  1. Happy path: clickear "Generar con IA" → ver markdown aparecer en el
 *     preview + textarea → clickear "Guardar cambios" → navegacion a
 *     `/informes/[id]` con el contenido persistido.
 *  2. Cancel: clickear "Generar con IA" → ver "Cancelar generación" → click
 *     en cancelar → state vuelve a idle, textarea queda como estaba.
 *
 * Mocks: `page.route` intercepta el POST al endpoint y devuelve un payload
 * SSE pre-armado. El cancel test devuelve nunca (delay 30s) — el browser
 * aborta la conexion cuando el usuario clickea "Cancelar".
 *
 * Sin Anthropic real. La parte del SDK Anthropic se prueba en los integration
 * tests del flow (informes-generate-stream-flow.test.ts) — page.route NO
 * intercepta calls server-to-server.
 *
 * Correr local: `set -a && source .env.local && set +a && pnpm test:e2e`.
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

test.afterAll(async () => {
  for (const id of createdUserIds) {
    await deleteTestUser(id);
  }
});

function buildSseBody(parts: {
  chunks: string[];
  stopReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}): string {
  const lines: string[] = [];
  for (const chunk of parts.chunks) {
    lines.push(`event: delta\ndata: ${JSON.stringify({ text: chunk })}\n\n`);
  }
  lines.push(
    `event: stop\ndata: ${JSON.stringify({ reason: parts.stopReason ?? 'end_turn' })}\n\n`,
  );
  lines.push(
    `event: usage\ndata: ${JSON.stringify({
      inputTokens: parts.inputTokens ?? 100,
      outputTokens: parts.outputTokens ?? 50,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    })}\n\n`,
  );
  lines.push(`event: done\ndata: {}\n\n`);
  return lines.join('');
}

test('happy path · streaming visible + save persiste el contenido', async ({ page }) => {
  const email = uniqueTestEmail('t025-stream-happy');
  const consultoraName = 'Test T025 Happy';
  const { userId, consultoraId } = await createTestUserWithConsultora({ email, consultoraName });
  createdUserIds.push(userId);

  // Informe creado via admin para skippear el wizard (no es lo que testeamos aca).
  const { data: informe } = await adminClient
    .from('informes')
    .insert({
      consultora_id: consultoraId,
      tipo: 'rgrl',
      titulo: 'T025 happy path',
      created_by: userId,
    })
    .select('id')
    .single();
  const informeId = informe!.id;

  await loginViaUI(page, email, 'TestPassword123!');

  // Mock SSE response del endpoint.
  const sseBody = buildSseBody({
    chunks: [
      '# Informe RGRL\n\n',
      '## Datos del establecimiento\n\n',
      'Contenido generado por IA.',
    ],
  });
  const fullText = '# Informe RGRL\n\n## Datos del establecimiento\n\nContenido generado por IA.';
  await page.route(`**/api/informes/${informeId}/generate-stream`, async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
      },
      body: sseBody,
    });
  });

  await page.goto(`/informes/${informeId}/editar`);
  await expect(page.getByRole('heading', { name: /Editar:/ })).toBeVisible();

  await page.getByRole('button', { name: /Generar con IA/i }).click();

  // El contenido aparece en el textarea (despues del flush final del rAF).
  const contentTextarea = page.getByLabel('Contenido del informe');
  await expect(contentTextarea).toHaveValue(fullText, { timeout: 5000 });

  // Alert "Borrador generado" visible post-done.
  await expect(page.getByText('Borrador generado')).toBeVisible();

  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  // Navegacion a la vista del informe (no /editar).
  await page.waitForURL(new RegExp(`/informes/${informeId}$`));
  // El contenido renderizado como markdown contiene el heading.
  await expect(page.getByRole('heading', { name: 'Informe RGRL' })).toBeVisible();
});

test('cancel · abort mid-stream resetea state sin tocar el contenido inicial', async ({ page }) => {
  const email = uniqueTestEmail('t025-stream-cancel');
  const consultoraName = 'Test T025 Cancel';
  const { userId, consultoraId } = await createTestUserWithConsultora({ email, consultoraName });
  createdUserIds.push(userId);

  const { data: informe } = await adminClient
    .from('informes')
    .insert({
      consultora_id: consultoraId,
      tipo: 'rgrl',
      titulo: 'T025 cancel path',
      created_by: userId,
      contenido: '# Contenido previo',
    })
    .select('id')
    .single();
  const informeId = informe!.id;

  await loginViaUI(page, email, 'TestPassword123!');

  // Mock que nunca fulfilla — el browser aborta cuando el usuario clickea
  // "Cancelar generacion". Try/catch absorbe el error cuando la route ya
  // fue finalizada por el abort.
  await page.route(`**/api/informes/${informeId}/generate-stream`, async (route) => {
    try {
      await new Promise((r) => setTimeout(r, 30_000));
      // Si llegamos aca, el test no abort a tiempo — devolvemos algo neutral
      // para no bloquear la cleanup.
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream; charset=utf-8' },
        body: 'event: done\ndata: {}\n\n',
      });
    } catch {
      // Route ya finalizada por abort — esperado.
    }
  });

  await page.goto(`/informes/${informeId}/editar`);
  const contentTextarea = page.getByLabel('Contenido del informe');
  await expect(contentTextarea).toHaveValue('# Contenido previo');

  await page.getByRole('button', { name: /Generar con IA/i }).click();

  // Durante el stream se ve "Cancelar generación".
  const cancelBtn = page.getByRole('button', { name: /Cancelar generación/i });
  await expect(cancelBtn).toBeVisible();

  await cancelBtn.click();

  // Vuelve a "Generar con IA" (state idle).
  await expect(page.getByRole('button', { name: /Generar con IA/i })).toBeVisible();
  // Textarea sin cambios — el contenido previo se preserva.
  await expect(contentTextarea).toHaveValue('# Contenido previo');
  // No aparece el alert "Borrador generado".
  await expect(page.getByText('Borrador generado')).toBeHidden();
});
