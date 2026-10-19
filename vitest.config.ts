import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const root = import.meta.dirname

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@projectos\/([a-z-]+)$/, replacement: resolve(root, 'packages/$1/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
  },
})
