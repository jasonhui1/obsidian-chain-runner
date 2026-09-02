import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The quick path is the one module that reaches into Obsidian; `tests/obsidian.ts`
      // stands in for it so the decisions it makes can be driven without a vault.
      obsidian: fileURLToPath(new URL('./tests/obsidian.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
