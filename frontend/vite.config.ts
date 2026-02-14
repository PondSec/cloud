import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['cloud.pondsec.com'],
    proxy: {
      // Dev API proxy so external access via a reverse proxy works without hardcoding localhost in the browser.
      '/api': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
      // Make IDE accessible via the same origin (useful for LAN access where :18080 may be blocked).
      '/ide': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
        ws: true,
        rewrite: (p) => p.replace(/^\/ide/, ''),
      },
    },
  },
});
