/** 工場ニュース — 表示・既読集計ヘルパー */

export function normalizeTargetFactoryIds(raw) {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))];
}

/** 空配列 = 全工場向け */
export function isFactoryNewsVisibleToFactory(news, factoryId) {
  const fid = String(factoryId ?? '').trim();
  if (!fid || !news) return false;
  const targets = normalizeTargetFactoryIds(news.target_factory_ids);
  if (targets.length === 0) return true;
  return targets.includes(fid);
}

export function resolveNewsTargetFactoryIds(news, allFactoryIds) {
  const targets = normalizeTargetFactoryIds(news?.target_factory_ids);
  if (targets.length > 0) return targets;
  return [...new Set((allFactoryIds || []).map((x) => String(x ?? '').trim()).filter(Boolean))];
}

export function buildFactoryReadStatuses(news, reads, factories) {
  const newsId = String(news?.id ?? '');
  const targetIds = resolveNewsTargetFactoryIds(
    news,
    (factories || []).map((f) => f.id),
  );
  const readSet = new Set(
    (reads || [])
      .filter((r) => String(r.news_id) === newsId)
      .map((r) => String(r.factory_id)),
  );
  return targetIds.map((factoryId) => {
    const factory = (factories || []).find((f) => String(f.id) === factoryId);
    return {
      factoryId,
      factoryName: factory?.name || factoryId,
      read: readSet.has(factoryId),
    };
  });
}

export function countUnreadNewsForFactory(newsList, reads, factoryId) {
  const fid = String(factoryId ?? '').trim();
  if (!fid) return 0;
  const readNewsIds = new Set(
    (reads || []).filter((r) => String(r.factory_id) === fid).map((r) => String(r.news_id)),
  );
  return (newsList || []).filter((n) => isFactoryNewsVisibleToFactory(n, fid) && !readNewsIds.has(String(n.id)))
    .length;
}

export function formatFactoryNewsDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

/** 一覧行用（日付のみ） */
export function formatFactoryNewsDateShort(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function describeNewsTargets(news, factoryNameById = {}) {
  const targets = normalizeTargetFactoryIds(news?.target_factory_ids);
  if (targets.length === 0) return '全工場';
  return targets.map((id) => factoryNameById[id] || id).join('、');
}
