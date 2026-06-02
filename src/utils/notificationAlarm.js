/**
 * 通知アラーム — Web Audio API 合成ビープ
 * HTMLAudio / <audio> は使わず、メディアセッション（ロック画面プレイヤー）を起動しない。
 */

const BEEP_HZ_PRIMARY = 1000;
const BEEP_HZ_ALT = 880;
const BEEP_ON_S = 0.1;
const BEEP_OFF_S = 0.05;
const BEEPS_PER_BURST = 3;
const PAUSE_AFTER_BURST_S = 0.55;
const MAX_GAIN = 0.92;

/** 自動再生がブロックされたときの再試行間隔（ms） */
const RETRY_INTERVAL_MS = 3500;

let audioContext = null;
let alarmActive = false;
let burstTimer = null;
let retryTimer = null;
let primed = false;

function getAudioContextClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function createAudioContext() {
  const Ctx = getAudioContextClass();
  if (!Ctx) return null;
  try {
    return new Ctx();
  } catch {
    return null;
  }
}

async function ensureAudioContext() {
  const Ctx = getAudioContextClass();
  if (!Ctx) return null;

  if (audioContext?.state === 'closed') {
    audioContext = null;
  }
  if (!audioContext) {
    audioContext = createAudioContext();
  }
  if (!audioContext) return null;

  if (audioContext.state === 'suspended') {
    try {
      await audioContext.resume();
    } catch (err) {
      console.warn('[notificationAlarm] AudioContext resume failed', err);
      return null;
    }
  }
  return audioContext;
}

function burstLengthSec() {
  return BEEPS_PER_BURST * BEEP_ON_S + (BEEPS_PER_BURST - 1) * BEEP_OFF_S;
}

/** 単発ビープ（オシレーター + ゲインエンベロープ） */
function scheduleBeep(ctx, startTime, frequencyHz) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(frequencyHz, startTime);

  const end = startTime + BEEP_ON_S;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(MAX_GAIN, startTime + 0.006);
  gain.gain.setValueAtTime(MAX_GAIN, end - 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(end + 0.02);
}

/** 「ピピピッ」— 0.1秒 × 3回（0.05秒間隔）、880/1000Hz 交互 */
function playBeepBurst(ctx) {
  const t0 = ctx.currentTime + 0.01;
  for (let i = 0; i < BEEPS_PER_BURST; i += 1) {
    const start = t0 + i * (BEEP_ON_S + BEEP_OFF_S);
    const hz = i % 2 === 0 ? BEEP_HZ_PRIMARY : BEEP_HZ_ALT;
    scheduleBeep(ctx, start, hz);
  }
}

async function runBurstOnce() {
  if (!alarmActive) return false;
  const ctx = await ensureAudioContext();
  if (!ctx || !alarmActive) return false;
  try {
    playBeepBurst(ctx);
    return true;
  } catch (err) {
    console.warn('[notificationAlarm] beep burst failed', err);
    return false;
  }
}

function clearBurstTimer() {
  if (burstTimer != null) {
    window.clearTimeout(burstTimer);
    burstTimer = null;
  }
}

function scheduleNextBurst() {
  clearBurstTimer();
  if (!alarmActive) return;

  const delayMs = (burstLengthSec() + PAUSE_AFTER_BURST_S) * 1000;
  burstTimer = window.setTimeout(() => {
    if (!alarmActive) return;
    void runBurstOnce().then(() => {
      if (alarmActive) scheduleNextBurst();
    });
  }, delayMs);
}

async function startBurstLoop() {
  const ok = await runBurstOnce();
  if (alarmActive) scheduleNextBurst();
  return ok;
}

function startRetryTimer() {
  if (retryTimer != null) return;
  retryTimer = window.setInterval(() => {
    if (!alarmActive) return;
    if (!audioContext || audioContext.state === 'suspended') {
      void startBurstLoop();
    }
  }, RETRY_INTERVAL_MS);
}

function clearRetryTimer() {
  if (retryTimer != null) {
    window.clearInterval(retryTimer);
    retryTimer = null;
  }
}

/**
 * ログイン等のユーザー操作直後に呼び、自動再生制限を緩和する
 */
export function primeNotificationAlarm() {
  if (primed) return;
  void (async () => {
    const ctx = await ensureAudioContext();
    if (!ctx) return;
    scheduleBeep(ctx, ctx.currentTime + 0.01, BEEP_HZ_PRIMARY);
    primed = true;
  })();
}

/**
 * 重要通知用：閉じるまでビープを繰り返し再生
 */
export function startNotificationAlarm() {
  stopNotificationAlarm();
  alarmActive = true;
  void startBurstLoop();
  startRetryTimer();
}

export function stopNotificationAlarm() {
  alarmActive = false;
  clearBurstTimer();
  clearRetryTimer();
  if (audioContext && audioContext.state === 'running') {
    void audioContext.suspend().catch(() => {});
  }
}

export function isNotificationAlarmPlaying() {
  return alarmActive;
}
