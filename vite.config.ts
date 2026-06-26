import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [react(), cloudflare()],
  build: {
    outDir: 'dist/client'
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000'
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  }
});