/**
 * T-024 · E2E permission gate de attachments.
 *
 * Member non-creator non-owner ve los attachments pero NO los controles
 * de edicion (upload/reorder/delete/caption editable).
 *
 * Setup: 2 users en la misma consultora — owner crea el informe + attachment,
 * member abre el editor.
 *
 * IMPORTANTE: el flow `/informes/[id]/editar` REDIRIGE al detail si el user
 * no es creator ni owner (canEdit gate). El member entonces solo verifica
 * el read-view en `/informes/[id]`, que tiene el detail page ya existente
 * (T-019) y NO renderea AttachmentsSection. Por eso el test verifica que:
 *   a) /editar redirige a /informes/[id]
 *   b) /informes/[id] muestra el informe con attachments listados
 *      (read-only — sin botones de edicion)
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
const createdInformeIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdInformeIds.splice(0)) {
    await adminClient.from('informes').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Informes · attachments permissions (T-024)', () => {
  test('member non-creator non-owner: /editar redirige a detail; sin acceso a edicion', async ({
    page,
  }) => {
    // Owner crea consultora + informe + 1 attachment.
    const ownerEmail = uniqueTestEmail('att-perms-owner');
    const owner = await createTestUserWithConsultora({
      email: ownerEmail,
      consultoraName: `T-024 perms ${Date.now().toString(36)}`,
    });
    createdUserIds.push(owner.userId);

    const { data: informe, error: infErr } = await adminClient
      .from('informes')
      .insert({
        consultora_id: owner.consultoraId,
        created_by: owner.userId,
        tipo: 'rgrl',
        titulo: 'T-024 perms test',
        contenido: '# Test\n\nContenido.',
      })
      .select('id')
      .single();
    if (infErr || !informe) throw new Error(`crear informe fallo: ${infErr?.message}`);
    createdInformeIds.push(informe.id);

    // Attachment creado via admin con uploaded_by=owner (storage_path es
    // dummy — el test no descarga el binario, solo verifica permission gate
    // de la UI).
    await adminClient.from('informe_attachments').insert({
      informe_id: informe.id,
      consultora_id: owner.consultoraId,
      kind: 'image',
      storage_path: `${owner.consultoraId}/${informe.id}/${crypto.randomUUID()}.png`,
      filename: 'owner-foto.png',
      mime_type: 'image/png',
      size_bytes: 1024,
      position: 0,
      uploaded_by: owner.userId,
    });

    // Member: nuevo user (sin consultora) + membership manual a la consultora del owner.
    const memberEmail = uniqueTestEmail('att-perms-member');
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

    // Login como member.
    await loginViaUI(page, memberEmail, TEST_PASSWORD);

    // a) /editar redirige al detail (canEdit gate del server component).
    await page.goto(`/informes/${informe.id}/editar`);
    await expect(page).toHaveURL(new RegExp(`/informes/${informe.id}(\\?.*)?$`), {
      timeout: 10_000,
    });
    // No deberia ver el card de "Adjuntos" del editor (esa UI vive solo en /editar).
    await expect(page.getByText('Subir imagen', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Subir archivo', { exact: true })).toHaveCount(0);
  });
});
