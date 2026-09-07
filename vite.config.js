import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** /map-editor/:id、/order/:token、/mix-design/accept/:token を各 HTML にフォールバック */
function spaHtmlFallback() {
  const rewrite = (req) => {
    const url = req.url?.split('?')[0] || '';
    if (/^\/map-editor\/project\/[^/]+\/?$/.test(url) || /^\/map-editor\/[^/]+\/?$/.test(url)) {
      req.url = '/MapEditor.html';
    } else if (/^\/order\/[^/]+\/?$/.test(url) || /^\/guest-order\/[^/]+\/?$/.test(url)) {
      req.url = '/DispatchOrderPrototype.html';
    } else if (/^\/mix-design\/accept\/[^/]+\/?$/.test(url)) {
      req.url = '/MixDesignAccept.html';
    }
  };
  return {
    name: 'spa-html-fallback',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), spaHtmlFallback()],
  define: {
    __APP_VERSION__: JSON.stringify(String(Date.now())),
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        dispatch: resolve(__dirname, 'DispatchOrderPrototype.html'),
        factory: resolve(__dirname, 'FactoryTabletPrototype.html'),
        charter: resolve(__dirname, 'CharterTabletPrototype.html'),
        admin: resolve(__dirname, 'AdminPrototype.html'),
        mapEditor: resolve(__dirname, 'MapEditor.html'),
        mixDesignAccept: resolve(__dirname, 'MixDesignAccept.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('src/utils/deliveryAreas.js')) {
            return 'delivery-areas';
          }
        },
      },
    },
  },
});
