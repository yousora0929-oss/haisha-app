import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const MAPLIBRE_WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

/** maplibre worker は shared を相対 import するため、両ファイルを同階層に置く */
function copyMaplibreWorkersPlugin() {
  const copyInto = (dir) => {
    mkdirSync(dir, { recursive: true });
    for (const name of MAPLIBRE_WORKER_FILES) {
      copyFileSync(
        resolve(__dirname, 'node_modules/maplibre-gl/dist', name),
        resolve(dir, name),
      );
    }
  };
  return {
    name: 'copy-maplibre-workers',
    buildStart() {
      copyInto(resolve(__dirname, 'public'));
    },
    closeBundle() {
      copyInto(resolve(__dirname, 'dist'));
    },
  };
}

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
  plugins: [react(), spaHtmlFallback(), copyMaplibreWorkersPlugin()],
  resolve: {
    dedupe: ['maplibre-gl'],
  },
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
  /** Vitest 用。本番と同じ日本時間で日付整形を検証し、Supabase は接続しないダミー値で初期化する */
  test: {
    env: {
      TZ: 'Asia/Tokyo',
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'vitest-dummy-anon-key',
    },
  },
});
