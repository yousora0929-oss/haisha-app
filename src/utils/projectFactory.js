/** 物件のメイン工場 ID（null / 未設定は空文字） */
export function resolveProjectMainFactoryId(project) {
  if (!project || typeof project !== 'object') return '';
  const raw = project.main_factory_id ?? project.mainFactoryId ?? '';
  const id = String(raw ?? '').trim();
  return id || '';
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
