/**
 * T-021 · E2E del wizard RGRL + panel metadata.
 *
 * 2 tests:
 *   1. Happy path UI: login → /informes/nuevo → wizard step 1 (tipo=rgrl) →
 *      Siguiente → llenar form RGRL → "Crear informe con datos" → redirect
 *      a /editar → verificar panel arriba con datos pre-pobladas + summary
 *      en el read view tras click "Volver al informe".
 *   2. Permission gate UI sobre informe RGRL con metadata: memberA (no creator
 *      ni owner) intenta /editar → redirige a /informes/[id]. En el read view
 *      ve el RgrlMetadataSummary (RLS SELECT permite members leerlo) pero
 *      NO ve boton Editar.
 *
 * El path "Generar con IA con metadata" NO se testea aca: el integration
 * `informes-content-actions.test.ts` cubre 100% del contrato con el SDK
 * (test 10-13). page.route de Playwright no intercepta server-to-server.
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

test.describe('Informes · template RGRL (T-021)', () => {
  test('wizard 2 steps: tipo rgrl → form RGRL → crear con datos → redirect /editar con datos pre-pobladas', async ({
    page,
  }) => {
    const email = uniqueTestEmail('rgrl-wizard');
    const consultoraName = `Test RGRL Wizard ${Date.now().toString(36)}`;
    const { userId, password } = await createTestUserWithConsultora({
      email,
      consultoraName,
    });
    createdUserIds.push(userId);

    await loginViaUI(page, email, password);
    await page.goto('/informes/nuevo');

    // === STEP 1: tipo + titulo ===
    // Default tipo='relevamiento' → boton dice "Crear informe". Cambiar a rgrl
    // → cambia a "Siguiente".
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'RGRL' }).click();
    await page.getByLabel('Título').fill('E2E RGRL Wizard Test');

    // El boton ahora dice "Siguiente: cargar datos" (porque tipo=rgrl).
    await page.getByRole('button', { name: /Siguiente/ }).click();

    // === STEP 2: form RGRL ===
    await expect(page.getByRole('heading', { name: 'Datos del relevamiento' })).toBeVisible();

    // Llenar campos obligatorios (defaults sensibles ya cubren provincia + enums).
    await page.getByLabel('Razón social').fill('Metalúrgica E2E SA');
    await page.getByLabel('CUIT').fill('30-12345678-9');
    await page.getByLabel('Domicilio').fill('Av. Industrial 1234');
    await page.getByLabel('Localidad').fill('Tigre');
    await page.getByLabel('Actividad principal').fill('Fabricación de estructuras');
    await page.getByLabel('Cantidad de empleados').fill('80');
    await page.getByLabel('ART contratada').fill('La Segunda');

    // Marcar un area extra ("Depósito / almacén") — defaults ya tienen 2 areas.
    await page.getByRole('checkbox', { name: 'Depósito / almacén' }).check();

    // Submit con datos.
    await page.getByRole('button', { name: /Crear informe con datos/ }).click();

    // === Verificacion: redirect a /editar ===
    await expect(page).toHaveURL(/\/informes\/[0-9a-f-]+\/editar$/, { timeout: 15_000 });

    // El panel metadata esta arriba con los datos pre-pobladas.
    // (El Collapsible esta abierto por default en mobile y desktop cuando data poblada).
    await expect(page.getByText('Datos del relevamiento')).toBeVisible();
    await expect(page.getByLabel('Razón social')).toHaveValue('Metalúrgica E2E SA');
    await expect(page.getByLabel('CUIT')).toHaveValue('30-12345678-9');
    await expect(page.getByLabel('Cantidad de empleados')).toHaveValue('80');
  });

  test('permission gate sobre RGRL con metadata: member no-creator no-owner ve summary en read view pero no Editar', async ({
    page,
  }) => {
    const emailOwner = uniqueTestEmail('rgrl-perm-owner');
    const emailMember = uniqueTestEmail('rgrl-perm-member');
    const consultoraName = `Test RGRL Perm ${Date.now().toString(36)}`;

    // ownerA + consultora.
    const { userId: ownerId, consultoraId } = await createTestUserWithConsultora({
      email: emailOwner,
      consultoraName,
    });
    createdUserIds.push(ownerId);

    // memberA: member de la misma consultora pero no owner ni creator del informe.
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

    // Informe RGRL + metadata, ambos creados por ownerA via admin (bypassea RLS).
    const { data: informe, error: infErr } = await adminClient
      .from('informes')
      .insert({
        consultora_id: consultoraId,
        created_by: ownerId,
        tipo: 'rgrl',
        titulo: `RGRL perm test ${Date.now().toString(36)}`,
      })
      .select('id')
      .single();
    if (infErr || !informe) throw new Error(`crear informe fallo: ${infErr?.message}`);

    await adminClient.from('informe_metadata').insert({
      informe_id: informe.id,
      data: {
        razon_social: 'Test Perm Gate SA',
        cuit: '30-99999999-9',
        domicilio: 'Calle Test 1',
        localidad: 'CABA',
        provincia: 'CABA',
        actividad_principal: 'Test perm gate',
        cantidad_empleados: 10,
        distribucion_turno: 'unico',
        modalidad_operativa: 'comercial',
        art_contratada: 'Test ART',
        servicio_hys_modalidad: 'externo',
        areas_relevadas: ['Oficinas administrativas'],
        fecha_relevamiento: '2026-05-12',
      },
    });

    // Login como memberA.
    await loginViaUI(page, emailMember, TEST_PASSWORD);

    // /editar → redirige a /informes/[id] (permission gate del server component).
    await page.goto(`/informes/${informe.id}/editar`);
    await expect(page).toHaveURL(new RegExp(`/informes/${informe.id}$`), { timeout: 10_000 });

    // En el read view, el summary RGRL SI se muestra (RLS SELECT permite members
    // de la consultora leer el metadata).
    await expect(page.getByText('Datos del relevamiento')).toBeVisible();
    await expect(page.getByText('Test Perm Gate SA')).toBeVisible();

    // Pero el boton "Editar" NO aparece (gate UI espeja la RLS UPDATE).
    await expect(page.getByRole('link', { name: 'Editar' })).toHaveCount(0);
  });
});
