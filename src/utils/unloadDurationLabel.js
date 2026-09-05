/** 荷卸し（車返却）予定時間の表示ラベル */
export function unloadDurationLabel(value) {
  const v = String(value ?? '30');
  if (v === '15') return '15分';
  if (v === '30') return '30分（標準）';
  if (v === '45') return '45分';
  if (v === '60') return '60分（手押し車など時間要）';
  if (v === '95_plus') return '95分以上（要相談）';
  if (v === '30分（標準）' || v === '30分') return '30分（標準）';
  return String(value || '30分（標準）');
}

/**
 * 注文オブジェクトから荷卸し時間ラベルを解決（FactoryApp.factoryUnloadDurationLabel 相当）
 * @param {object|null|undefined} order
 */
export function factoryUnloadDurationLabel(order) {
  const raw =
    order?.unloadDurationLabel ||
    order?.unloadDurationMinutes ||
    order?.unloadDuration ||
    order?.unloadingTime;
  return unloadDurationLabel(raw);
}
