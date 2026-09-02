import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    css: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/features/**/domain/**/*.ts',
        'src/database/repositories/**/*.ts',
        'src/reader-engines/**/*.ts',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
      thresholds: {
        'src/features/**/domain/**/*.ts': {
          statements: 90,
          branches: 55,
          functions: 60,
          lines: 90,
        },
        'src/database/repositories/**/*.ts': {
          statements: 45,
          branches: 30,
          functions: 40,
          lines: 50,
        },
        'src/reader-engines/**/*.ts': {
          statements: 80,
          branches: 60,
          functions: 75,
          lines: 85,
        },
      },
    },
  },
});
