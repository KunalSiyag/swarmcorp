import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const hub = `127.0.0.1:${process.env.SWARMCORP_PORT ?? 4317}`;

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://${hub}`, changeOrigin: true },
      '/ws': { target: `ws://${hub}`, ws: true, changeOrigin: true },
    },
  },
});
