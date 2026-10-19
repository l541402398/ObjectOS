import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'apps/runtime/src/main.ts' },
  outDir: 'apps/runtime/dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  external: ['node:sqlite'],
  noExternal: [/^@projectos\//],
  banner: {
    js: [
      '// ProjectOS Runtime — generated bundle. Do not edit directly.',
      'import { createRequire as __projectosCreateRequire } from "node:module";',
      'const require = __projectosCreateRequire(import.meta.url);',
    ].join('\n'),
  },
})

