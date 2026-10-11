import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  // The Nebiru server (server/) answers everything under /api.
  server: { port: 5199, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  test: { environment: 'jsdom', include: ['src/**/*.test.ts'] },
})
