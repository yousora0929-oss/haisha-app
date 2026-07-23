import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './AdminApp.jsx';
import { ThemeProvider } from './components/ThemeProvider.jsx';
import AppUpdateBanner from './components/AppUpdateBanner.jsx';
import './theme.css';
import { initTheme } from './utils/theme.js';
import { restoreMapEditorPanelAuthFromStorage } from './supabaseClient.js';

initTheme();
restoreMapEditorPanelAuthFromStorage({ overwrite: true });

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[admin-entry] #root が見つかりません。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppUpdateBanner />
      <AdminApp />
    </ThemeProvider>
  </React.StrictMode>,
);
