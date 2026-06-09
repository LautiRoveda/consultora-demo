/**
 * T-131 · E2E del tablero operativo del dashboard (reemplaza
 * dashboard-vencimientos-panel.spec.ts).
 *
 * Cobertura:
 *  1. Datos sembrados → contadores con data-count exacto + cola "Lo que necesita
 *     tu atención" con CTA drill-to-action; click en un contador navega a su lista.
 *  2. Empty state → "Todo al día" cuando no hay vencimientos.
 *
 * Correr local: `set -a && source .env.local && set +a &&
 *   CHROMIUM_PATH="/path/to/chrome" pnpm test:e2e --grep "Dashboard operativo"`.
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

// Cross-day fix (T-085): anclamos a todayCivilIsoAR() + UTC noon para que los
// buckets no salten entre 00:00–03:00 UTC.
function isoDaysFromNow(n: number): string {
  const [y, m, d] = todayCivilIsoAR().split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

test.describe('Dashboard operativo', () => {
  test('1. contadores + cola de atención + drill-to-action', async ({ page }) => {
    const email = uniqueTestEmail('dash-op');
    const { userId, consultoraId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Dash Operativo 1',
    });
    createdUserIds.push(userId);

    // 1 overdue EPP + 1 hoy + 1 en 5d + 1 en 20d. Titulos >= 3 chars (CHECK).
    const fixtures = [
      { titulo: 'EPP vencido', tipo: 'epp_entrega', fecha: isoDaysFromNow(-3) },
      { titulo: 'Hoy vence', tipo: 'custom', fecha: isoDaysFromNow(0) },
      { titulo: 'En cinco', tipo: 'custom', fecha: isoDaysFromNow(5) },
      { titulo: 'En veinte', tipo: 'custom', fecha: isoDaysFromNow(20) },
    ];
    for (const f of fixtures) {
      const { data } = await adminClient
        .from('calendar_events')
        .insert({
          consultora_id: consultoraId,
          tipo: f.tipo,
          titulo: f.titulo,
          fecha_vencimiento: f.fecha,
          reminder_offsets_days: [],
          created_by: userId,
        })
        .select('id')
        .single();
      if (data) createdEventIds.push(data.id);
    }

    await loginViaUI(page, email, password);
    await page.goto('/dashboard');

    // Contadores: vencidos=1, vencen esta semana=2 (hoy + 5d), borradores=0.
    await expect(page.getByTestId('counter-vencidos')).toHaveAttribute('data-count', '1');
    await expect(page.getByTestId('counter-vencen-semana')).toHaveAttribute('data-count', '2');
    await expect(page.getByTestId('counter-borradores')).toHaveAttribute('data-count', '0');
    await expect(page.getByTestId('counter-capas')).toHaveAttribute('data-count', '0');

    // Cola de atención: el EPP vencido aparece con su CTA de pilar.
    const queue = page.getByTestId('attention-queue');
    await expect(queue).toBeVisible();
    await expect(queue.getByText('EPP vencido')).toBeVisible();
    await expect(queue.getByRole('link', { name: 'Generar planilla Res 299/11' })).toHaveAttribute(
      'href',
      '/epp/entregas/nueva',
    );

    // Click en el contador "Vencidos" → navega a la agenda.
    await page.getByTestId('counter-vencidos').click();
    await expect(page).toHaveURL(/\/calendario\/agenda/);
  });

  test('2. empty state: sin vencimientos → "Todo al día"', async ({ page }) => {
    const email = uniqueTestEmail('dash-empty');
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Dash Operativo 2',
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);
    await page.goto('/dashboard');

    const empty = page.getByTestId('attention-queue-empty');
    await expect(empty).toBeVisible();
    await expect(empty.getByText(/Todo al día/i)).toBeVisible();
    // Contadores en cero igualmente presentes (los ceros son informativos).
    await expect(page.getByTestId('counter-vencidos')).toHaveAttribute('data-count', '0');
  });
});
