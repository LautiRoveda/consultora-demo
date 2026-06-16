import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './src/tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  // T-149: en CI cada shard emite un reporte `blob`; el job `e2e-report-merge`
  // los consolida en un HTML único con `playwright merge-reports`. En local, html
  // directo. El blob escribe `blob-report/report-<shard>.zip` auto-nombrado.
  reporter: isCI ? [['list'], ['blob']] : [['list'], ['html']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox y WebKit configurados pero NO se corren por default.
    // Activar con: pnpm exec playwright test --project=firefox
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    // En CI corremos build + start (modo produccion) para evitar race conditions
    // con Fast Refresh / HMR de `next dev` que descartan toasts y otros UI
    // ephemerals despues de un router.refresh() post-Server-Action. En local
    // dejamos `next dev` por velocidad de iteracion.
    command: isCI ? 'pnpm build && pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCI,
    // En CI: 5 min para que el build de Next 16 termine + start. T-112: el job
    // aislado `e2e-tests` estrena una key de cache .next propia, asi que la
    // primera corrida buildea en frio; 3 min quedaban justos. Local sigue con
    // 2 min porque dev arranca instantaneo.
    timeout: isCI ? 300_000 : 120_000,
  },
});
