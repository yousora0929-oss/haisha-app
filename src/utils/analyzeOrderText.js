import { GoogleGenerativeAI } from '@google/generative-ai';
import { todayLocalISODate } from '../haishaConstants.js';

export const ANALYZE_ORDER_TEXT_ERROR_MESSAGE = 'AIの解析に失敗しました';

const GEMINI_MODEL = 'gemini-1.5-flash-latest';

const ORDER_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string', description: 'YYYY-MM-DD' },
    time: { type: 'string', description: 'HH:MM (24h)' },
    volume: { type: 'number', description: 'Quantity in m3, number only' },
    strength: { type: 'number', description: 'Design strength, number only' },
    slump: { type: 'number', description: 'Slump in cm, number only' },
    aggregate_size: { type: 'number', description: 'Max aggregate size mm, e.g. 20 or 40' },
  },
  required: ['date', 'time', 'volume', 'strength', 'slump', 'aggregate_size'],
};

/** Gemini へ渡す JSON 配列スキーマ */
const ORDER_ANALYSIS_ARRAY_SCHEMA = {
  type: 'array',
  items: ORDER_ITEM_SCHEMA,
};

/** "08:30" → TIME_SLOTS の value（分単位の文字列、例: "510"） */
export function timeStringToSlotValue(timeStr) {
  const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const totalMin = Number(m[1]) * 60 + Number(m[2]);
  if (!Number.isFinite(totalMin)) return null;
  return String(totalMin);
}

/** AI解析結果から配合文字列（例: 21-18-20N）を生成 */
export function buildMixTextFromAnalysis({ strength, slump, aggregate_size }) {
  const s = strength != null && strength !== '' ? Number(strength) : null;
  const sl = slump != null && slump !== '' ? Number(slump) : null;
  const agg = aggregate_size != null && aggregate_size !== '' ? Number(aggregate_size) : null;
  if (!Number.isFinite(s) || !Number.isFinite(sl) || !Number.isFinite(agg)) return '';
  return `${Math.round(s)}-${Math.round(sl)}-${Math.round(agg)}N`;
}

function buildTodayContextLine() {
  const now = new Date();
  const jaDate = now.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
  const iso = todayLocalISODate();
  const jaTime = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  return `本日の日付は ${jaDate}（ISO: ${iso}、現在時刻 ${jaTime}）です。これを基準に「明日」「再来週」「来月の第2火曜」などの相対的な日付を正確に計算してください。`;
}

function buildOrderAnalysisPrompt(userText) {
  const todayContext = buildTodayContextLine();
  return `${todayContext}

あなたは生コンクリート工場の優秀な受注アシスタントです。
顧客からの自然言語の注文依頼を読み取り、含まれる注文をすべて個別に分解して抽出してください。

【顧客の注文文】
${userText}

【出力ルール】
- 必ず JSON 配列のみを返す（説明文・マークダウン禁止）
- 注文が1件だけでも [{ ... }] のように要素1つの配列にする
- 複数日・複数時刻・複数数量が書かれている場合は、それぞれ別要素のオブジェクトに分ける
- 各オブジェクトは次のキーのみを持つ:
  - date: 希望納入日（YYYY-MM-DD）
  - time: 希望時刻（HH:MM、24時間制。例: 08:30）
  - volume: 数量（m³ の数値のみ。単位文字は含めない）
  - strength: 呼び強度・設計基準強度（数値のみ）
  - slump: スランプ（cm、数値のみ）
  - aggregate_size: 粗骨材の最大寸法（20 や 40 など数値のみ）
- 文脈で共通の配合・数量が書かれている場合は、各注文に同じ値を適用してよい
- 不明な項目は文脈から妥当な一般的値を推定（volume 未記載なら 3 など）`;
}

function normalizeTimeString(raw) {
  const s = String(raw ?? '').trim();
  const colon = s.match(/^(\d{1,2}):(\d{2})$/);
  if (colon) {
    return `${String(Number(colon[1])).padStart(2, '0')}:${colon[2]}`;
  }
  const jp = s.match(/^(\d{1,2})時(?:(\d{1,2})分|半)?$/);
  if (jp) {
    const h = Number(jp[1]);
    let m = jp[2] != null ? Number(jp[2]) : s.includes('半') ? 30 : 0;
    if (!Number.isFinite(m)) m = 0;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  return null;
}

function normalizeDateString(raw) {
  const s = String(raw ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function parseFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeAnalysisItem(parsed, index) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid item at index ${index}`);
  }

  const date = normalizeDateString(parsed.date);
  const time = normalizeTimeString(parsed.time);
  const volume = parseFiniteNumber(parsed.volume);
  const strength = parseFiniteNumber(parsed.strength);
  const slump = parseFiniteNumber(parsed.slump);
  const aggregate_size = parseFiniteNumber(parsed.aggregate_size);

  if (!date || !time || volume == null || strength == null || slump == null || aggregate_size == null) {
    throw new Error(`Missing or invalid fields at index ${index}`);
  }

  return { date, time, volume, strength, slump, aggregate_size };
}

function normalizeAnalysisList(parsed) {
  let items = parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (Array.isArray(parsed.orders)) items = parsed.orders;
    else items = [parsed];
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Empty or invalid order array');
  }
  return items.map((item, i) => normalizeAnalysisItem(item, i));
}

function extractJsonText(response) {
  const text = response?.text?.();
  if (text && String(text).trim()) return String(text).trim();
  throw new Error('Empty model response');
}

/**
 * Gemini API で自然言語テキストから注文項目を抽出（複数件対応・常に配列で返す）
 * @returns {Promise<Array<{ date: string, time: string, volume: number, strength: number, slump: number, aggregate_size: number }>>}
 */
function failAnalyze(error, { rethrowGeneric = true } = {}) {
  console.error('【詳細なエラー原因】:', error);
  if (rethrowGeneric) {
    throw new Error(ANALYZE_ORDER_TEXT_ERROR_MESSAGE);
  }
  throw error;
}

export async function analyzeOrderText(text) {
  const envApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (envApiKey === undefined || envApiKey === null || String(envApiKey).trim() === '') {
    console.error('【エラー】APIキーが読み込まれていません。ローカルサーバーを再起動してください。');
    throw new Error(ANALYZE_ORDER_TEXT_ERROR_MESSAGE);
  }

  const userText = String(text || '').trim();
  if (!userText) {
    const emptyErr = new Error('Empty input');
    failAnalyze(emptyErr);
  }

  const apiKey = String(envApiKey).trim();
  const prompt = buildOrderAnalysisPrompt(userText);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: ORDER_ANALYSIS_ARRAY_SCHEMA,
      },
    });

    const result = await model.generateContent(prompt);
    const rawText = extractJsonText(result.response);
    console.log('【Geminiの生レスポンス】:', rawText);

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      failAnalyze(parseErr);
    }

    try {
      const orders = normalizeAnalysisList(parsed);
      return orders.map((order) => ({
        ...order,
        mixText: buildMixTextFromAnalysis(order),
      }));
    } catch (normalizeErr) {
      failAnalyze(normalizeErr);
    }
  } catch (error) {
    if (error?.message === ANALYZE_ORDER_TEXT_ERROR_MESSAGE) {
      throw error;
    }
    failAnalyze(error);
  }
}
