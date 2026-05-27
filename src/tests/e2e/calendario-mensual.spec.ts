/**
 * T-029 · E2E del calendario mensual.
 *
 * Cobertura (6 tests):
 *  1. happy path crear evento via drawer + visible en cell del mes.
 *  2. filtro por tipo oculta/muestra correctamente.
 *  3. navegar a mes siguiente preserva filtros en URL.
 *  4. completar evento NO recurrente → status pasa a completed.
 *  5. cancelar evento con motivo → status cancelled + reason en metadata.
 *  6. completar evento recurrente → next event aparece en mes siguiente
 *     (CTA del toast navega al mes + drawer view del nuevo).
 *
 * Correr local: `set -a && source .env.local && set +a &&
 *   CHROMIUM_PATH="/path/to/chrome" pnpm test:e2e --grep "Calendario mensual"`.
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

/**
 * Devuelve un YYYY-MM-DD garantizado a >= 90 dias futuro (asegura que NINGUN
 * default de offsets caiga en "skipped por pasado").
 *
 * Anclado a `todayCivilIsoAR()` por consistencia con los otros specs E2E (los
 * targets de prod usan TZ AR post-T-085). Con default daysAhead=120 el bug
 * cross-day no se manifiesta, pero mantenemos el anchor para evitar drift si
 * algun caller futuro pasa un offset chico.
 */
function farFutureIso(daysAhead = 120): string {
  const todayCivil = todayCivilIsoAR();
  const [y, m, d] = todayCivil.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + daysAhead);
  return dt.toISOString().slice(0, 10);
}

function ymOf(iso: string): { year: number; month: number } {
  const [y, m] = iso.split('-').map(Number) as [number, number, number];
  return { year: y, month: m };
}

