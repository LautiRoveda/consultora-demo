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

  // Alert "Borrador generado" visible post-done. Match por la descripcion
  // unica del Alert (no por el titulo que tambien aparece en el toast sonner —
  // strict mode falla con 2 matches). Marca que el volcado al editor terminó.
  await expect(page.getByText(/Revisalo y editalo antes de guardar/i)).toBeVisible();

  // T-140 · al `done` el markdown completo se vuelca al editor WYSIWYG (Plate).
  await expect(page.locator('[data-slate-editor]')).toContainText('Contenido generado por IA.', {
    timeout: 5000,
  });

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
  // T-140 · el contenido vive en el editor WYSIWYG (Plate).
  const editorBody = page.locator('[data-slate-editor]');
  await expect(editorBody).toContainText('Contenido previo');

  await page.getByRole('button', { name: /Generar con IA/i }).click();

  // Durante el stream se ve "Cancelar generación".
  const cancelBtn = page.getByRole('button', { name: /Cancelar generación/i });
  await expect(cancelBtn).toBeVisible();

  await cancelBtn.click();

  // Vuelve a "Generar con IA" (state idle).
  await expect(page.getByRole('button', { name: /Generar con IA/i })).toBeVisible();
  // Editor sin cambios — el contenido previo se preserva.
  await expect(editorBody).toContainText('Contenido previo');
  // No aparece el alert "Borrador generado" (match por descripcion unica).
  await expect(page.getByText(/Revisalo y editalo antes de guardar/i)).toBeHidden();
});
