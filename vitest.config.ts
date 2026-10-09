import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  // tsconfig keeps jsx: preserve for Next; tests that render a component need it compiled.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    // Only run real .test.ts files we author under __tests__ — keep the existing
    // npx-tsx legacy tests (test:voice, test:email) out of the vitest pass so
    // they aren't double-executed.
    include: ['__tests__/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    reporters: 'default',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
