import React from 'react';
import { createRoot } from 'react-dom/client';
import { DispatchApp } from './DispatchApp.jsx';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[dispatch-entry] #root が見つかりません。HTML に <div id="root"></div> があるか確認してください。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <DispatchApp />
  </React.StrictMode>,
);
