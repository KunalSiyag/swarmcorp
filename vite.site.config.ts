import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The marketing site: static, deployable to any host with an SPA fallback (see site/public/_redirects).
export default defineConfig({
  root: 'site',
  // GitHub Pages serves the site under /<repo>/: build with SITE_BASE=/swarmcorp/.
  base: process.env.SITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist-site', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: { port: 5174, strictPort: true },
});
