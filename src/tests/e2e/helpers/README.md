# Helpers E2E (T-018)

Utilidades compartidas para tests E2E con sesión real contra Supabase remoto.

## Archivos

- **`admin.ts`** — admin client (service-role) + fixtures de user / consultora /
  recovery link. Construye y limpia data en Supabase remoto bypassando email
  rate limit.
- **`auth-flows.ts`** — interacciones UI repetidas (login / logout).

## Uso

```ts
import { test, expect } from '@playwright/test';
import {
  createTestUserWithConsultora,
  deleteTestUser,
  uniqueTestEmail,
} from './helpers/admin';
import { loginViaUI } from './helpers/auth-flows';

test('login → dashboard', async ({ page }) => {
  const email = uniqueTestEmail('login-happy');
  const { userId, password, slug } = await createTestUserWithConsultora({
    email,
    consultoraName: 'Test Login Happy',
  });

  // Cleanup garantizado aunque el test falle a mitad.
  test.info().attachments;
  const cleanupUserId = userId;

  try {
    await loginViaUI(page, email, password);
    await expect(page.getByText(`@${slug}`)).toBeVisible();
  } finally {
    await deleteTestUser(cleanupUserId);
  }
});
```

O con `test.afterEach`:

```ts
let createdUserIds: string[] = [];

test.afterEach(async () => {
  for (const id of createdUserIds) {
    await deleteTestUser(id);
  }
  createdUserIds = [];
});
```

## Cleanup pattern

- `deleteTestUser` es **idempotente**: acepta `undefined`, absorbe errores.
  Un test que falla antes de crear el user no rompe el cleanup.
- `afterEach` (no `afterAll`): un test fallido no contamina al siguiente.
- Cascada de FK borra `consultora_members` automáticamente.
- **Consultoras quedan orphan** — mismo trade-off conocido que los
  integration tests. Limpieza manual periódica via SQL Editor:
  `delete from consultoras where slug like 't018-%';`

## Env vars

Mismas que integration tests:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Correr local:
```bash
set -a && source .env.local && set +a && pnpm test:e2e
```

## Anti-flakiness

- Emails únicos: `uniqueTestEmail(prefix)` usa `Date.now() + random`.
- Cero `waitForTimeout` — usar `expect().toBeVisible()` / `toHaveURL()`
  con timeouts explícitos donde haya redirect chain (10s).
- Workers=1 en CI (ya configurado en `playwright.config.ts`) → cero
  race conditions cross-test.

## Bypass de email rate limit

- `admin.auth.admin.createUser({ email_confirm: true })` confirma el user
  sin enviar email.
- `admin.auth.admin.generateLink({ type: 'recovery' })` devuelve el
  `hashed_token` sin enviar email. `generateRecoveryLinkUrl` arma el URL
  del callback listo para `page.goto(...)`.
