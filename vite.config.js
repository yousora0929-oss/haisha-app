import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** /map-editor/:id および /order/:token を各 HTML にフォールバック（開発サーバー用） */
function spaHtmlFallback() {
  return {
    name: 'spa-html-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const url = req.url?.split('?')[0] || '';
        if (/^\/map-editor\/[^/]+\/?$/.test(url)) {
          req.url = '/MapEditor.html';
        } else if (/^\/order\/[^/]+\/?$/.test(url) || /^\/guest-order\/[^/]+\/?$/.test(url)) {
          req.url = '/DispatchOrderPrototype.html';
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), spaHtmlFallback()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        dispatch: resolve(__dirname, 'DispatchOrderPrototype.html'),
        factory: resolve(__dirname, 'FactoryTabletPrototype.html'),
        admin: resolve(__dirname, 'AdminPrototype.html'),
        mapEditor: resolve(__dirname, 'MapEditor.html'),
      },
    },
  },
});
