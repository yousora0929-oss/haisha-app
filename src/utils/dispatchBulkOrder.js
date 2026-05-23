import { TIME_SLOTS } from '../haishaConstants.js';

const UNLOAD_LABELS = {
  '15': '15分',
  '30': '30分（標準）',
  '45': '45分',
  '60': '60分（手押し車など時間要）',
  '95_plus': '95分以上（要相談）',
};

function unloadDurationLabel(value) {
  return UNLOAD_LABELS[String(value || '')] || UNLOAD_LABELS['30'];
}

/**
 * 共通フォーム入力 + 1つの納入日から発注用 order オブジェクトを組み立てる
 */
export function buildDispatchOrderForDate(preferredDate, context) {
  const date = String(preferredDate || '').trim();
  const slot = String(context.timeSlot || '').trim();
  const slotMeta = TIME_SLOTS.find((s) => s.value === slot);
  const slotLabel = slotMeta?.label ?? '';
  const timeMinutes = parseInt(slot, 10);
  const qtyTrim = String(context.quantityM3 ?? '').trim();
  const mixText = String(context.mixText ?? '').trim();

  const {
    orderKind,
    currentCustomerId,
    currentCustomer,
    selectedProject,
    selectedProjectId,
    preferredFactoryId,
    factories,
    traderName,
    contractorName,
    siteName,
    siteAddress,
    sitePhone,
    orderedBy,
    vehicleType,
    unloadDuration,
    hasTest,
    deliveryLat,
    deliveryLng,
  } = context;

  const isSpot = orderKind === 'spot';
  const nameTrim = String(siteName || '').trim();
  const addrTrim = String(siteAddress || '').trim();
  const resolvedSiteName =
    !isSpot && selectedProject?.name ? nameTrim || String(selectedProject.name) : nameTrim || addrTrim;

  const prefFidRaw = String(preferredFactoryId || '').trim();
  const prefFid =
    prefFidRaw && (Array.isArray(factories) ? factories : []).some((f) => f && String(f.id) === prefFidRaw)
      ? prefFidRaw
      : '';
  const preferredFactoryName =
    prefFid && (Array.isArray(factories) ? factories : []).find((f) => f && f.id === prefFid)?.name?.trim();

  const spotLat = isSpot ? parseFloat(String(deliveryLat).trim()) : null;
  const spotLng = isSpot ? parseFloat(String(deliveryLng).trim()) : null;

  return {
    createdAt: new Date().toISOString(),
    is_spot: isSpot,
    customer_id: currentCustomerId || null,
    customerName: currentCustomer?.company_name || currentCustomer?.name || '',
    phone_number: currentCustomer?.phone_number || '',
    customerPhone: currentCustomer?.phone_number || '',
    trading_company_name:
      selectedProject?.trading_company_name || selectedProject?.trading_company || String(traderName || '').trim(),
    projectTradingCompanyName:
      selectedProject?.trading_company_name || selectedProject?.trading_company || String(traderName || '').trim(),
    ordered_by: String(orderedBy || '').trim(),
    orderedBy: String(orderedBy || '').trim(),
    project_id: !isSpot && selectedProjectId ? String(selectedProjectId) : null,
    projectName: selectedProject?.name || '',
    delivery_lat: isSpot && Number.isFinite(spotLat) ? spotLat : null,
    delivery_lng: isSpot && Number.isFinite(spotLng) ? spotLng : null,
    preferred_factory_id: prefFid || null,
    preferredFactoryId: prefFid || null,
    preferredFactoryName: preferredFactoryName || '',
    preferredDate: date,
    timeSlot: slot,
    timeSlotMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
    timeSlotLabel: slotLabel,
    timePointLabel: slotLabel,
    scheduleMatchDate: date,
    scheduleMatchMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
    vehicleType,
    vehicleLabel: vehicleType === 'large' ? '大型' : '小型',
    quantityM3: qtyTrim,
    unloadDuration,
    unloadDurationMinutes: unloadDuration,
    unloadDurationLabel: unloadDurationLabel(unloadDuration),
    traderName: String(traderName || '').trim(),
    contractorName: String(contractorName || '').trim(),
    mixText,
    siteName: resolvedSiteName,
    siteAddress: addrTrim,
    sitePhone: String(sitePhone || '').trim(),
    has_test: Boolean(hasTest),
  };
}

/** 複数日一括発注フォームのバリデーション */
export function validateMultiDateOrderForm(context, dates, { today, isPastPreferredDateTime }) {
  const missing = [];
  const list = (Array.isArray(dates) ? dates : []).map((d) => String(d || '').trim()).filter(Boolean);
  if (list.length === 0) missing.push('納入日（1件以上）');
  if (!String(context.currentCustomerId || '').trim()) missing.push('業者（会社）');
  if (!String(context.contractorName || '').trim()) missing.push('業者');
  if (!String(context.sitePhone || '').trim()) missing.push('電話番号');
  if (!String(context.quantityM3 || '').trim()) missing.push('数量（m³）');
  if (context.orderKind === 'project' && !String(context.selectedProjectId || '').trim()) {
    missing.push('物件');
  }
  if (context.orderKind === 'spot') {
    const la = parseFloat(String(context.deliveryLat).trim());
    const ln = parseFloat(String(context.deliveryLng).trim());
    if (!Number.isFinite(la) || !Number.isFinite(ln)) missing.push('地図上の現場位置');
    const nameTrim = String(context.siteName || '').trim();
    const addrTrim = String(context.siteAddress || '').trim();
    if (!nameTrim && !addrTrim) missing.push('現場名または現場住所');
  }
  const timeSlot = String(context.timeSlot || '').trim();
  list.forEach((date, i) => {
    if (today && date < today) missing.push(`納入日${i + 1}（過去の日付）`);
    if (typeof isPastPreferredDateTime === 'function' && isPastPreferredDateTime(date, timeSlot)) {
      missing.push(`納入日${i + 1}（過去の日時）`);
    }
  });
  return missing;
}

/** カートに1行追加する前のバリデーション（単一納入日） */
export function validateCartLineForm(context, preferredDate, { today, isPastPreferredDateTime }) {
  const date = String(preferredDate || '').trim();
  return validateMultiDateOrderForm(context, date ? [date] : [], { today, isPastPreferredDateTime });
}
