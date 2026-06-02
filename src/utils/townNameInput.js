const TOWN_HISTORY_STORAGE_KEY = 'haisha_town_name_history_v1';
const MAX_TOWN_HISTORY = 5;

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
    const data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object') return;

    const withoutDup = (Array.isArray(data[area]) ? data[area] : [])
      .map((t) => normalizeTownName(t))
      .filter((t) => t && t !== town);

    data[area] = [town, ...withoutDup].slice(0, MAX_TOWN_HISTORY - 1);
    localStorage.setItem(TOWN_HISTORY_STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * datalist 用: 履歴（新しい順）を先頭、続けて API 候補をあいうえお順（重複除外）
 */
export function buildTownDatalistOptions(townSuggestions, deliveryArea) {
  const apiSorted = sortTownNamesJa(townSuggestions);
  const history = loadTownNameHistory(deliveryArea);
  const apiSet = new Set(apiSorted);
  const historyUnique = history.filter((t) => !apiSet.has(t));
  return [...historyUnique, ...apiSorted];
}
