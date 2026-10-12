/**
 * 通知アラーム — Web Audio API（音色は localStorage で切替）
 * HTMLAudio / <audio> は使わず、メディアセッションを起動しない。
 */

export const ALARM_SOUND_STORAGE_KEY = 'alarm_sound_type';

export const ALARM_SOUND_TYPES = {
  HARMONICS: 'harmonics',
  CHIME: 'chime',
  BUZZER: 'buzzer',
  MARIMBA: 'marimba',
  VISITOR_CHIME: 'visitor_chime',
};

export const ALARM_SOUND_LABELS = {
  [ALARM_SOUND_TYPES.HARMONICS]: 'ギターハーモニクス',
  [ALARM_SOUND_TYPES.CHIME]: '上品なチャイム',
  [ALARM_SOUND_TYPES.BUZZER]: '工場電子ブザー',
  [ALARM_SOUND_TYPES.MARIMBA]: '木琴（マリンバ）',
  [ALARM_SOUND_TYPES.VISITOR_CHIME]: '来客チャイム',
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

const MARIMBA_FREQS = [523, 659, 784];
const MARIMBA_STEP_S = 0.25;
const MARIMBA_DURATION_S = 0.6;
const MARIMBA_PEAK_GAIN = 0.5;
const MARIMBA_FOURTH_RATIO = 0.16;
const MARIMBA_LOOP_MS = 4200;

const VISITOR_NOTE1_HZ = 659;
const VISITOR_NOTE2_HZ = 523;
const VISITOR_NOTE1_S = 0.5;
const VISITOR_NOTE2_S = 1.2;
const VISITOR_PEAK_GAIN = 0.48;
const VISITOR_THIRD_RATIO = 0.12;
const VISITOR_LOOP_MS = 4800;

const RETRY_MS = 3500;

function isKnownAlarmSoundType(type) {
  return Object.values(ALARM_SOUND_TYPES).includes(type);
}

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
    if (isKnownAlarmSoundType(v)) return v;
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
  if (type === ALARM_SOUND_TYPES.MARIMBA) return MARIMBA_LOOP_MS;
  if (type === ALARM_SOUND_TYPES.VISITOR_CHIME) return VISITOR_LOOP_MS;
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

function scheduleSoftPartial(ctx, startTime, durationS, frequencyHz, peakGain) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequencyHz, startTime);
  const attackEnd = startTime + 0.008;
  const peak = Math.max(peakGain, 0.0002);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peak, attackEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationS);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + durationS + 0.05);
}

/** ④ 木琴 — sine + 弱めの4倍音。C5→E5→G5 */
function playMarimbaOnce(ctx) {
  const t0 = ctx.currentTime + 0.01;
  MARIMBA_FREQS.forEach((freq, index) => {
    const start = t0 + index * MARIMBA_STEP_S;
    scheduleSoftPartial(ctx, start, MARIMBA_DURATION_S, freq, MARIMBA_PEAK_GAIN);
    scheduleSoftPartial(
      ctx,
      start,
      MARIMBA_DURATION_S * 0.45,
      freq * 4,
      MARIMBA_PEAK_GAIN * MARIMBA_FOURTH_RATIO,
    );
  });
}

/** ⑤ 来客チャイム — sine + 弱い3倍音。E5→C5 */
function playVisitorChimeOnce(ctx) {
  const t0 = ctx.currentTime + 0.01;
  const notes = [
    { freq: VISITOR_NOTE1_HZ, start: 0, duration: VISITOR_NOTE1_S },
    { freq: VISITOR_NOTE2_HZ, start: VISITOR_NOTE1_S, duration: VISITOR_NOTE2_S },
  ];
  notes.forEach((note) => {
    const start = t0 + note.start;
    scheduleSoftPartial(ctx, start, note.duration, note.freq, VISITOR_PEAK_GAIN);
    scheduleSoftPartial(
      ctx,
      start,
      note.duration,
      note.freq * 3,
      VISITOR_PEAK_GAIN * VISITOR_THIRD_RATIO,
    );
  });
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
  if (type === ALARM_SOUND_TYPES.MARIMBA) {
    playMarimbaOnce(ctx);
    return;
  }
  if (type === ALARM_SOUND_TYPES.VISITOR_CHIME) {
    playVisitorChimeOnce(ctx);
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
  const soundType = isKnownAlarmSoundType(type) ? type : getAlarmSoundType();

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

const FACTORY_CHAT_NOTE1_HZ = 523;
const FACTORY_CHAT_NOTE2_HZ = 698;

/** 工場向けチャット着信 — 中音2音（注文アラーム・カスタマー着信音と区別） */
export function playFactoryChatNotificationSound() {
  const ctx = ensureContext();
  if (!ctx) return;

  const play = () => {
    const t0 = ctx.currentTime + 0.01;
    scheduleChatNote(ctx, t0, t0 + 0.2, FACTORY_CHAT_NOTE1_HZ);
    scheduleChatNote(ctx, t0 + 0.16, t0 + 0.42, FACTORY_CHAT_NOTE2_HZ);
  };

  if (ctx.state === 'suspended') {
    void ctx.resume().then(play).catch(() => {});
  } else {
    play();
  }
}

const CONFIRM_NOTE1_HZ = 587;
const CONFIRM_NOTE2_HZ = 784;
const CONFIRM_NOTE3_HZ = 988;

function scheduleConfirmNote(ctx, startTime, endTime, frequencyHz) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(frequencyHz, startTime);
  const attackEnd = startTime + 0.02;
  const releaseStart = Math.max(attackEnd, endTime - 0.06);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.7, attackEnd);
  if (releaseStart > attackEnd) gain.gain.setValueAtTime(0.7, releaseStart);
  gain.gain.linearRampToValueAtTime(0, endTime);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(endTime + 0.03);
}

/** 配車決定・工場受注 — 上品な3音チャイム（1回のみ） */
export function playOrderConfirmedSound() {
  const ctx = ensureContext();
  if (!ctx) return;

  const play = () => {
    const t0 = ctx.currentTime + 0.01;
    scheduleConfirmNote(ctx, t0, t0 + 0.22, CONFIRM_NOTE1_HZ);
    scheduleConfirmNote(ctx, t0 + 0.14, t0 + 0.38, CONFIRM_NOTE2_HZ);
    scheduleConfirmNote(ctx, t0 + 0.28, t0 + 0.55, CONFIRM_NOTE3_HZ);
  };

  if (ctx.state === 'suspended') {
    void ctx.resume().then(play).catch(() => {});
  } else {
    play();
  }
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
