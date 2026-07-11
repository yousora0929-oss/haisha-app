import React, { useEffect, useState } from 'react';
import { useTheme } from './ThemeProvider.jsx';

const SECTION =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';

/**
 * チャーター業者画面 — 設定タブ（表示設定のみ）
 */
export function CharterSettingsPanel() {
  const { effective, setMode } = useTheme();
  const [darkMode, setDarkMode] = useState(() => effective === 'dark');

  useEffect(() => {
    setDarkMode(effective === 'dark');
  }, [effective]);

  const handleDarkToggle = (checked) => {
    setDarkMode(checked);
    setMode(checked ? 'dark' : 'light');
  };

  return (
    <div className="w-full space-y-4 pb-8">
      <header>
        <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">設定</h2>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">表示設定</p>
      </header>

      <section className={SECTION}>
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">A. 表示設定（ダークモード）</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          ON にするとアプリ全体がダークテーマになります。
        </p>
        <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-600 dark:bg-slate-900/50">
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(e) => handleDarkToggle(e.target.checked)}
            className="h-5 w-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">ダークモードを有効にする</span>
        </label>
      </section>
    </div>
  );
}
