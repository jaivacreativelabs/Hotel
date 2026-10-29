import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.VITE_API_PROXY ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  // Older tablets and browsers too (iPad Safari 14+, Chrome/Edge 88+, Firefox 78+, Samsung 15+):
  // newer JavaScript and CSS syntax is rewritten into what they understand.
  build: { target: ['es2020', 'safari14', 'chrome88', 'edge88', 'firefox78'] },
  server: {
    port: 5173,
    // Same-origin in development: the browser only ever talks to Vite.
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/uploads': { target: api, changeOrigin: false },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