test.describe('Calendario mensual', () => {
  test('1. happy path crear evento via drawer + visible en cell del mes', async ({ page }) => {
    const email = uniqueTestEmail('cal-create');
    const { userId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Cal Test 1',
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, 'TestPassword123!');

    const fechaIso = farFutureIso(120);
    const { year, month } = ymOf(fechaIso);

    // Navegar al mes del vencimiento (URL state).
    await page.goto(`/calendario?month=${year}-${String(month).padStart(2, '0')}`);
    await expect(page.getByTestId('month-label')).toBeVisible();

    // Abrir drawer create.
    await page.getByRole('button', { name: 'Nuevo vencimiento' }).click();
    await expect(page.getByTestId('drawer-title')).toHaveText('Nuevo vencimiento');

    // Completar form: tipo RGRL anual + titulo + fecha (input directo via DB).
    // Sin date picker en E2E (Calendar es complejo de manipular cross-browser);
    // testeamos via input "Días" del ReminderOffsetsInput + submit con fecha
    // pre-poblada por ?event= URL state. Mejor: evitar el picker abriendo
    // drawer en modo create CON dia clickeado.
    await page.keyboard.press('Escape'); // cerrar drawer
    const dayCell = page.getByTestId(`cell-${fechaIso}`);
    await expect(dayCell).toBeVisible();
    await dayCell.click();
    await expect(page.getByTestId('drawer-title')).toHaveText('Nuevo vencimiento');

    // Tipo: RGRL anual. Radix Select expone el trigger como combobox.
    await page.getByRole('combobox').first().click();
    await page.getByRole('option', { name: 'RGRL anual' }).click();

    // Titulo.
    await page.getByLabel(/Título/).fill('RGRL Test E2E Acme');

    // Activar recurrencia.
    await page.getByLabel('Recurrente').click();

    // Submit.
    await page.getByRole('button', { name: 'Crear vencimiento' }).click();

    // Drawer cierra + toast success.
    await expect(page.getByText(/Vencimiento creado/)).toBeVisible({ timeout: 10_000 });

    // Cell ahora tiene el evento.
    const eventInCell = dayCell.locator('[data-testid^="event-"]');
    await expect(eventInCell.first()).toBeVisible();
    await expect(eventInCell.first()).toContainText('RGRL Test E2E Acme');

    // Persistencia DB.
    const { data: rows } = await adminClient
      .from('calendar_events')
      .select('id')
      .eq('titulo', 'RGRL Test E2E Acme');
    expect(rows?.length).toBe(1);
    if (rows?.[0]) createdEventIds.push(rows[0].id);
  });

  test('2. filtro por tipo oculta/muestra correctamente', async ({ page }) => {
    const email = uniqueTestEmail('cal-filter');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Cal Test 2',
    });
    createdUserIds.push(userId);

    const fechaIso = farFutureIso(60);
    const { year, month } = ymOf(fechaIso);

    // Crear 2 eventos via DB: uno RGRL + uno custom.
    const { data: ev1 } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'rgrl_anual',
        titulo: 'Filter test RGRL',
        fecha_vencimiento: fechaIso,
        reminder_offsets_days: [0],
        created_by: userId,
      })
      .select('id')
      .single();
    const { data: ev2 } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'custom',
        titulo: 'Filter test Custom',
        fecha_vencimiento: fechaIso,
        reminder_offsets_days: [0],
        created_by: userId,
      })
      .select('id')
      .single();
    if (ev1) createdEventIds.push(ev1.id);
    if (ev2) createdEventIds.push(ev2.id);

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto(`/calendario?month=${year}-${String(month).padStart(2, '0')}`);

    const cell = page.getByTestId(`cell-${fechaIso}`);
    await expect(cell.locator('[data-testid^="event-"]')).toHaveCount(2);

    // Aplicar filtro tipo=rgrl_anual.
    await page.getByRole('button', { name: 'Filtros' }).click();
    await page.getByLabel('RGRL anual').check();
    // Cerrar popover (click fuera).
    await page.keyboard.press('Escape');

    // URL contiene tipo=rgrl_anual.
    await expect(page).toHaveURL(/tipo=rgrl_anual/);
    // Solo queda 1 evento en la cell (custom filtrado out).
    await expect(cell.locator('[data-testid^="event-"]')).toHaveCount(1);
  });

  test('3. navegar a mes siguiente preserva filtros en URL', async ({ page }) => {
    const email = uniqueTestEmail('cal-nav');
    const { userId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Cal Test 3',
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto('/calendario?month=2027-01&tipo=rgrl_anual');

    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    await expect(page).toHaveURL(/month=2027-02/);
    await expect(page).toHaveURL(/tipo=rgrl_anual/);
  });

  test('4. completar evento → desaparece de la vista pending', async ({ page }) => {
    const email = uniqueTestEmail('cal-complete');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Cal Test 4',
    });
    createdUserIds.push(userId);

    const fechaIso = farFutureIso(60);
    const { year, month } = ymOf(fechaIso);

    const { data: ev } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'custom',
        titulo: 'Complete test',
        fecha_vencimiento: fechaIso,
        reminder_offsets_days: [0],
        created_by: userId,
      })
      .select('id')
      .single();
    if (ev) createdEventIds.push(ev.id);

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto(`/calendario?month=${year}-${String(month).padStart(2, '0')}&event=${ev!.id}`);

    // Drawer auto-abre por ?event=.
    await expect(page.getByTestId('drawer-title')).toHaveText('Detalle del vencimiento');
    await expect(page.getByTestId('event-titulo')).toHaveText('Complete test');

    // Completar.
    await page.getByTestId('complete-trigger').click();
    await page.getByRole('button', { name: 'Confirmar' }).click();

    await expect(page.getByText(/Vencimiento completado/)).toBeVisible({ timeout: 10_000 });

    // Verificar persistencia status.
    const { data: row } = await adminClient
      .from('calendar_events')
      .select('status, completed_at')
      .eq('id', ev!.id)
      .single();
    expect(row?.status).toBe('completed');
    expect(row?.completed_at).toBeTruthy();
  });

  test('5. cancelar evento con motivo → status cancelled + reason en metadata', async ({
    page,
  }) => {
    const email = uniqueTestEmail('cal-cancel');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Cal Test 5',
    });
    createdUserIds.push(userId);

    const fechaIso = farFutureIso(60);
    const { year, month } = ymOf(fechaIso);

    const { data: ev } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'custom',
        titulo: 'Cancel test',
        fecha_vencimiento: fechaIso,
        reminder_offsets_days: [0],
        created_by: userId,
      })
      .select('id')
      .single();
    if (ev) createdEventIds.push(ev.id);

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto(`/calendario?month=${year}-${String(month).padStart(2, '0')}&event=${ev!.id}`);

    await page.getByTestId('cancel-trigger').click();
    await page.getByPlaceholder('Motivo (opcional)').fill('Cliente desistió E2E');
    await page.getByRole('button', { name: 'Cancelar vencimiento' }).last().click();

    await expect(page.getByText(/Vencimiento cancelado/)).toBeVisible({ timeout: 10_000 });

    const { data: row } = await adminClient
      .from('calendar_events')
      .select('status, metadata')
      .eq('id', ev!.id)
      .single();
    expect(row?.status).toBe('cancelled');
    const meta = row?.metadata as Record<string, unknown> | null;
    expect(meta?.cancel_reason).toBe('Cliente desistió E2E');
  });

  test('6. completar evento recurrente → next event aparece en mes siguiente', async ({ page }) => {
    const email = uniqueTestEmail('cal-recur');
    const { userId, consultoraId } = await createTestUserWithConsultora({
      email,
      consultoraName: 'Cal Test 6',
    });
    createdUserIds.push(userId);

    // Fecha original: 120 dias futuro. Next event = +12 meses → garantia que
    // todos los offsets default RGRL [60,30,7,0] caen en futuro relativo a now
    // (no se skipean por hora 09:00 ART pasada).
    const fechaIso = farFutureIso(120);
    const { year, month } = ymOf(fechaIso);
    const nextYear = month === 12 ? year + 2 : year + 1;
    const nextMonth = month;
    const nextMonthSlug = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;

    // Insert via admin (mas rapido que crear via UI) — RGRL anual + recurrence_months=12.
    const { data: ev } = await adminClient
      .from('calendar_events')
      .insert({
        consultora_id: consultoraId,
        tipo: 'rgrl_anual',
        titulo: 'RGRL recurrente E2E',
        fecha_vencimiento: fechaIso,
        recurrence_months: 12,
        reminder_offsets_days: [60, 30, 7, 0],
        created_by: userId,
      })
      .select('id')
      .single();
    if (ev) createdEventIds.push(ev.id);

    await loginViaUI(page, email, 'TestPassword123!');
    await page.goto(`/calendario?month=${year}-${String(month).padStart(2, '0')}&event=${ev!.id}`);

    // Drawer view del original abierto. Click "Marcar completado" → AlertDialog.
    await page.getByTestId('complete-trigger').click();
    await page.getByRole('button', { name: 'Confirmar' }).click();

    // Toast con CTA aparece. Sonner renderiza el `action` como button con el
    // label "Ver siguiente" (ver EventStatusActions.tsx).
    const ctaToast = page.getByRole('button', { name: /ver siguiente/i });
    await expect(ctaToast).toBeVisible({ timeout: 10_000 });
    await ctaToast.click();

    // URL navega al mes del next event (mismo mes 12 meses despues).
    await page.waitForURL(new RegExp(`month=${nextMonthSlug}`), { timeout: 10_000 });

    // El badge del next event aparece en la cell del dia (mismo dia +12 meses).
    const dayPart = fechaIso.split('-')[2]!;
    const nextCellTestId = `cell-${nextYear}-${String(nextMonth).padStart(2, '0')}-${dayPart}`;
    const nextCell = page.getByTestId(nextCellTestId);
    await expect(nextCell).toBeVisible({ timeout: 5_000 });
    await expect(nextCell.getByText('RGRL recurrente E2E')).toBeVisible({ timeout: 5_000 });

    // Track el next event para cleanup.
    const { data: nextRow } = await adminClient
      .from('calendar_events')
      .select('id, status, recurrence_months')
      .eq('consultora_id', consultoraId)
      .eq('titulo', 'RGRL recurrente E2E')
      .eq('status', 'pending')
      .neq('id', ev!.id)
      .maybeSingle();
    expect(nextRow).not.toBeNull();
    expect(nextRow?.recurrence_months).toBe(12);
    if (nextRow) createdEventIds.push(nextRow.id);
  });
});
