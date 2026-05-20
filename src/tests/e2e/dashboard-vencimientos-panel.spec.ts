/**
 * T-030 · E2E del panel "Proximos vencimientos" del dashboard.
 *
 * T-097 · Adaptado a mixed layout: stat cards (stat-hoy/siete/treinta) +
 * lista top-3 (urgent-event-<id>) + empty state "Todo al día".
 *
 * Cobertura (2 tests):
 *  1. Counts > 0 si hay eventos pendings: stat cards visibles con data-count +
 *     click "Ver agenda completa →" navega a /calendario/agenda.
 *  2. Empty state: usuario sin eventos pending → fallback "Todo al día"
 *     + CTA "Crear vencimiento" → click → navega a /calendario.
 *
 * Correr local: `set -a && source .env.local && set +a &&
 *   CHROMIUM_PATH="/path/to/chrome" pnpm test:e2e --grep "Dashboard panel"`.
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
const createdEventIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdEventIds.splice(0)) {
    await adminClient.from('calendar_events').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

function isoDaysFromNow(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

test.describe('Dashboard panel proximos vencimientos', () => {
  test('1. counts > 0 + "Ver todos" navega a /calendario/agenda', async ({ page }) => {
    const email = uniqueTestEmail('panel-counts');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Panel Test 1',
    });
    createdUserIds.push(userId);

    // Fixture: 1 overdue + 1 today + 1 en 5d + 1 en 20d.
    // Titulos >= 3 chars (CHECK constraint length(trim(titulo)) between 3 and 200).
    const fixtures = [
      { titulo: 'Overdue', fecha: isoDaysFromNow(-3) },
      { titulo: 'Hoy', fecha: isoDaysFromNow(0) },
      { titulo: 'En 5d', fecha: isoDaysFromNow(5) },
      { titulo: 'En 20d', fecha: isoDaysFromNow(20) },
    ];
    for (const f of fixtures) {
      const { data } = await adminClient
        .from('calendar_events')
        .insert({
          consultora_id: consultoraId,
          tipo: 'custom',
          titulo: f.titulo,
          fecha_vencimiento: f.fecha,
          reminder_offsets_days: [],
          created_by: userId,
        })
        .select('id')
        .single();
      if (data) createdEventIds.push(data.id);
    }

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto('/dashboard');

    // Panel visible.
    const panel = page.getByTestId('vencimientos-panel');
    await expect(panel).toBeVisible();

    // Counts esperados: hoy=2 (overdue+today), siete=1 (5d), treinta=1 (20d).
    await expect(panel.getByTestId('stat-hoy')).toHaveAttribute('data-count', '2');
    await expect(panel.getByTestId('stat-siete')).toHaveAttribute('data-count', '1');
    await expect(panel.getByTestId('stat-treinta')).toHaveAttribute('data-count', '1');

    // Top-3 ordenado por urgencia: el primer item es el overdue (fecha mas vieja).
    const urgentItems = panel.getByTestId(/^urgent-event-/);
    await expect(urgentItems.first()).toBeVisible();
    await expect(urgentItems.first()).toContainText('Overdue');

    // Click "Ver agenda completa →" → navega a /calendario/agenda.
    await panel.getByTestId('panel-ver-todos').click();
    await expect(page).toHaveURL(/\/calendario\/agenda/);
  });

  test('2. empty state: sin pendings → fallback CTA → navega a /calendario', async ({ page }) => {
    const email = uniqueTestEmail('panel-empty');
    const { userId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Panel Test 2',
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto('/dashboard');

    const empty = page.getByTestId('vencimientos-panel-empty');
    await expect(empty).toBeVisible();
    await expect(empty.getByText(/Todo al día/i)).toBeVisible();

    // CTA "Crear vencimiento" navega a /calendario.
    await empty.getByRole('link', { name: 'Crear vencimiento' }).click();
    await expect(page).toHaveURL(/\/calendario(\?|$)/);
  });
});
