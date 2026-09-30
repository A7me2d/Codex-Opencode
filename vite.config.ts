import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API is served by server.mjs (Relay Room), not by Vite. In dev, forward
// /api to that server so the exact same fetch paths work in dev and production.
const apiPort = Number(process.env.OPENCODE_OBSERVER_PORT ?? 4280)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${Number.isInteger(apiPort) && apiPort > 0 ? apiPort : 4280}`,
        changeOrigin: false,
      },
    },
  },
})
