import React from 'react';
import { createRoot } from 'react-dom/client';
import { DispatchApp } from './DispatchApp.jsx';
import { ThemeProvider } from './components/ThemeProvider.jsx';
import './theme.css';
import { initTheme } from './utils/theme.js';
import { initOneSignal, setupNotificationClickRedirect } from './utils/notification.js';
import { restoreMapEditorPanelAuthFromStorage } from './supabaseClient.js';

initTheme();
restoreMapEditorPanelAuthFromStorage({ overwrite: true });
void initOneSignal().then(() => setupNotificationClickRedirect());

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[dispatch-entry] #root が見つかりません。HTML に <div id="root"></div> があるか確認してください。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <ThemeProvider>
      <DispatchApp />
    </ThemeProvider>
  </React.StrictMode>,
);
