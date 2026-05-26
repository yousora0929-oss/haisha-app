/** 新規注文などの現場向け通知アラーム（public 配下） */
export const NOTIFICATION_ALARM_SRC = '/News-Accent01-1.mp3';

/** 自動再生がブロックされたときの再試行間隔（ms） */
const RETRY_INTERVAL_MS = 3500;

let audioEl = null;
let retryTimer = null;
let alarmActive = false;
let primed = false;

function getAudio() {
  if (typeof window === 'undefined') return null;
  if (!audioEl) {
    audioEl = new Audio(NOTIFICATION_ALARM_SRC);
    audioEl.preload = 'auto';
    audioEl.volume = 1;
  }
  return audioEl;
}

/**
 * ログイン等のユーザー操作直後に呼び、自動再生制限を緩和する（失敗してもクラッシュしない）
 */
export function primeNotificationAlarm() {
  const el = getAudio();
  if (!el || primed) return;
  el.volume = 1;
  const playPromise = el.play();
  if (!playPromise || typeof playPromise.then !== 'function') return;
  playPromise
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.loop = false;
      primed = true;
    })
    .catch(() => {
      /* 初回はブロックされても問題なし */
    });
}

async function attemptPlay() {
  const el = getAudio();
  if (!el || !alarmActive) return false;
  el.volume = 1;
  el.loop = true;
  try {
    if (!el.paused) return true;
    el.currentTime = 0;
    await el.play();
    return true;
  } catch (err) {
    console.warn('[notificationAlarm] play blocked or failed', err);
    return false;
  }
}

function startRetryTimer() {
  if (retryTimer != null) return;
  retryTimer = window.setInterval(() => {
    if (!alarmActive) return;
    const el = getAudio();
    if (el && el.paused) void attemptPlay();
  }, RETRY_INTERVAL_MS);
}

/**
 * 重要通知用：閉じるまでループ再生（音量最大）
 */
export function startNotificationAlarm() {
  stopNotificationAlarm();
  alarmActive = true;
  void attemptPlay();
  startRetryTimer();
}

export function stopNotificationAlarm() {
  alarmActive = false;
  if (retryTimer != null) {
    window.clearInterval(retryTimer);
    retryTimer = null;
  }
  const el = getAudio();
  if (!el) return;
  try {
    el.loop = false;
    el.pause();
    el.currentTime = 0;
  } catch {
    /* ignore */
  }
}

export function isNotificationAlarmPlaying() {
  const el = getAudio();
  return Boolean(el && !el.paused && alarmActive);
}
