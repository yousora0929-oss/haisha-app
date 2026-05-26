import React from 'react';
import { createRoot } from 'react-dom/client';
import { MapEditorApp } from './MapEditorApp.jsx';
import { ThemeProvider } from './components/ThemeProvider.jsx';
import './theme.css';
import './mapEditorPrint.css';
import { initTheme } from './utils/theme.js';

initTheme();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[map-editor-entry] #root が見つかりません。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <ThemeProvider>
      <MapEditorApp />
    </ThemeProvider>
  </React.StrictMode>,
);
