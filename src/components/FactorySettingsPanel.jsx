import React, { useCallback, useEffect, useState } from 'react';
import { useTheme } from './ThemeProvider.jsx';
import { AdminCsvDownloadButton } from './AdminCsvDownloadButton.jsx';
import {
  downloadCustomersExportCsv,
  downloadProjectsExportCsv,
} from '../utils/adminCsvImport.js';
import { CharterVehicleRegistrationPanel } from './CharterVehicleRegistrationPanel.jsx';
import { CharterNotificationPreferencesPanel } from './CharterNotificationPreferencesPanel.jsx';
import {
  ALARM_SOUND_LABELS,
  ALARM_SOUND_TYPES,
  getAlarmSoundType,
  playTestNotificationAlarm,
  primeNotificationAlarm,
  setAlarmSoundType,
} from '../utils/notificationAlarm.js';
import * as db from '../haishaDb.js';

const SECTION =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5';

const PREFERRED_TIMEOUT_OPTIONS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];

/**
 * 工場画面 — 設定管理タブ
 */
export function FactorySettingsPanel({
  factoryId,
  factories = [],
  projects = [],
  customers = [],
  onExportOrders,
  onCharterNotifySaved,
  onLogout,
  onFactoriesUpdated,
}) {
  const { effective, setMode } = useTheme();
  const [darkMode, setDarkMode] = useState(() => effective === 'dark');
  const [alarmType, setAlarmType] = useState(() => getAlarmSoundType());
  const [logoutConfirmed, setLogoutConfirmed] = useState(false);
  const [notice, setNotice] = useState('');
  const [timeoutMinutes, setTimeoutMinutes] = useState(15);
  const [timeoutSaving, setTimeoutSaving] = useState(false);

  useEffect(() => {
    setDarkMode(effective === 'dark');
  }, [effective]);

  useEffect(() => {
    const fid = String(factoryId || '').trim();
    const row = (Array.isArray(factories) ? factories : []).find((f) => String(f?.id || '') === fid);
    const raw = Number(row?.preferredNoResponseTimeoutMinutes ?? row?.preferred_no_response_timeout_minutes);
    setTimeoutMinutes(
      Number.isFinite(raw) && raw >= 5 && raw <= 60 && raw % 5 === 0 ? raw : 15,
    );
  }, [factoryId, factories]);

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

  const handleSaveTimeout = async () => {
    const fid = String(factoryId || '').trim();
    if (!fid) {
      showNotice('工場が選択されていません。');
      return;
    }
    setTimeoutSaving(true);
    try {
      await db.updateFactoryPreferredTimeoutMinutes(fid, timeoutMinutes);
      if (typeof onFactoriesUpdated === 'function') await onFactoriesUpdated();
      showNotice(`第一希望の応答期限を${timeoutMinutes}分に保存しました。`);
    } catch (err) {
      console.error('[FactorySettings] preferred timeout save failed', err);
      window.alert('保存に失敗しました。通信状態を確認してください。');
    } finally {
      setTimeoutSaving(false);
    }
  };

  return (
    <div className="w-full space-y-4 pb-8">
      <header>
        <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">設定管理</h2>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          表示・データ出力・通知音・第一希望応答期限・チャーター設定・ログアウト
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

      <section className={SECTION}>
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">D. 第一希望指定の応答期限</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          お客様が貴工場を第一希望に指定した注文で、この時間応答がない場合、お客様に他工場へ広げるか確認が届きます。
        </p>
        <label className="mt-4 block text-xs font-bold text-slate-600 dark:text-slate-300">
          応答期限（分）
          <select
            value={timeoutMinutes}
            onChange={(e) => setTimeoutMinutes(Number(e.target.value))}
            className="mt-2 w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-3 text-sm font-black text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
          >
            {PREFERRED_TIMEOUT_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}分
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={timeoutSaving || !factoryId}
          onClick={() => void handleSaveTimeout()}
          className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {timeoutSaving ? '保存中…' : '応答期限を保存'}
        </button>
      </section>

      <section className={SECTION}>
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">E. チャーター設定</h3>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          自工場で保有する車両の登録と、チャーター募集を出したときの通知優先順位を設定します。
        </p>
        <div className="mt-4 grid gap-6">
          <div>
            <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">🛻 車両登録</h4>
            <div className="mt-2">
              <CharterVehicleRegistrationPanel ownerType="factory" ownerId={factoryId} title="" />
            </div>
          </div>
          <hr className="border-slate-200 dark:border-slate-700" />
          <div>
            <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">🔔 通知優先順位</h4>
            <div className="mt-2">
              <CharterNotificationPreferencesPanel
                factoryId={factoryId}
                onSaved={(msg) => {
                  if (msg) showNotice(msg);
                  onCharterNotifySaved?.(msg);
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className={'border-2 border-red-300 ' + SECTION + ' dark:border-red-800'}>
        <h3 className="text-sm font-black text-red-800 dark:text-red-300">F. ログアウト</h3>
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
