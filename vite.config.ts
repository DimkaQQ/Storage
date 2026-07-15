import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Split heavy vendors so they cache separately and load in parallel.
        manualChunks: {
          react: ['react', 'react-dom'],
          recharts: ['recharts'],
        },
      },
    },
  },
})
