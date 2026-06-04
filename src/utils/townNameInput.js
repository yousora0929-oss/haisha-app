const TOWN_HISTORY_STORAGE_KEY = 'haisha_town_name_history_v1';
const MAX_TOWN_HISTORY = 5;
/** 空欄フォーカス時に固定表示する「よく使う」件数 */
export const TOWN_FAVORITE_DISPLAY_COUNT = 5;

function normalizeTownName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/** 五十音順（あいうえお）で町名をソート */
export function sortTownNamesJa(names) {
  return [...(Array.isArray(names) ? names : [])]
    .map((name) => normalizeTownName(name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, 'ja', { sensitivity: 'base' }));
}

function normalizeTownKana(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

/**
 * API 町名候補（{town, town_kana} 等）を「フリガナ」基準で五十音ソートして町名だけ返す
 */
export function sortTownSuggestionsByKana(townSuggestions) {
  const list = Array.isArray(townSuggestions) ? townSuggestions : [];
  const normalized = [];

  for (const item of list) {
    if (item == null) continue;
    if (typeof item === 'string') {
      const town = normalizeTownName(item);
      if (town) normalized.push({ town, kana: '' });
      continue;
    }
    if (typeof item === 'object') {
      const town = normalizeTownName(item.town ?? item.name ?? item.value);
      if (!town) continue;
      const kana = normalizeTownKana(item.town_kana ?? item.kana ?? item.kanaTown ?? '');
      normalized.push({ town, kana });
    }
  }

  normalized.sort((a, b) => {
    const ka = a.kana || a.town;
    const kb = b.kana || b.town;
    const byKana = ka.localeCompare(kb, 'ja', { sensitivity: 'base' });
    if (byKana !== 0) return byKana;
    return a.town.localeCompare(b.town, 'ja', { sensitivity: 'base' });
  });

  const out = [];
  const seen = new Set();
  for (const row of normalized) {
    if (seen.has(row.town)) continue;
    seen.add(row.town);
    out.push(row.town);
  }
  return out;
}

export function loadTownNameHistory(deliveryArea) {
  const area = normalizeTownName(deliveryArea);
  if (!area || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TOWN_HISTORY_STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    const list = data[area];
    if (!Array.isArray(list)) return [];
    return list.map((t) => normalizeTownName(t)).filter(Boolean);
  } catch {
    return [];
  }
}

/** 選択・確定した町名を履歴先頭に保存（同一市町村内・最大5件） */
export function saveTownNameToHistory(deliveryArea, townName) {
  const area = normalizeTownName(deliveryArea);
  const town = normalizeTownName(townName);
  if (!area || !town || typeof localStorage === 'undefined') return;

  try {
    const raw = localStorage.getItem(TOWN_HISTORY_STORAGE_KEY);
    let data = {};
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }
    }
    if (!data || typeof data !== 'object') return;

    const withoutDup = (Array.isArray(data[area]) ? data[area] : [])
      .map((t) => normalizeTownName(t))
      .filter((t) => t && t !== town);

    data[area] = [town, ...withoutDup].slice(0, MAX_TOWN_HISTORY);
    localStorage.setItem(TOWN_HISTORY_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * 空欄時に表示する「よく使う地名」（直近履歴優先・最大5件）
 * 履歴が足りない場合は apiPool の先頭から補完（初回利用時のスクロール回避）
 */
export function getFavoriteTownNames(
  deliveryArea,
  limit = TOWN_FAVORITE_DISPLAY_COUNT,
  apiPool = [],
) {
  const history = loadTownNameHistory(deliveryArea).slice(0, limit);
  if (history.length >= limit) return history;

  const seen = new Set(history);
  const out = [...history];
  const pool = Array.isArray(apiPool) ? apiPool : [];
  for (const name of pool) {
    if (out.length >= limit) break;
    const town = normalizeTownName(name);
    if (!town || seen.has(town)) continue;
    seen.add(town);
    out.push(town);
  }
  return out;
}

/** マッチ優先度: 0=前方一致, 1=部分一致, 2=非該当 */
export function getTownNameMatchRank(townName, query) {
  const town = normalizeTownName(townName).toLowerCase();
  const q = normalizeTownName(query).toLowerCase();
  if (!q) return 0;
  if (!town) return 2;
  if (town.startsWith(q)) return 0;
  if (town.includes(q)) return 1;
  return 2;
}

/**
 * 全候補プール（履歴＋API・重複除外）
 */
export function buildTownSuggestPool(townSuggestions, deliveryArea) {
  const apiSorted = sortTownSuggestionsByKana(townSuggestions);
  const history = loadTownNameHistory(deliveryArea);
  const seen = new Set();
  const out = [];
  for (const name of [...history, ...apiSorted]) {
    const t = normalizeTownName(name);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** @deprecated buildTownSuggestPool を使用 */
export function buildTownDatalistOptions(townSuggestions, deliveryArea) {
  return buildTownSuggestPool(townSuggestions, deliveryArea);
}

/**
 * 入力文字列で絞り込み＋前方一致優先ソート（スクロール削減）
 */
export function filterTownSuggestByQuery(townPool, query, limit = 36) {
  const list = Array.isArray(townPool) ? townPool : [];
  const q = normalizeTownName(query);
  if (!q) return [];
  return list
    .filter((town) => getTownNameMatchRank(town, q) < 2)
    .sort((a, b) => {
      const ra = getTownNameMatchRank(a, q);
      const rb = getTownNameMatchRank(b, q);
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b, 'ja', { sensitivity: 'base' });
    })
    .slice(0, limit);
}
