import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = import.meta.dirname
const repoRoot = resolve(root, '../..')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@projectos/contracts', '@projectos/organization-contracts', 'zod', 'ulid', 'ssh2'] })],
    resolve: {
      alias: {
        '@main': resolve(root, 'src/main'),
        'cpu-features': resolve(root, 'src/main/optional-cpu-features.ts'),
      },
    },
    build: {
      outDir: resolve(root, 'out/main'),
      sourcemap: true,
      rollupOptions: {
        input: resolve(root, 'src/main/index.ts'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@projectos/contracts'] })],
    build: {
      outDir: resolve(root, 'out/preload'),
      sourcemap: true,
      rollupOptions: {
        input: resolve(root, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(root, 'src/renderer/src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      fs: {
        allow: [repoRoot],
      },
    },
    build: {
      outDir: resolve(root, 'out/renderer'),
      sourcemap: true,
      rollupOptions: {
        input: resolve(root, 'src/renderer/index.html'),
      },
    },
  },
})
