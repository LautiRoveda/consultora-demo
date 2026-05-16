/**
 * T-036 · E2E del flow de publicación de informes (DA-05).
 *
 * Cobertura (3 tests):
 *  1. happy path con modal (toggle OFF + tipo rgrl) → AlertDialog confirm →
 *     PostPublishEventDialog aparece prepop → Agendar → DB con event + informe_id.
 *  2. silent path (toggle ON + tipo rgrl) → SIN modal → toast con CTA → DB
 *     con event auto-creado.
 *  3. tipo no-recurrente (accidente) → SIN modal → toast simple → DB sin event.
 *
 * Correr local: `set -a && source .env.local && set +a &&
 *   CHROMIUM_PATH="/path/to/chrome" pnpm test:e2e --grep "Informes publish flow"`.
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
const createdInformeIds: string[] = [];
const createdEventIds: string[] = [];

test.afterEach(async () => {
  // Cleanup orden: events primero (FK informe_id), despues informes, despues users.
  for (const id of createdEventIds.splice(0)) {
    await adminClient.from('calendar_events').delete().eq('id', id);
  }
  for (const id of createdInformeIds.splice(0)) {
    await adminClient.from('informes').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

async function createInformeWithContent(args: {
  consultoraId: string;
  userId: string;
  tipo: 'rgrl' | 'capacitacion' | 'accidente';
  titulo: string;
}): Promise<string> {
  const { data, error } = await adminClient
    .from('informes')
    .insert({
      consultora_id: args.consultoraId,
      tipo: args.tipo,
      titulo: args.titulo,
      contenido: '# Contenido del informe\n\nCuerpo del documento.',
      status: 'draft',
      created_by: args.userId,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`createInformeWithContent: ${error?.message}`);
  }
  createdInformeIds.push(data.id);
  return data.id;
}

test.describe('Informes publish flow', () => {
  test('1. happy path con modal: toggle OFF + tipo rgrl → modal post-firma → DB con event', async ({
    page,
  }) => {
    const email = uniqueTestEmail('publish-modal');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'T036 Publish Modal',
    });
    createdUserIds.push(userId);

    // Por default auto_create_event_on_sign = false.
    const informeId = await createInformeWithContent({
      consultoraId,
      userId,
      tipo: 'rgrl',
      titulo: 'RGRL E2E Modal',
    });

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto(`/informes/${informeId}/editar`);

    // Click "Publicar" → AlertDialog confirm.
    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('¿Publicar el informe?')).toBeVisible();

    // El AlertDialogAction es el ultimo button "Publicar" en el DOM.
    const publishButtons = page.getByRole('button', { name: 'Publicar' });
    await publishButtons.last().click();

    // PostPublishEventDialog aparece con prepop.
    await expect(page.getByText('¿Querés agendar la renovación?')).toBeVisible({
      timeout: 10_000,
    });
    // El input titulo tiene prepop "RGRL anual · <razon_social>" o el titulo del
    // informe si no hay metadata. Sin metadata, default cae al titulo del informe.
    const tituloInput = page.getByLabel('Título');
    await expect(tituloInput).toBeVisible();

    // Click "Agendar".
    await page.getByRole('button', { name: 'Agendar' }).click();

    // Toast success "Vencimiento creado".
    await expect(page.getByText(/vencimiento creado/i)).toBeVisible({ timeout: 10_000 });

    // Verificar DB: informe published + evento creado con informe_id.
    const { data: informe } = await adminClient
      .from('informes')
      .select('status')
      .eq('id', informeId)
      .single();
    expect(informe?.status).toBe('published');

    const { data: events } = await adminClient
      .from('calendar_events')
      .select('id, tipo, recurrence_months, informe_id')
      .eq('informe_id', informeId);
    expect(events?.length).toBe(1);
    expect(events?.[0]?.tipo).toBe('rgrl_anual');
    expect(events?.[0]?.recurrence_months).toBe(12);
    if (events?.[0]?.id) createdEventIds.push(events[0].id);
  });

  test('2. silent path: toggle ON + tipo rgrl → SIN modal → DB con event auto-creado', async ({
    page,
  }) => {
    const email = uniqueTestEmail('publish-silent');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'T036 Publish Silent',
    });
    createdUserIds.push(userId);

    // Activar toggle.
    await adminClient
      .from('consultoras')
      .update({ auto_create_event_on_sign: true })
      .eq('id', consultoraId);

    const informeId = await createInformeWithContent({
      consultoraId,
      userId,
      tipo: 'rgrl',
      titulo: 'RGRL E2E Silent',
    });

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto(`/informes/${informeId}/editar`);

    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('¿Publicar el informe?')).toBeVisible();
    await page.getByRole('button', { name: 'Publicar' }).last().click();

    // NO debe aparecer el PostPublishEventDialog (es silent).
    // Verificamos que el toast aparezca y que el modal NO se vea.
    await expect(page.getByText(/informe publicado/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('¿Querés agendar la renovación?')).not.toBeVisible();

    // Verificar DB: evento auto-creado.
    const { data: events } = await adminClient
      .from('calendar_events')
      .select('id, tipo, informe_id, recurrence_months')
      .eq('informe_id', informeId);
    expect(events?.length).toBe(1);
    expect(events?.[0]?.tipo).toBe('rgrl_anual');
    expect(events?.[0]?.recurrence_months).toBe(12);
    if (events?.[0]?.id) createdEventIds.push(events[0].id);
  });

  test('3. tipo no-recurrente: accidente → SIN modal → DB sin event', async ({ page }) => {
    const email = uniqueTestEmail('publish-accidente');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'T036 Publish Accidente',
    });
    createdUserIds.push(userId);

    // Aun con toggle ON, accidente NO debe disparar silent path (mapping null).
    await adminClient
      .from('consultoras')
      .update({ auto_create_event_on_sign: true })
      .eq('id', consultoraId);

    const informeId = await createInformeWithContent({
      consultoraId,
      userId,
      tipo: 'accidente',
      titulo: 'Accidente E2E',
    });

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto(`/informes/${informeId}/editar`);

    await page.getByRole('button', { name: 'Publicar' }).click();
    await expect(page.getByText('¿Publicar el informe?')).toBeVisible();
    await page.getByRole('button', { name: 'Publicar' }).last().click();

    await expect(page.getByText(/informe publicado/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('¿Querés agendar la renovación?')).not.toBeVisible();

    // Verificar DB: NO evento (mapping accidente -> null).
    const { data: events } = await adminClient
      .from('calendar_events')
      .select('id')
      .eq('informe_id', informeId);
    expect(events ?? []).toEqual([]);
  });
});
