import { todayLocalISODate } from '../haishaConstants.js';

export const ANALYZE_ORDER_TEXT_ERROR_MESSAGE = 'AIの解析に失敗しました';

const GEMINI_REST_MODEL = 'gemini-1.5-flash';
const GEMINI_GENERATE_CONTENT_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_REST_MODEL}:generateContent`;

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

function buildSystemInstructionText() {
  const jaDate = new Date().toLocaleDateString('ja-JP');
  const iso = todayLocalISODate();
  return `あなたは生コン工場の優秀な配車係です。以下のテキストから注文情報を抽出し、JSON配列のみを返してください。日付の基準日は ${jaDate}（ISO: ${iso}）です。「明日」「再来週」「来月の第2火曜」などはこの基準日から計算してください。

【出力ルール】
- 必ず JSON 配列のみを返す（説明文・マークダウン禁止）
- 注文が1件だけでも [{ ... }] のように要素1つの配列にする
- 複数日・複数時刻・複数数量がある場合はそれぞれ別オブジェクトに分ける
- 各オブジェクトのキー: date (YYYY-MM-DD), time (HH:MM 24h), volume (数値のみ), strength (数値のみ), slump (数値のみ), aggregate_size (20や40など数値のみ)
- 文脈で共通の配合・数量は各注文に適用してよい
- 不明な項目は妥当な一般値を推定（volume 未記載なら 3 など）`;
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

/** マークダウンや前後の説明文を除き JSON 部分だけを取り出す */
function extractJsonPayload(rawText) {
  let s = String(rawText || '').trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    s = fenced[1].trim();
  }
  const arrayStart = s.indexOf('[');
  const objectStart = s.indexOf('{');
  let start = -1;
  if (arrayStart >= 0 && (objectStart < 0 || arrayStart <= objectStart)) {
    start = arrayStart;
  } else if (objectStart >= 0) {
    start = objectStart;
  }
  if (start > 0) {
    s = s.slice(start);
  }
  const lastBracket = Math.max(s.lastIndexOf(']'), s.lastIndexOf('}'));
  if (lastBracket >= 0) {
    s = s.slice(0, lastBracket + 1);
  }
  return s.trim();
}

function extractTextFromGeminiResponse(data) {
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text != null && String(text).trim()) {
    return String(text).trim();
  }
  throw new Error('Empty or missing candidates[0].content.parts[0].text');
}

function failAnalyze(error, { rethrowGeneric = true } = {}) {
  console.error('【詳細なエラー原因】:', error);
  if (rethrowGeneric) {
    throw new Error(ANALYZE_ORDER_TEXT_ERROR_MESSAGE);
  }
  throw error;
}

async function callGeminiGenerateContent(apiKey, userText) {
  const url = `${GEMINI_GENERATE_CONTENT_URL}?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: {
      parts: [{ text: buildSystemInstructionText() }],
    },
    contents: [{ parts: [{ text: userText }] }],
    generationConfig: {
      responseMimeType: 'application/json',
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let data;
  try {
    data = await response.json();
  } catch (jsonErr) {
    console.error('【Gemini REST】レスポンスの JSON 化に失敗:', jsonErr);
    failAnalyze(jsonErr);
  }

  if (!response.ok) {
    console.error('【Gemini REST】Google API エラー詳細（response.ok=false）:', data);
    failAnalyze(new Error(`Gemini API HTTP ${response.status}`));
  }

  return extractTextFromGeminiResponse(data);
}

function parseAndNormalizeOrders(rawText) {
  console.log('【Geminiの生レスポンス】:', rawText);
  const jsonPayload = extractJsonPayload(rawText);
  let parsed;
  try {
    parsed = JSON.parse(jsonPayload);
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
}

/**
 * Gemini REST API で自然言語テキストから注文項目を抽出（複数件対応・常に配列で返す）
 * @returns {Promise<Array<{ date: string, time: string, volume: number, strength: number, slump: number, aggregate_size: number, mixText: string }>>}
 */
export async function analyzeOrderText(text) {
  // TODO(デバッグ用・一時): .env バイパス。本番前に import.meta.env.VITE_GEMINI_API_KEY に戻すこと
  const apiKey = 'AIzaSyBJgG3fKYQhEztd_AlkPpgX6DSU3GUdk8A';
  // if (envApiKey === undefined || envApiKey === null || String(envApiKey).trim() === '') {
  //   console.error('【エラー】APIキーが読み込まれていません。ローカルサーバーを再起動してください。');
  //   throw new Error(ANALYZE_ORDER_TEXT_ERROR_MESSAGE);
  // }

  const userText = String(text || '').trim();
  if (!userText) {
    failAnalyze(new Error('Empty input'));
  }

  try {
    const rawText = await callGeminiGenerateContent(apiKey, userText);
    return parseAndNormalizeOrders(rawText);
  } catch (error) {
    if (error?.message === ANALYZE_ORDER_TEXT_ERROR_MESSAGE) {
      throw error;
    }
    failAnalyze(error);
  }
}
