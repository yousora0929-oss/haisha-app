/**
 * 通知アラーム — Web Audio API（ハーモニクス風コード・ロングサステイン）
 * HTMLAudio / <audio> は使わず、メディアセッションを起動しない。
 */

/** Aadd9 / AM7 風のきらびやかな和音（A4, E5, A5, C#6） */
const CHORD_FREQS = [440, 660, 880, 1100];
const CHORD_GAINS = [0.25, 0.22, 0.18, 0.15];
const CHORD_DURATION_S = 1.6;
const LOOP_INTERVAL_MS = 2000;
const RETRY_MS = 3500;

let audioCtx = null;
let alarmIntervalId = null;
let retryTimeoutId = null;
let isPlaying = false;

function getAudioContextClass() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function ensureContext() {
  const Ctx = getAudioContextClass();
  if (!Ctx) return null;
  if (!audioCtx || audioCtx.state === 'closed') {
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

function clearLoopTimers() {
  if (alarmIntervalId != null) {
    window.clearInterval(alarmIntervalId);
    alarmIntervalId = null;
  }
  if (retryTimeoutId != null) {
    window.clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }
}

/** ギターハーモニクスのような美しい和音（ポローン……） */
function playHarmonicsCode() {
  const ctx = audioCtx;
  if (!ctx || !isPlaying || ctx.state === 'suspended') return;

  const now = ctx.currentTime;
  const duration = CHORD_DURATION_S;

  CHORD_FREQS.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);

    const strumDelay = index * 0.02;
    const startTime = now + strumDelay;
    const peak = CHORD_GAINS[index];

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(peak, startTime + 0.04);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.1);
  });
}

function triggerAlarmLoop() {
  if (!isPlaying) return;

  const ctx = ensureContext();
  if (!ctx) {
    retryTimeoutId = window.setTimeout(triggerAlarmLoop, RETRY_MS);
    return;
  }

  const startLoop = () => {
    if (!isPlaying) return;
    clearLoopTimers();
    playHarmonicsCode();
    alarmIntervalId = window.setInterval(() => {
      if (isPlaying) playHarmonicsCode();
    }, LOOP_INTERVAL_MS);
  };

  if (ctx.state === 'suspended') {
    ctx
      .resume()
      .then(startLoop)
      .catch(() => {
        if (isPlaying) {
          retryTimeoutId = window.setTimeout(triggerAlarmLoop, RETRY_MS);
        }
      });
  } else {
    startLoop();
  }
}

/** ログインやタップ時に AudioContext を解放 */
export function primeNotificationAlarm() {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
}

/** 通知表示中：2秒サイクルで和音をループ */
export function startNotificationAlarm() {
  stopNotificationAlarm();
  isPlaying = true;
  triggerAlarmLoop();
}

export function stopNotificationAlarm() {
  isPlaying = false;
  clearLoopTimers();
  if (audioCtx && audioCtx.state === 'running') {
    void audioCtx.suspend().catch(() => {});
  }
}

export function isNotificationAlarmPlaying() {
  return isPlaying;
}
