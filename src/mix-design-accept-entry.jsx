import React from 'react';
import { createRoot } from 'react-dom/client';
import { MixDesignAcceptApp } from './MixDesignAcceptApp.jsx';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[mix-design-accept-entry] #root が見つかりません。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <MixDesignAcceptApp />
  </React.StrictMode>,
);
