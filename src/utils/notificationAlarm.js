/**
 * 通知アラーム — Web Audio API（3種の音色・localStorage 切替）
 * HTMLAudio / <audio> は使わず、メディアセッションを起動しない。
 */

export const ALARM_SOUND_STORAGE_KEY = 'alarm_sound_type';

export const ALARM_SOUND_TYPES = {
  HARMONICS: 'harmonics',
  CHIME: 'chime',
  BUZZER: 'buzzer',
};

export const ALARM_SOUND_LABELS = {
  [ALARM_SOUND_TYPES.HARMONICS]: 'ギターハーモニクス',
  [ALARM_SOUND_TYPES.CHIME]: '上品なチャイム',
  [ALARM_SOUND_TYPES.BUZZER]: '工場電子ブザー',
};

const HARMONICS_FREQS = [440, 660, 880, 1100];
const HARMONICS_GAINS = [0.25, 0.22, 0.18, 0.15];
const HARMONICS_DURATION_S = 1.6;
const HARMONICS_LOOP_MS = 2000;

const CHIME_NOTE1_HZ = 660;
const CHIME_NOTE2_HZ = 880;
const CHIME_ATTACK_S = 0.02;
const CHIME_PEAK_GAIN = 0.88;
const CHIME_LOOP_MS = 1000;

const BUZZER_HZ_PRIMARY = 1000;
const BUZZER_HZ_ALT = 880;
const BUZZER_ON_S = 0.1;
const BUZZER_OFF_S = 0.05;
const BUZZER_COUNT = 3;
const BUZZER_PEAK_GAIN = 0.92;
const BUZZER_LOOP_MS = 1000;

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

export function getAlarmSoundType() {
  if (typeof window === 'undefined') return ALARM_SOUND_TYPES.HARMONICS;
  try {
    const v = String(localStorage.getItem(ALARM_SOUND_STORAGE_KEY) || '').trim();
    if (v === ALARM_SOUND_TYPES.CHIME || v === ALARM_SOUND_TYPES.BUZZER) return v;
  } catch {
    /* ignore */
  }
  return ALARM_SOUND_TYPES.HARMONICS;
}

export function setAlarmSoundType(type) {
  const valid = Object.values(ALARM_SOUND_TYPES);
  const next = valid.includes(type) ? type : ALARM_SOUND_TYPES.HARMONICS;
  try {
    localStorage.setItem(ALARM_SOUND_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

function loopIntervalMs(type) {
  if (type === ALARM_SOUND_TYPES.CHIME) return CHIME_LOOP_MS;
  if (type === ALARM_SOUND_TYPES.BUZZER) return BUZZER_LOOP_MS;
  return HARMONICS_LOOP_MS;
}

/** ① ギターハーモニクス — sine 4音・ロングサステイン */
function playHarmonicsOnce(ctx) {
  const now = ctx.currentTime;
  const duration = HARMONICS_DURATION_S;

  HARMONICS_FREQS.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    const startTime = now + index * 0.02;
    const peak = HARMONICS_GAINS[index];
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(peak, startTime + 0.04);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.1);
  });
}

function scheduleChimeNote(ctx, startTime, endTime, frequencyHz) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequencyHz, startTime);
  const attackEnd = startTime + CHIME_ATTACK_S;
  const releaseStart = Math.max(attackEnd, endTime - 0.04);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(CHIME_PEAK_GAIN, attackEnd);
  if (releaseStart > attackEnd) gain.gain.setValueAtTime(CHIME_PEAK_GAIN, releaseStart);
  gain.gain.linearRampToValueAtTime(0, endTime);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(endTime + 0.03);
}

/** ② 上品なチャイム — triangle ミ→ラ */
function playChimeOnce(ctx) {
  const t0 = ctx.currentTime + 0.008;
  scheduleChimeNote(ctx, t0, t0 + 0.15, CHIME_NOTE1_HZ);
  scheduleChimeNote(ctx, t0 + 0.12, t0 + 0.35, CHIME_NOTE2_HZ);
}

function scheduleBuzzerBeep(ctx, startTime, frequencyHz) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(frequencyHz, startTime);
  const end = startTime + BUZZER_ON_S;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(BUZZER_PEAK_GAIN, startTime + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(end + 0.02);
}

