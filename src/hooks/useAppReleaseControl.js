import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient.js';

const POLL_INTERVAL_MS = 30 * 60 * 1000;
const GRACE_LIMIT_MS = 10 * 60 * 1000;
const SESSION_RELOAD_FLAG = 'cl_app_release_auto_reloaded';

/** 現在ビルドのバージョン（epoch ms 文字列） */
export const APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? String(__APP_VERSION__) : '0';

/**
 * 自動リロードを一時ブロックしたい画面（注文フォーム入力中など）が
 * true を立てる。編集開始時に set、保存/破棄時に解除する。
 */
export function setAutoReloadBlocked(blocked) {
  if (typeof window === 'undefined') return;
  window.__autoReloadBlocked = Boolean(blocked);
}

export function isAutoReloadBlocked() {
  if (typeof window === 'undefined') return false;
  return Boolean(window.__autoReloadBlocked);
}

/** Service Worker があれば更新を促してからリロード */
async function hardReload({ force = false } = {}) {
  try {
    if (!force && typeof sessionStorage !== 'undefined') {
      if (sessionStorage.getItem(SESSION_RELOAD_FLAG) === '1') return;
      sessionStorage.setItem(SESSION_RELOAD_FLAG, '1');
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
    }
  } catch {
    /* noop */
  }
  const url = new URL(window.location.href);
  url.searchParams.set('v', String(Date.now()));
  window.location.replace(url.toString());
}

/**
 * 配信バージョン購読＋強制リロード制御
 */
export function useAppReleaseControl() {
  const [release, setRelease] = useState(null);
  const reloadTimerRef = useRef(null);
  const graceTimerRef = useRef(null);
  const gracePollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const fetchRelease = async () => {
      try {
        const { data, error } = await supabase
          .from('app_release_control')
          .select('min_version, force_reload_at, message, updated_at')
          .eq('id', 1)
          .maybeSingle();
        if (error) {
          console.warn('[useAppReleaseControl] fetch failed', error);
          return;
        }
        if (!cancelled && data) setRelease(data);
      } catch (e) {
        console.warn('[useAppReleaseControl] fetch error', e);
      }
    };

    void fetchRelease();

    const channel = supabase
      .channel('app-release-control')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'app_release_control', filter: 'id=eq.1' },
        (payload) => {
          if (payload?.new) setRelease(payload.new);
        },
      )
      .subscribe();

    const pollId = window.setInterval(() => void fetchRelease(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchRelease();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
      window.clearInterval(pollId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const outdated = release
    ? Number(APP_VERSION) < Number(release.min_version || '0')
    : false;
  const forceAt = release?.force_reload_at
    ? new Date(release.force_reload_at).getTime()
    : null;

  useEffect(() => {
    window.clearTimeout(reloadTimerRef.current);
    window.clearTimeout(graceTimerRef.current);
    window.clearInterval(gracePollRef.current);
    reloadTimerRef.current = null;
    graceTimerRef.current = null;
    gracePollRef.current = null;

    if (!outdated || forceAt == null || !Number.isFinite(forceAt)) return undefined;

    const doReload = () => {
      if (isAutoReloadBlocked()) {
        graceTimerRef.current = window.setTimeout(() => {
          void hardReload({ force: false });
        }, GRACE_LIMIT_MS);
        gracePollRef.current = window.setInterval(() => {
          if (!isAutoReloadBlocked()) {
            window.clearInterval(gracePollRef.current);
            window.clearTimeout(graceTimerRef.current);
            gracePollRef.current = null;
            graceTimerRef.current = null;
            void hardReload({ force: false });
          }
        }, 15_000);
        return;
      }
      void hardReload({ force: false });
    };

    const delay = forceAt - Date.now();
    if (delay <= 0) doReload();
    else reloadTimerRef.current = window.setTimeout(doReload, delay);

    return () => {
      window.clearTimeout(reloadTimerRef.current);
      window.clearTimeout(graceTimerRef.current);
      window.clearInterval(gracePollRef.current);
    };
  }, [outdated, forceAt]);

  return {
    release,
    outdated,
    appVersion: APP_VERSION,
    reloadNow: () => hardReload({ force: true }),
  };
}

export function formatAppVersionLabel(version) {
  const n = Number(version);
  if (!Number.isFinite(n) || n <= 0) return String(version || '—');
  try {
    return new Date(n).toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(version);
  }
}
