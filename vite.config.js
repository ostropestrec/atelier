import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        // CSS inline v JS bundlu — žádný separátní dist/style.css.
        // Drží islands plně self-contained: index.html načítá jediný soubor.
        css: 'injected'
      }
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: true,
    lib: {
      entry: resolve(process.cwd(), 'svelte/main.ts'),
      formats: ['es'],
      fileName: () => 'atelier-svelte.js'
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
})
