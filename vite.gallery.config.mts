import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Gallery-only build for the standalone Vercel deploy: just assets-gallery.html
// (+ everything in public/). Absolute base so it serves cleanly from the domain
// root, and no game/Privy code is bundled (the gallery script only imports three).
export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    outDir: 'dist-gallery',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: { assetsGallery: fileURLToPath(new URL('assets-gallery.html', import.meta.url)) },
    },
  },
});
