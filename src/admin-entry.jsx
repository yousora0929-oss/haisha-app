import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './AdminApp.jsx';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[admin-entry] #root が見つかりません。');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);
