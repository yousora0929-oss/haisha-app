import React from 'react';
import { createRoot } from 'react-dom/client';
import { MapEditorApp } from './MapEditorApp.jsx';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[map-editor-entry] #root が見つかりません。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <MapEditorApp />
  </React.StrictMode>,
);
