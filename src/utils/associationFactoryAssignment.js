/** 組合承認時に指定された手配先工場 ID 一覧 */
export function associationAssignedFactoryIds(order) {
  const raw =
    order?.association_assigned_factory_ids ?? order?.associationAssignedFactoryIds ?? [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
}

export function hasAssociationFactoryAssignment(order) {
  return associationAssignedFactoryIds(order).length > 0;
}

/** 承認 API 用: メイン工場と割当一覧を正規化 */
export function normalizeAssociationFactorySelection({
  preferredFactoryId,
  preferred_factory_id,
  associationAssignedFactoryIds,
  association_assigned_factory_ids,
} = {}) {
  const mainRaw = preferredFactoryId ?? preferred_factory_id ?? '';
  const mainId = mainRaw != null ? String(mainRaw).trim() : '';
  const poolRaw = associationAssignedFactoryIds ?? association_assigned_factory_ids ?? [];
  const ids = Array.isArray(poolRaw)
    ? [...new Set(poolRaw.map((x) => String(x).trim()).filter(Boolean))]
    : [];
  if (mainId && !ids.includes(mainId)) ids.unshift(mainId);
  const finalMain = mainId || ids[0] || null;
  const finalIds = finalMain ? [finalMain, ...ids.filter((id) => id !== finalMain)] : ids;
  return {
    preferredFactoryId: finalMain,
    associationAssignedFactoryIds: finalIds,
  };
}
