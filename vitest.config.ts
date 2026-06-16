import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/tests/**',
        'src/app/**/layout.tsx',
        'src/app/**/loading.tsx',
        'src/app/**/error.tsx',
        'src/app/**/not-found.tsx',
        'src/**/*.d.ts',
      ],
      // T-156: gate anti-regresión sobre la superficie REALMENTE testeada por los 3
      // projects (unit+component+integration). SOLO branches + functions GLOBAL:
      // Lines/Statements (~49%) están contaminados por ~210 .tsx que solo cubren los
      // E2E (invisibles a v8) → una página nueva sin unit los bajaría sin ser regresión.
      // branches/functions son robustos a ese ruido y muerden ante regresión de lógica.
      // Baseline medido (3 projects, CI con DB): branches 74.33% · functions 74.30%.
      // Umbral ~2 pts abajo por el retry:1 de integration (anti-flake). NO se setean
      // lines/statements → no gatean (se siguen reportando en html/lcov).
      // Aplica solo cuando corre con --coverage (el coverage job de ci.yml vía
      // scripts/test-coverage-local.mjs); `pnpm test` (unit+comp) no lo dispara.
      thresholds: {
        branches: 72,
        functions: 72,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'component',
          include: ['src/tests/unit/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/tests/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/tests/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: [],
          // Tests hablan con Supabase remoto: setup/cleanup crean users + consultoras.
          // Timeouts generosos por latencia de sa-east-1 + creación de users via auth.admin.
          testTimeout: 30000,
          hookTimeout: 60000,
          // T-153 · retry acotado SOLO acá: los integration tests tocan una DB real
          // (latencia, claims JWT, datos compartidos) → un fallo aislado puede ser flake de
          // infra, no regresión. Un test que pasa al 2º intento sigue marcándose como
          // "retried" en el reporter → visible, no oculta el flake. unit/component NO heredan
          // este retry (son projects separados y el config raíz no define `retry`): ahí un
          // retry escondería bugs reales en código determinístico.
          retry: 1,
        },
      },
    ],
  },
});
