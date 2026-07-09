import React, { useCallback, useEffect, useState } from 'react';
import * as db from './haishaDb.js';
import {
  setCharterPanelSession,
  clearCharterPanelSession,
  hasCharterPanelSession,
  CHARTER_AUTH_STORAGE_KEY,
  CHARTER_SESSION_STORAGE_KEY,
  CHARTER_PANEL_PASSWORD_KEY,
} from './supabaseClient.js';
import { CharterVehicleRegistrationPanel } from './components/CharterVehicleRegistrationPanel.jsx';
import { CharterOpenRequestsPanel } from './components/CharterOpenRequestsPanel.jsx';
import {
  buildCharterOneSignalExternalId,
  registerOneSignalUser,
  unregisterOneSignalUser,
} from './utils/notification.js';
import concreteLinkLogo from './assets/concrete-link-logo.svg';
import { APP_BRAND_HOME_LABEL, APP_BRAND_NAME } from './constants/brand.js';
import { countPendingCharterResponses } from './utils/charterBadges.js';

function readStoredCharterId() {
  try {
    return String(sessionStorage.getItem(CHARTER_SESSION_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function readAuthenticatedCharterId() {
  try {
    return String(sessionStorage.getItem(CHARTER_AUTH_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function CharterApp() {
  const [loginId, setLoginId] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [operator, setOperator] = useState(null);
  const [activeTab, setActiveTab] = useState('vehicles');
  const [charterPendingCount, setCharterPendingCount] = useState(0);

  const operatorId = operator?.id || readStoredCharterId();

  const refreshCharterPendingCount = useCallback(async () => {
    const rid = String(operator?.id || readStoredCharterId() || '').trim();
    if (!isAuthenticated || !rid) {
      setCharterPendingCount(0);
      return;
    }
    try {
      const [openRequests, myResponses] = await Promise.all([
        db.fetchOpenCharterRequestsForResponder('charter_operator', rid),
        db.fetchMyCharterResponses('charter_operator', rid),
      ]);
      setCharterPendingCount(countPendingCharterResponses(openRequests, myResponses));
    } catch (e) {
      console.error('[CharterApp] charter pending count failed', e);
    }
  }, [isAuthenticated, operator?.id]);

  useEffect(() => {
    void refreshCharterPendingCount();
  }, [refreshCharterPendingCount]);

  useEffect(() => {
    if (activeTab === 'requests') {
      void refreshCharterPendingCount();
    }
  }, [activeTab, refreshCharterPendingCount]);

  useEffect(() => {
    if (!isAuthenticated || !operatorId) return undefined;
    const id = window.setInterval(() => {
      void refreshCharterPendingCount();
    }, 60000);
    return () => window.clearInterval(id);
  }, [isAuthenticated, operatorId, refreshCharterPendingCount]);

  useEffect(() => {
    const stored = readStoredCharterId();
    const authStored = readAuthenticatedCharterId();
    if (stored && authStored && stored === authStored && hasCharterPanelSession()) {
      setLoginId(stored);
      setIsAuthenticated(true);
      setOperator({ id: stored, company_name: '' });
      void db
        .loginCharter(stored, sessionStorage.getItem(CHARTER_PANEL_PASSWORD_KEY) || '')
        .then(async (row) => {
          if (row) {
            setOperator(row);
            await registerOneSignalUser(buildCharterOneSignalExternalId(row.id), { role: 'charter' });
          }
        })
        .catch(() => {
          /* セッション復元時のプロフィール取得失敗は無視 */
        });
    } else {
      clearCharterPanelSession();
      try {
        sessionStorage.removeItem(CHARTER_SESSION_STORAGE_KEY);
        sessionStorage.removeItem(CHARTER_AUTH_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleLogin = useCallback(
    async (e) => {
      e.preventDefault();
      const id = String(loginId || '').trim();
      const password = String(loginPassword || '').trim();
      if (!id || !password) {
        setLoginError('IDとパスワードを入力してください');
        return;
      }
      setLoginLoading(true);
      setLoginError('');
      try {
        const row = await db.loginCharter(id, password);
        if (!row?.id) {
          setLoginError('チャーター業者IDまたはパスワードが間違っています');
          return;
        }
        setCharterPanelSession(row.id, password);
        try {
          sessionStorage.setItem(CHARTER_SESSION_STORAGE_KEY, row.id);
          sessionStorage.setItem(CHARTER_AUTH_STORAGE_KEY, row.id);
        } catch {
          /* ignore */
        }
        setOperator(row);
        setIsAuthenticated(true);
        await registerOneSignalUser(buildCharterOneSignalExternalId(row.id), { role: 'charter' });
      } catch (err) {
        setLoginError(err?.message || 'ログインに失敗しました');
      } finally {
        setLoginLoading(false);
      }
    },
    [loginId, loginPassword],
  );

  const handleLogout = useCallback(() => {
    void unregisterOneSignalUser();
    clearCharterPanelSession();
    try {
      sessionStorage.removeItem(CHARTER_SESSION_STORAGE_KEY);
      sessionStorage.removeItem(CHARTER_AUTH_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setIsAuthenticated(false);
    setOperator(null);
    setLoginPassword('');
    setLoginError('');
    setActiveTab('vehicles');
  }, []);

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-slate-100 px-4 py-[max(2rem,env(safe-area-inset-top))]">
        <form
          onSubmit={(e) => void handleLogin(e)}
          className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
        >
          <p className="text-xs font-black uppercase tracking-widest text-indigo-600">Charter Login</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">チャーター業者ログイン</h1>
          <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600">
            管理者から共有された業者IDとパスワードを入力してください。
          </p>

          <label htmlFor="charter-login-id" className="mt-5 block text-sm font-black text-slate-700">
            業者ID
          </label>
          <input
            id="charter-login-id"
            type="text"
            value={loginId}
            onChange={(e) => {
              setLoginId(e.target.value);
              setLoginError('');
            }}
            autoComplete="username"
            className="mt-2 w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-3 text-base font-bold text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            placeholder="業者IDを入力"
          />

          <label htmlFor="charter-login-password" className="mt-4 block text-sm font-black text-slate-700">
            パスワード
          </label>
          <input
            id="charter-login-password"
            type="password"
            value={loginPassword}
            onChange={(e) => {
              setLoginPassword(e.target.value);
              setLoginError('');
            }}
            autoComplete="current-password"
            className="mt-2 w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-3 text-base font-bold text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
            placeholder="パスワードを入力"
          />

          {loginError ? (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700">
              {loginError}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={loginLoading}
            className={
              'mt-5 min-h-[52px] w-full rounded-xl border-2 px-4 text-base font-black text-white shadow-lg transition ' +
              (loginLoading
                ? 'cursor-wait border-slate-400 bg-slate-400'
                : 'border-indigo-700 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99]')
            }
          >
            {loginLoading ? '確認中...' : 'ログイン'}
          </button>
        </form>
      </div>
    );
  }

  const displayName = String(operator?.company_name || '').trim() || 'チャーター業者';

  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-full flex-col overflow-hidden bg-slate-50">
      <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="/"
              className="inline-flex shrink-0 items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
              aria-label={APP_BRAND_HOME_LABEL}
            >
              <img src={concreteLinkLogo} alt={APP_BRAND_NAME} className="h-7 w-auto" />
            </a>
            <div className="min-w-0">
              <p className="truncate text-xs font-black text-slate-900">チャーター業者画面</p>
              <p className="truncate text-[11px] font-bold text-slate-500">{displayName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            ログアウト
          </button>
        </div>
        <div className="mx-auto mt-3 flex max-w-3xl gap-1 rounded-xl bg-slate-100 p-1">
          {[
            ['vehicles', '車両登録'],
            ['requests', '募集案件'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={
                'min-h-[36px] flex-1 rounded-lg px-3 py-1.5 text-xs font-black transition sm:text-sm ' +
                (activeTab === id
                  ? 'bg-indigo-600 text-white shadow ring-2 ring-indigo-200'
                  : 'text-slate-500 hover:bg-white hover:text-slate-900')
              }
            >
              <span className="inline-flex items-center justify-center">
                {label}
                {id === 'requests' && charterPendingCount > 0 ? (
                  <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold leading-none text-white shadow-sm animate-pulse">
                    {charterPendingCount}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {activeTab === 'vehicles' ? (
          <CharterVehicleRegistrationPanel
            ownerType="charter_operator"
            ownerId={operatorId}
            title="車両登録"
          />
        ) : (
          <CharterOpenRequestsPanel
            responderType="charter_operator"
            responderId={operatorId}
            title="募集案件"
            description="通知対象として登録されている工場からのチャーター募集に応答できます。"
            onResponsesChanged={refreshCharterPendingCount}
          />
        )}
      </main>
    </div>
  );
}
