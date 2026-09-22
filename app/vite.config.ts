import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Relative asset paths so serve.py can host dist/ at any mount point.
  base: './',
  resolve: { alias: { '@': here('./src') } },
  server: {
    port: 5173,
    // The Python backend owns the engine, STEP export, hand-off store and the Ollama proxy.
    proxy: { '/api': 'http://localhost:8765' },
    // parts/registry.json and validation_standards.json live one level up and are the
    // single source of truth for both the Python engine and this app.
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      input: { studio: here('./index.html'), customer: here('./customer.html') },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
