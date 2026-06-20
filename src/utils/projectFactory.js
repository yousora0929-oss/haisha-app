/** 物件のメイン工場 ID（null / 未設定は空文字） */
export function resolveProjectMainFactoryId(project) {
  if (!project || typeof project !== 'object') return '';
  const raw = project.main_factory_id ?? project.mainFactoryId ?? '';
  const id = String(raw ?? '').trim();
  return id || '';
}

/** 物件選択時のソフト警告（ドロップダウン表示は妨げない） */
export function getProjectDataGapWarnings(project) {
  if (!project || typeof project !== 'object') return [];
  const warnings = [];
  if (!resolveProjectMainFactoryId(project)) {
    warnings.push('メイン工場が未設定です（管理画面で設定してください）');
  }
  const lat = project.lat != null ? Number(project.lat) : NaN;
  const lng = project.lng != null ? Number(project.lng) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    warnings.push('現場座標が未設定です（現場地図で荷卸し地点を保存してください）');
  }
  return warnings;
}

/**
 * メイン工場変更時にサブ工場 ID 集合を更新（新メインを除外・旧メインを追加）
 * @param {Iterable<string>} prevSubIds
 */
export function swapMainFactorySubIds(prevSubIds, oldMainId, newMainId) {
  const next = new Set(prevSubIds instanceof Set ? prevSubIds : prevSubIds || []);
  const normalizedNew = String(newMainId ?? '').trim();
  const normalizedOld = String(oldMainId ?? '').trim();
  if (normalizedNew) next.delete(normalizedNew);
  if (normalizedOld && normalizedOld !== normalizedNew) next.add(normalizedOld);
  return next;
}

/** ゲスト発注フォーム用 — 物件メイン工場を第一希望の初期値に（未設定は空文字） */
export function resolveGuestPreferredFactoryId(project) {
  return resolveProjectMainFactoryId(project);
}
