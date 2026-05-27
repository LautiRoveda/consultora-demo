/**
 * T-030 · E2E del calendario vista agenda.
 *
 * Cobertura (4 tests):
 *  1. Navegacion tab Mensual → Agenda + crear desde mensual + aparece en bucket
 *     correcto de la agenda + filtros tipo aplicados en agenda + URL state
 *     persiste tras refresh.
 *  2. Completar inline desde card del bucket → desaparece de pending (default
 *     filter status=pending) + status='completed' en DB.
 *  3. Modo flat: filtro status=completed (sin pending) → vista plana, no
 *     buckets, evento completed visible.
 *  4. Permission gate: member non-creator non-owner ve botones disabled +
 *     tooltip "Solo el creador o un owner...".
 *
 * Correr local: `set -a && source .env.local && set +a &&
 *   CHROMIUM_PATH="/path/to/chrome" pnpm test:e2e --grep "Calendario agenda"`.
 */
import { expect, test } from '@playwright/test';

import { todayCivilIsoAR } from '@/shared/lib/format-date';

import {
  adminClient,
  createTestUserWithConsultora,
  deleteTestUser,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

const createdUserIds: string[] = [];
const createdEventIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdEventIds.splice(0)) {
    await adminClient.from('calendar_events').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

// Cross-day fix: el bucketing del agenda usa `todayCivilIsoAR()` (T-085).
// Si construimos el offset desde `new Date()` UTC, en runners que corren entre
// 00:00 y 03:00 UTC (= 21:00-00:00 AR del dia anterior) el "hoy" UTC adelanta
// un dia al "hoy AR" → el evento "hoy" cae en bucket-siete y el test falla.
// Anclamos a `todayCivilIsoAR()` + UTC noon para ser idempotente al TZ del runner.
function isoDaysFromNow(n: number): string {
  const todayCivil = todayCivilIsoAR();
  const [y, m, d] = todayCivil.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

test.describe('Calendario agenda', () => {
  test('1. tab Mensual → Agenda + evento aparece en bucket correcto + filtro tipo en URL', async ({
    page,
  }) => {
    const email = uniqueTestEmail('agenda-nav');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Agenda Test 1',
    });
    createdUserIds.push(userId);

    // Crear 2 eventos via admin: uno hoy (RGRL) + uno en 5 dias (custom).
    const { data: evHoy } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'rgrl_anual',
        titulo: 'RGRL vence HOY',
        fecha_vencimiento: isoDaysFromNow(0),
        reminder_offsets_days: [0],
        created_by: userId,
      })
      .select('id')
      .single();
    const { data: ev5d } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'custom',
        titulo: 'Custom en 5 dias',
        fecha_vencimiento: isoDaysFromNow(5),
        reminder_offsets_days: [0],
        created_by: userId,
      })
      .select('id')
      .single();
    if (evHoy) createdEventIds.push(evHoy.id);
    if (ev5d) createdEventIds.push(ev5d.id);

    await loginViaUI(page, email, 'TestPassword123!');

    // Arranca en mensual. Click tab Agenda → navega.
    await page.goto('/calendario');
    await expect(page.getByTestId('tab-mensual')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('tab-agenda').click();
    await expect(page).toHaveURL(/\/calendario\/agenda/);
    await expect(page.getByTestId('tab-agenda')).toHaveAttribute('aria-selected', 'true');

    // Bucket "Vencen HOY" tiene el RGRL.
    const bucketHoy = page.getByTestId('bucket-hoy');
    await expect(bucketHoy).toBeVisible();
    await expect(bucketHoy.getByText('RGRL vence HOY')).toBeVisible();

    // Bucket "Vencen en 7 dias" tiene el custom.
    const bucketSiete = page.getByTestId('bucket-siete');
    await expect(bucketSiete).toBeVisible();
    await expect(bucketSiete.getByText('Custom en 5 dias')).toBeVisible();

    // Aplicar filtro tipo=rgrl_anual.
    await page.getByRole('button', { name: 'Filtros' }).click();
    await page.getByLabel('RGRL anual').check();
    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(/tipo=rgrl_anual/);
    // El custom desaparece, el RGRL queda.
    await expect(bucketHoy.getByText('RGRL vence HOY')).toBeVisible();
    // Anti-test: el evento custom ya no esta visible.
    await expect(page.getByText('Custom en 5 dias')).toHaveCount(0);

    // Refresh → URL state preserva filtro.
    await page.reload();
    await expect(page).toHaveURL(/tipo=rgrl_anual/);
    await expect(page.getByText('RGRL vence HOY')).toBeVisible();
  });

  test('2. completar inline desde card → desaparece de pending + status completed en DB', async ({
    page,
  }) => {
    const email = uniqueTestEmail('agenda-complete');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Agenda Test 2',
    });
    createdUserIds.push(userId);

    const { data: ev } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'custom',
        titulo: 'Inline complete test',
        fecha_vencimiento: isoDaysFromNow(3),
        reminder_offsets_days: [0],
        created_by: userId,
      })
      .select('id')
      .single();
    if (ev) createdEventIds.push(ev.id);

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto('/calendario/agenda');

    const card = page.getByTestId(`agenda-card-${ev!.id}`);
    await expect(card).toBeVisible();

    // Click "Completar" inline → AlertDialog → Confirmar.
    await card.getByTestId('agenda-complete').click();
    await page.getByRole('button', { name: 'Confirmar' }).click();

    await expect(page.getByText(/Vencimiento completado/)).toBeVisible({ timeout: 10_000 });

    // Card desaparece de la vista (default filter status=pending).
    await expect(card).not.toBeVisible({ timeout: 5_000 });

    // Persistencia DB.
    const { data: row } = await adminClient
      .from('calendar_events')
      .select('status, completed_at, completed_by')
      .eq('id', ev!.id)
      .single();
    expect(row?.status).toBe('completed');
    expect(row?.completed_at).toBeTruthy();
    expect(row?.completed_by).toBe(userId);
  });

  test('3. modo flat: filtro status=completed sin pending → lista plana, no buckets', async ({
    page,
  }) => {
    const email = uniqueTestEmail('agenda-flat');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Agenda Test 3',
    });
    createdUserIds.push(userId);

    // Insertar 2 completados directo via admin.
    const { data: ev1 } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'custom',
        titulo: 'Flat completed A',
        fecha_vencimiento: isoDaysFromNow(-30),
        reminder_offsets_days: [],
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: userId,
        created_by: userId,
      })
      .select('id')
      .single();
    const { data: ev2 } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'rgrl_anual',
        titulo: 'Flat completed B',
        fecha_vencimiento: isoDaysFromNow(-10),
        reminder_offsets_days: [],
        status: 'completed',
        completed_at: new Date().toISOString(),
        completed_by: userId,
        created_by: userId,
      })
      .select('id')
      .single();
    if (ev1) createdEventIds.push(ev1.id);
    if (ev2) createdEventIds.push(ev2.id);

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto('/calendario/agenda?status=completed');

    // No buckets renderizados; lista plana visible.
    await expect(page.getByTestId('bucket-hoy')).toHaveCount(0);
    await expect(page.getByTestId('bucket-siete')).toHaveCount(0);
    await expect(page.getByTestId('agenda-flat-list')).toBeVisible();
    await expect(page.getByText('Flat completed A')).toBeVisible();
    await expect(page.getByText('Flat completed B')).toBeVisible();
  });

  test('4. permission gate: member non-creator non-owner ve botones disabled', async ({ page }) => {
    const ownerEmail = uniqueTestEmail('agenda-owner');
    const memberEmail = uniqueTestEmail('agenda-member');

    const { userId: ownerId, consultoraId } = await createTestUserWithConsultora({
      email: ownerEmail,
      consultoraName: 'Agenda Test 4',
    });
    createdUserIds.push(ownerId);

    // Crear member en la misma consultora directo via admin (sin nueva consultora).
    const { data: memberUser } = await adminClient.auth.admin.createUser({
      email: memberEmail,
      password: 'TestPassword123!',
      email_confirm: true,
    });
    const memberId = memberUser.user!.id;
    createdUserIds.push(memberId);
    await adminClient
      .from('consultora_members')
      .insert({ user_id: memberId, consultora_id: consultoraId, role: 'member' });
    await adminClient.auth.admin.updateUserById(memberId, {
      app_metadata: { consultora_id: consultoraId },
    });

    // Owner crea un evento.
    const { data: ev } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'custom',
        titulo: 'Owned by owner',
        fecha_vencimiento: isoDaysFromNow(5),
        reminder_offsets_days: [0],
        created_by: ownerId, // creado por owner, NO por member
      })
      .select('id')
      .single();
    if (ev) createdEventIds.push(ev.id);

    // Login como member.
    await loginViaUI(page, memberEmail, 'TestPassword123!');
    await page.goto('/calendario/agenda');

    const card = page.getByTestId(`agenda-card-${ev!.id}`);
    await expect(card).toBeVisible();
    // Botones disabled (HTML disabled).
    await expect(card.getByTestId('agenda-complete')).toBeDisabled();
    await expect(card.getByTestId('agenda-edit')).toBeDisabled();
  });
});