/** ③ 工場電子ブザー — square 3連 */
function playBuzzerOnce(ctx) {
  const t0 = ctx.currentTime + 0.01;
  for (let i = 0; i < BUZZER_COUNT; i += 1) {
    const start = t0 + i * (BUZZER_ON_S + BUZZER_OFF_S);
    const hz = i % 2 === 0 ? BUZZER_HZ_PRIMARY : BUZZER_HZ_ALT;
    scheduleBuzzerBeep(ctx, start, hz);
  }
}

function playAlarmOnce(ctx, type) {
  if (!ctx) return;
  if (type === ALARM_SOUND_TYPES.CHIME) {
    playChimeOnce(ctx);
    return;
  }
  if (type === ALARM_SOUND_TYPES.BUZZER) {
    playBuzzerOnce(ctx);
    return;
  }
  playHarmonicsOnce(ctx);
}

function playAlarmBurstForLoop() {
  const ctx = audioCtx;
  if (!ctx || !isPlaying || ctx.state === 'suspended') return;
  playAlarmOnce(ctx, getAlarmSoundType());
}

function triggerAlarmLoop() {
  if (!isPlaying) return;

  const ctx = ensureContext();
  if (!ctx) {
    retryTimeoutId = window.setTimeout(triggerAlarmLoop, RETRY_MS);
    return;
  }

  const soundType = getAlarmSoundType();
  const intervalMs = loopIntervalMs(soundType);

  const startLoop = () => {
    if (!isPlaying) return;
    clearLoopTimers();
    playAlarmBurstForLoop();
    alarmIntervalId = window.setInterval(playAlarmBurstForLoop, intervalMs);
  };

  if (ctx.state === 'suspended') {
    ctx
      .resume()
      .then(startLoop)
      .catch(() => {
        if (isPlaying) retryTimeoutId = window.setTimeout(triggerAlarmLoop, RETRY_MS);
      });
  } else {
    startLoop();
  }
}

/** 設定画面用：選択音色を1回だけテスト再生 */
export function playTestNotificationAlarm(type) {
  const soundType =
    type === ALARM_SOUND_TYPES.CHIME ||
    type === ALARM_SOUND_TYPES.BUZZER ||
    type === ALARM_SOUND_TYPES.HARMONICS
      ? type
      : getAlarmSoundType();

  const ctx = ensureContext();
  if (!ctx) return;

  const play = () => playAlarmOnce(ctx, soundType);
  if (ctx.state === 'suspended') {
    void ctx.resume().then(play).catch(() => {});
  } else {
    play();
  }
}

export function primeNotificationAlarm() {
  const ctx = ensureContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
}

const CHAT_NOTE1_HZ = 880;
const CHAT_NOTE2_HZ = 1175;
const CHAT_NOTE3_HZ = 1318;
const CHAT_PEAK_GAIN = 0.72;

function scheduleChatNote(ctx, startTime, endTime, frequencyHz) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequencyHz, startTime);
  const attackEnd = startTime + 0.015;
  const releaseStart = Math.max(attackEnd, endTime - 0.05);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(CHAT_PEAK_GAIN, attackEnd);
  if (releaseStart > attackEnd) gain.gain.setValueAtTime(CHAT_PEAK_GAIN, releaseStart);
  gain.gain.linearRampToValueAtTime(0, endTime);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(endTime + 0.03);
}

/** チャット着信 — 高音3音（ポーン♪）・1回のみ */
export function playChatNotificationSound() {
  const ctx = ensureContext();
  if (!ctx) return;

  const play = () => {
    const t0 = ctx.currentTime + 0.01;
    scheduleChatNote(ctx, t0, t0 + 0.16, CHAT_NOTE1_HZ);
    scheduleChatNote(ctx, t0 + 0.12, t0 + 0.34, CHAT_NOTE2_HZ);
    scheduleChatNote(ctx, t0 + 0.26, t0 + 0.52, CHAT_NOTE3_HZ);
  };

  if (ctx.state === 'suspended') {
    void ctx.resume().then(play).catch(() => {});
  } else {
    play();
  }
}

/** チャット通知音の再生許可（ユーザー操作後） */
export function primeChatNotificationSound() {
  primeNotificationAlarm();
}

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
