/**
 * T-051 · E2E adversarial cross-tenant del cliente_id (defensa en profundidad).
 *
 * **Cobertura**: el cross-tenant defense del cliente_id (decisión 14 plan-mode
 * T-050) — RLS automático del autocomplete filtra clientes ajenos al tenant
 * del user logueado, defensa en capa UI. La defensa action-level (SELECT
 * RLS-aware pre-INSERT en createInformeAction) está cubierta por integration
 * test T-050 `informes-cliente-id.test.ts:2`; ese vive en Node con invocación
 * directa al action — no es replicable desde E2E.
 *
 * **Por qué no invocamos el action directo desde Playwright**: Next.js 16
 * Server Actions usan CSRF tokens dinámicos + endpoint `_rsc/[hash]` generado
 * en build. Imposible desde browser sandbox sin reverse-engineering del
 * protocolo privado. Este E2E confirma la primera capa de defensa (RLS UI
 * filter) end-to-end con sesión real.
 *
 * **Setup**: 2 consultoras + 2 users via createTestUserWithConsultora
 * (signup REAL secuencial, lesson T-047 — Promise.all flakea sa-east-1).
 * userA crea cliente en cA (admin INSERT). userB se loguea y busca el
 * cliente cA en el autocomplete → RLS filtra → NO aparece. DB sanity
 * confirma 0 informes cross-tenant en cB.
 *
 * Cleanup orden FK: clientes → users.
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
const createdClienteIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdClienteIds.splice(0)) {
    await adminClient.from('clientes').delete().eq('id', id);
  }
  for (const id of createdUserIds.splice(0)) {
    await deleteTestUser(id);
  }
});

test.describe('Módulo Clientes · cross-tenant defense (T-051)', () => {
  test('autocomplete filtra cross-tenant: userB NO ve cliente de consultoraA', async ({ page }) => {
    test.setTimeout(60_000);

    const suffix = Date.now().toString(36);

    // Setup secuencial (lesson T-047 — Promise.all flakea sa-east-1 con
    // ConnectTimeoutError + rate-limit silencioso de auth.admin).
    const emailA = uniqueTestEmail(`xtenant-a-${suffix}`);
    const { userId: userAId, consultoraId: cAId } = await createTestUserWithConsultora({
      email: emailA,
      consultoraName: `T-051 cross-tenant A ${suffix}`,
    });
    createdUserIds.push(userAId);

    const emailB = uniqueTestEmail(`xtenant-b-${suffix}`);
    const {
      userId: userBId,
      consultoraId: cBId,
      password: passwordB,
    } = await createTestUserWithConsultora({
      email: emailB,
      consultoraName: `T-051 cross-tenant B ${suffix}`,
    });
    createdUserIds.push(userBId);

    // userA crea cliente "Acme cA <suffix>" en cA via admin INSERT.
    const acmeRazon = `Acme cA ${suffix}`;
    const { data: clienteA, error: insertErr } = await adminClient
      .from('clientes')
      .insert({
        consultora_id: cAId,
        created_by: userAId,
        razon_social: acmeRazon,
        cuit: '30-99999999-9',
      })
      .select('id')
      .single();
    expect(insertErr).toBeNull();
    expect(clienteA).toBeTruthy();
    const clienteAId = clienteA!.id;
    createdClienteIds.push(clienteAId);

    // userB se loguea (tenant cB).
    await loginViaUI(page, emailB, passwordB);

    // userB va a /informes/nuevo y completa step 1.
    await page.goto('/informes/nuevo');
    await expect(page.getByRole('combobox')).toBeVisible();
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'RGRL', exact: true }).click();
    await page
      .getByPlaceholder('Ej: Relevamiento de ruido — Planta Sur')
      .fill(`Cross-tenant attempt ${suffix}`);
    await page.getByRole('button', { name: /Siguiente/i }).click();

    // Step 2: userB busca el cliente "Acme cA" — RLS debe filtrar.
    const search = page.getByLabel('Buscar cliente');
    await expect(search).toBeVisible();
    await search.fill(acmeRazon);

    // Esperar debounce 300ms + roundtrip — más buffer adicional para que la
    // query responda. Si el cliente apareciera, fallaría aquí.
    await page.waitForTimeout(1500);

    // El cliente cA NO debe aparecer en el dropdown (RLS automático filtra
    // via searchClientesByRazonSocial con cliente authed del JWT de userB).
    await expect(page.getByText(acmeRazon)).toHaveCount(0);

    // DB sanity: NO se creó ningún informe en cB con cliente_id de cA
    // (defensa en profundidad — el action-level SELECT defensive sería
    // la segunda capa, pero nunca llegamos a invocarlo).
    const { data: informesB } = await adminClient
      .from('informes')
      .select('id')
      .eq('consultora_id', cBId)
      .eq('cliente_id', clienteAId);
    expect(informesB ?? []).toHaveLength(0);
  });
});
