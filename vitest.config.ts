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
