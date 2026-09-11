/** 工場新着一覧: スポット注文かどうか（is_spot が true のときのみスポット） */
export function isFactorySpotInboxOrder(order) {
  return Boolean(order?.is_spot);
}

/**
 * 新着一覧を割当物件 / スポットに分割する。各グループ内の順序は入力順を維持する。
 * 件数 0 のグループは空配列のまま返す（描画側でセクション非表示）。
 */
export function splitFactoryInboxOrdersByKind(orders) {
  const assigned = [];
  const spot = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    if (isFactorySpotInboxOrder(order)) spot.push(order);
    else assigned.push(order);
  }
  return { assigned, spot };
}
