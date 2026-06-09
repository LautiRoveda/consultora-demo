/**
 * T-131 · E2E responsive del dashboard operativo (lección T-127).
 *
 * Assert OBJETIVO de overflow horizontal en viewport mobile: `scrollWidth <=
 * clientWidth` (NUNCA "a ojo" ni con zoom-out). Siembra un evento con título
 * largo para estresar el layout (causa típica de overflow). Verifica además que
 * el FAB (CTA primaria móvil) sea visible.
 *
 * Demo red→green: el assert FALLA contra un layout con overflow (p.ej. un
 * `min-w-[700px]` temporal en un bloque) y PASA con el layout final.
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

test.use({ viewport: { width: 390, height: 844 } });

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
  const [y, m, d] = todayCivilIsoAR().split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

test('dashboard móvil (390px): sin overflow horizontal + FAB visible', async ({ page }) => {
  const email = uniqueTestEmail('dash-resp');
  const { userId, consultoraId, password } = await createTestUserWithConsultora({
    email,
    consultoraName: 'Dash Responsive',
  });
  createdUserIds.push(userId);

  // Evento con título largo: estresa truncado/overflow del bloque de atención.
  const { data } = await adminClient
    .from('calendar_events')
    .insert({
      consultora_id: consultoraId,
      tipo: 'epp_entrega',
      titulo:
        'Entrega de EPP del galpón de fraccionamiento de productos químicos sector norte línea 4',
      fecha_vencimiento: isoDaysFromNow(-1),
      reminder_offsets_days: [],
      created_by: userId,
    })
    .select('id')
    .single();
  if (data) createdEventIds.push(data.id);

  await loginViaUI(page, email, password);
  await page.goto('/dashboard');

  // Esperar a que el subárbol de datos (streameado) esté presente.
  await expect(page.getByTestId('dashboard-counters')).toBeVisible();
  await expect(page.getByTestId('attention-queue')).toBeVisible();

  // FAB = CTA primaria móvil.
  await expect(page.getByTestId('dashboard-fab')).toBeVisible();

  // Assert objetivo: sin scroll horizontal en la página.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = document.documentElement;
        return el.scrollWidth - el.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(0);
});
