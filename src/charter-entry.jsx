import React from 'react';
import { createRoot } from 'react-dom/client';
import { CharterApp } from './CharterApp.jsx';
import { ThemeProvider } from './components/ThemeProvider.jsx';
import AppUpdateBanner from './components/AppUpdateBanner.jsx';
import './theme.css';
import { initTheme } from './utils/theme.js';
import { initOneSignal, setupNotificationClickRedirect } from './utils/notification.js';

initTheme();
void initOneSignal().then(() => setupNotificationClickRedirect());

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[charter-entry] #root が見つかりません。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppUpdateBanner />
      <CharterApp />
    </ThemeProvider>
  </React.StrictMode>,
);
