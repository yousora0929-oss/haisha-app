import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from './ThemeProvider.jsx';
import { AdminCsvDownloadButton } from './AdminCsvDownloadButton.jsx';
import {
  downloadCustomersExportCsv,
  downloadProjectsExportCsv,
} from '../utils/adminCsvImport.js';
import {
  ALARM_SOUND_LABELS,
  ALARM_SOUND_TYPES,
  getAlarmSoundType,
  playTestNotificationAlarm,
  primeNotificationAlarm,
  setAlarmSoundType,
} from '../utils/notificationAlarm.js';

const SECTION =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';

/**
 * 工場画面 — 設定管理タブ
 */
export function FactorySettingsPanel({
  projects = [],
  customers = [],
  onExportOrders,
  onLogout,
}) {
  const { effective, setMode } = useTheme();
  const [darkMode, setDarkMode] = useState(() => effective === 'dark');
  const [alarmType, setAlarmType] = useState(() => getAlarmSoundType());
  const [logoutConfirmed, setLogoutConfirmed] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setDarkMode(effective === 'dark');
  }, [effective]);

  const showNotice = useCallback((msg) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 4000);
  }, []);

  const handleDarkToggle = (checked) => {
    setDarkMode(checked);
    setMode(checked ? 'dark' : 'light');
  };

  const handleAlarmChange = (type) => {
    setAlarmType(type);
    setAlarmSoundType(type);
  };

  const handleTestSound = () => {
    primeNotificationAlarm();
    playTestNotificationAlarm(alarmType);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-8">
      <header>
        <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">設定管理</h2>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          表示・データ出力・通知音・ログアウト
        </p>
      </header>

      {notice ? (
        <p
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
        >
          {notice}
        </p>
      ) : null}

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

      <section className={SECTION}>
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">B. データ管理（CSVダウンロード）</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          Excel 向け UTF-8 BOM 付き。管理画面の一括取込フォーマットと同一です。
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <AdminCsvDownloadButton
            label="物件マスタをCSV出力"
            onDownload={() => {
              downloadProjectsExportCsv(projects, customers);
              showNotice(`${projects.length}件の物件マスタをダウンロードしました。`);
            }}
          />
          <AdminCsvDownloadButton
            label="業者マスタをCSV出力"
            onDownload={() => {
              downloadCustomersExportCsv(customers);
              showNotice(`${customers.length}件の業者マスタをダウンロードしました。`);
            }}
          />
          {onExportOrders ? (
            <AdminCsvDownloadButton
              label="注文一覧をCSV出力"
              onDownload={() => {
                onExportOrders();
                showNotice('注文一覧をダウンロードしました。');
              }}
            />
          ) : null}
        </div>
      </section>

      <section className={SECTION}>
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">C. 通知音設定（着信音）</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          新規注文通知で鳴る音色を選択できます。
        </p>
        <fieldset className="mt-4 space-y-2">
          {Object.values(ALARM_SOUND_TYPES).map((type) => (
            <label
              key={type}
              className={
                'flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 transition ' +
                (alarmType === type
                  ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-400 dark:bg-indigo-950/40'
                  : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900/30 dark:hover:bg-slate-800')
              }
            >
              <input
                type="radio"
                name="factory_alarm_sound"
                value={type}
                checked={alarmType === type}
                onChange={() => handleAlarmChange(type)}
                className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {ALARM_SOUND_LABELS[type]}
              </span>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          onClick={handleTestSound}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 border-indigo-300 bg-indigo-50 px-4 text-sm font-black text-indigo-900 hover:bg-indigo-100 dark:border-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-100 dark:hover:bg-indigo-900/50"
        >
          <span aria-hidden>🔊</span>
          音色のテスト確認
        </button>
      </section>

      <section className={'border-2 border-red-300 ' + SECTION + ' dark:border-red-800'}>
        <h3 className="text-sm font-black text-red-800 dark:text-red-300">D. ログアウト</h3>
        <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          誤操作防止のため、チェック後にのみログアウトできます。
        </p>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 dark:border-red-700 dark:bg-red-950/30">
          <input
            type="checkbox"
            checked={logoutConfirmed}
            onChange={(e) => setLogoutConfirmed(e.target.checked)}
            className="mt-0.5 h-5 w-5 rounded border-red-400 text-red-600 focus:ring-red-500"
          />
          <span className="text-sm font-black text-red-900 dark:text-red-200">ログアウトしますか？</span>
        </label>
        <button
          type="button"
          disabled={!logoutConfirmed}
          onClick={() => {
            if (!logoutConfirmed) return;
            onLogout?.();
          }}
          className={
            'mt-4 min-h-[48px] w-full rounded-xl px-4 text-sm font-black text-white shadow-md transition ' +
            (logoutConfirmed
              ? 'bg-red-600 hover:bg-red-700 active:scale-[0.99]'
              : 'cursor-not-allowed bg-red-300 opacity-50 dark:bg-red-900/50')
          }
        >
          システムからログアウトする
        </button>
      </section>
    </div>
  );
}
