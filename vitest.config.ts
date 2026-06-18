import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/__tests__/**/*.test.ts', 'apps/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        '**/__tests__/**',
        '**/*.d.ts',
        '**/*.config.*',
        'scripts/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@crm/shared': path.resolve(__dirname, 'packages/shared/src'),
      '@crm/database': path.resolve(__dirname, 'packages/database/src'),
      '@crm/email-engine': path.resolve(__dirname, 'packages/email-engine/src'),
      '@crm/enrichment': path.resolve(__dirname, 'packages/enrichment/src'),
      '@crm/scraper': path.resolve(__dirname, 'packages/scraper/src'),
      '@crm/ai-client': path.resolve(__dirname, 'packages/ai-client/src'),
    },
  },
});