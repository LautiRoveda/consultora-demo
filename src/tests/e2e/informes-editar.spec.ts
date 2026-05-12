/**
 * T-020 · E2E del editor de contenido (sin AI live).
 *
 * 2 tests:
 *   1. Save flow happy path: login → /editar con `contenido` pre-poblado
 *      por admin → editar manualmente → Guardar → ver markdown en /[id].
 *   2. Permission gate UI: member que NO es creator NI owner → /editar
 *      redirige a /informes/[id] y boton "Editar" no aparece.
 *
 * Nota: el path "Generar con IA" NO se testea aca. Razon tecnica: el SDK
 * Anthropic se invoca desde el server action (Node.js runtime de Next.js),
 * y `page.route` de Playwright solo intercepta requests del browser
 * context — las llamadas server-to-server salen directo al api.anthropic.com.
 *
 * La cobertura del generate path vive en `informes-content-actions.test.ts`
 * (integration, mock del SDK via `vi.mock('@/shared/ai/anthropic')`):
 * test #5 happy path, #6 rate-limit, #7 content-filter, etc.
 */
import { expect, test } from '@playwright/test';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  TEST_PASSWORD,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

/**
 * Helper: crea un informe via admin. Bypassea RLS (service-role) y permite
 * setear created_by + consultora_id arbitrarios para los tests.
 */
async function createTestInforme(args: {
  consultoraId: string;
  createdBy: string;
  tipo?: 'relevamiento' | 'capacitacion' | 'rgrl' | 'accidente' | 'otros';
  titulo?: string;
  contenido?: string | null;
}): Promise<string> {
  const { data, error } = await adminClient
    .from('informes')
    .insert({
      consultora_id: args.consultoraId,
      created_by: args.createdBy,
      tipo: args.tipo ?? 'rgrl',
      titulo: args.titulo ?? `E2E test informe ${Date.now().toString(36)}`,
      contenido: args.contenido ?? null,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`createTestInforme fallo: ${error?.message}`);
  return data.id;
}

test.describe('Informes · editor con IA (T-020)', () => {
  test('save flow happy path: login → /editar con contenido pre-poblado → editar → Guardar → ver markdown', async ({
    page,
  }) => {
    const email = uniqueTestEmail('editar-save');
    const consultoraName = `Test Editar Save ${Date.now().toString(36)}`;
    const { userId, password, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    // Pre-poblamos contenido via admin — simula un borrador generado previamente
    // (sin pegarle a Anthropic en el test). El generate path lo cubre el
    // integration test con mock del SDK.
    const initialContent = '# Borrador inicial\n\nContenido pre-poblado para el test E2E.';
    const informeId = await createTestInforme({
      consultoraId,
      createdBy: userId,
      tipo: 'rgrl',
      titulo: `Editar save ${Date.now().toString(36)}`,
      contenido: initialContent,
    });

    await loginViaUI(page, email, password);
    await page.goto(`/informes/${informeId}/editar`);
    await expect(page).toHaveURL(new RegExp(`/informes/${informeId}/editar$`));

    // Textarea ya tiene el contenido inicial cargado.
    const contentTextarea = page.getByLabel('Contenido del informe');
    await expect(contentTextarea).toHaveValue(/Borrador inicial/);

    // Preview live muestra el header rendered (en panel derecho).
    await expect(page.getByRole('heading', { name: 'Borrador inicial' })).toBeVisible();

    // Editar manualmente (append).
    await contentTextarea.focus();
    await page.keyboard.press('End');
    await contentTextarea.pressSequentially('\n\nEditado manualmente.');

    // Guardar.
    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    // Redirect a detail view + render markdown.
    await expect(page).toHaveURL(new RegExp(`/informes/${informeId}$`), { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Borrador inicial' })).toBeVisible();
    await expect(page.getByText(/Editado manualmente/)).toBeVisible();
  });

  test('permission gate UI: member sin permiso → /editar redirige + boton Editar no visible', async ({
    page,
  }) => {
    const emailOwner = uniqueTestEmail('editar-perm-owner');
    const emailMember = uniqueTestEmail('editar-perm-member');
    const consultoraName = `Test Editar Perm ${Date.now().toString(36)}`;

    // ownerA + consultora.
    const { userId: ownerId, consultoraId } = await createTestUserWithConsultora({
      email: emailOwner,
      consultoraName,
    });
    createdUserIds.push(ownerId);

    // memberA: user secundario, member de la misma consultora pero no owner ni creator.
    const { data: memberCreated, error: createErr } = await adminClient.auth.admin.createUser({
      email: emailMember,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (createErr || !memberCreated.user) {
      throw new Error(`crear member fallo: ${createErr?.message}`);
    }
    const memberId = memberCreated.user.id;
    createdUserIds.push(memberId);

    await adminClient
      .from('consultora_members')
      .insert({ user_id: memberId, consultora_id: consultoraId, role: 'member' });
    await adminClient.auth.admin.updateUserById(memberId, {
      app_metadata: { consultora_id: consultoraId },
    });

    // Informe creado por ownerA → memberA NO es creator NI owner.
    const informeId = await createTestInforme({
      consultoraId,
      createdBy: ownerId,
      tipo: 'rgrl',
      titulo: `Perm gate test ${Date.now().toString(36)}`,
    });

    // Login como memberA.
    await loginViaUI(page, emailMember, TEST_PASSWORD);

    // Intentar acceder a /editar → debe redirigir a /informes/[id].
    await page.goto(`/informes/${informeId}/editar`);
    await expect(page).toHaveURL(new RegExp(`/informes/${informeId}$`), { timeout: 10_000 });

    // Boton "Editar" NO aparece en el read view.
    await expect(page.getByRole('link', { name: 'Editar' })).toHaveCount(0);
  });
});
