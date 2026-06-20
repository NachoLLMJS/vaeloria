import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/admin/api': { target: 'http://localhost:8787', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin.html', import.meta.url)),
        gearPreview: fileURLToPath(new URL('gear-preview.html', import.meta.url)),
        assetsGallery: fileURLToPath(new URL('assets-gallery.html', import.meta.url)),
      },
    },
  },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'],
  },
});
