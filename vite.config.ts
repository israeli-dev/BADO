import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(rootDir, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|@tanstack)[\\/]/,
            },
            {
              name: 'supabase-vendor',
              test: /node_modules[\\/]@supabase[\\/]/,
            },
            {
              name: 'offline-forms-vendor',
              test: /node_modules[\\/](dexie|dexie-react-hooks|zod|react-hook-form|@hookform)[\\/]/,
            },
            {
              name: 'map-vendor',
              test: /node_modules[\\/](leaflet|react-leaflet|@react-leaflet|@turf)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
