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
          // T-113d · MEDICIÓN THROWAWAY (NO mergear): single-fork serializa los files
          // para medir el costo vs file-parallelism. Es el experimento de la Opción A.
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
