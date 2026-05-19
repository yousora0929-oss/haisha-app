import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        dispatch: resolve(__dirname, 'DispatchOrderPrototype.html'),
        factory: resolve(__dirname, 'FactoryTabletPrototype.html'),
        admin: resolve(__dirname, 'AdminPrototype.html'),
      },
    },
  },
});
