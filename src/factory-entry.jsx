import React from 'react';
import { createRoot } from 'react-dom/client';
import { FactoryApp } from './FactoryApp.jsx';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[factory-entry] #root が見つかりません。HTML に <div id="root"></div> があるか確認してください。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <FactoryApp />
  </React.StrictMode>,
);
