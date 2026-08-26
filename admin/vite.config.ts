import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-Proxy leitet /api und /ws an den lokalen SSH-Tunnel (https://localhost:8443).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'https://localhost:8443', changeOrigin: true, secure: false },
      '/ws': { target: 'https://localhost:8443', ws: true, changeOrigin: true, secure: false },
      '/media': { target: 'https://localhost:8443', changeOrigin: true, secure: false },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
