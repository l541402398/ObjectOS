import { defineConfig } from 'tsup'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

export default defineConfig({
  entry: { index: resolve(root, 'apps/server/src/index.ts') },
  outDir: resolve(root, 'apps/server/dist'),
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  noExternal: [/^@projectos\//],
  external: ['pg', 'better-auth', 'fastify', 'zod'],
  outExtension: () => ({ js: '.js' }),
})
