/** 工場の受注ダイアログと同じ6項目だけを比べる。updated_at やチャット等は見ない。 */

const ACCEPT_DISPLAY_NAME_KEYS = ['displayTraderName', 'displayContractorName'];

function isBlank(value) {
  return value == null || String(value).trim() === '';
}

/**
 * 小文字・前後空白を除いた車両。
 * small / 小型 / 小型車、large / 大型 / 大型車、それ以外は指定なし。
 */
export function normalizeAcceptVehicle(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'small' || raw === '小型' || raw === '小型車') return 'small';
  if (raw === 'large' || raw === '大型' || raw === '大型車') return 'large';
  return 'unspecified';
}

/** ダイアログと同じ出所。vehicleType が空のときだけ vehicleLabel。 */
export function readAcceptVehicle(order) {
  const primary = order?.vehicleType;
  const hasPrimary = primary != null && String(primary).trim() !== '';
  return normalizeAcceptVehicle(hasPrimary ? primary : order?.vehicleLabel);
}

export function formatAcceptVehicleLabel(order) {
  const vehicle = readAcceptVehicle(order);
  if (vehicle === 'small') return '小型';
  if (vehicle === 'large') return '大型';
  return '指定なし';
}

function readDate(order) {
  return String(order?.preferredDate ?? '').trim();
}

function readTime(order) {
  const raw =
    order?.timePointLabel ||
    order?.timeSlotLabel ||
    (order?.timeSlot != null ? String(order.timeSlot) : '');
  const text = String(raw ?? '').trim();
  if (!text || text === '—') return '';
  return text;
}

function readSite(order) {
  return String(order?.siteName || order?.projectName || '').trim();
}

function readMix(order) {
  return String(order?.mixText ?? '').trim();
}

function readQuantity(order) {
  const raw = order?.quantityM3 ?? order?.quantityCube;
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : text;
}

const ACCEPT_CONTENT_FIELDS = [
  { key: 'date', label: '日付', read: readDate },
  { key: 'time', label: '時刻', read: readTime },
  { key: 'site', label: '現場', read: readSite },
  { key: 'mix', label: '配合', read: readMix },
  { key: 'quantity', label: '数量', read: readQuantity },
  { key: 'vehicle', label: '車両', read: readAcceptVehicle },
];

function sameAcceptValue(key, left, right) {
  if (key === 'quantity') {
    if (left == null && right == null) return true;
    return left === right;
  }
  return String(left ?? '') === String(right ?? '');
}

/** 変わった項目をダイアログの並びで返す。空なら内容は同じ。 */
export function listAcceptContentConflicts(base, latest) {
  const conflicts = [];
  for (const field of ACCEPT_CONTENT_FIELDS) {
    const left = field.read(base);
    const right = field.read(latest);
    if (!sameAcceptValue(field.key, left, right)) {
      conflicts.push({ key: field.key, label: field.label });
    }
  }
  return conflicts;
}

export function formatAcceptContentConflictMessage(conflicts) {
  const labels = (Array.isArray(conflicts) ? conflicts : []).map((item) => item.label).filter(Boolean);
  const head = labels.length ? labels.join('・') : '注文内容';
  return `${head}が更新されています。最新の内容に更新しました。再度ご確認のうえ受注してください`;
}

/** pending 以外。空文字なら受注してよい。 */
export function acceptBlockedStatusMessage(order, factoryId) {
  const status = String(order?.status ?? '').trim();
  if (status === 'pending') return '';
  if (status === 'customer_cancelled') return 'この注文はお客様によりキャンセルされています。';
  if (status === 'accepted') {
    const owner = String(order?.factory_site_id ?? order?.factorySiteId ?? '').trim();
    const mine = String(factoryId ?? '').trim();
    if (owner && mine && owner === mine) return 'この注文はすでに受注済みです。';
    return 'この注文はすでに他工場が受注済みです。';
  }
  return 'この注文は現在受注できない状態です。';
}

/** 一覧で解決した表示名を、latest に無いときだけ残す。 */
export function copyMissingAcceptDisplayNames(order, fallback) {
  if (!order || typeof order !== 'object') return fallback || null;
  const next = { ...order };
  for (const key of ACCEPT_DISPLAY_NAME_KEYS) {
    if (!isBlank(next[key]) || isBlank(fallback?.[key])) continue;
    next[key] = fallback[key];
  }
  return next;
}

/**
 * 受注で書く order_data。
 * rawOrderData を土台に、受注で変わるキーだけ上書きする。
 * 数量・配合・has_test は source（比較に使った latest）。
 * 表示名は土台にも source にも無いときだけ displayOrder から補う。
 */
export function buildFactoryAcceptOrderData(rawOrderData, source, factorySiteId, factorySiteName, acceptedAt, displayOrder) {
  const base =
    rawOrderData && typeof rawOrderData === 'object' && !Array.isArray(rawOrderData)
      ? { ...rawOrderData }
      : {};
  const fid = String(factorySiteId || '').trim();
  const fname = String(factorySiteName || '').trim();
  const qRaw = source?.quantityM3 ?? source?.quantityCube;
  const next = {
    ...base,
    id: String(source?.id || base.id || ''),
    has_test: Boolean(source?.has_test),
    status: 'accepted',
    accepted_at: acceptedAt,
    acceptedAt,
    factoryResponseStatus: 'accepted',
    acceptedFactoryLabel:
      (!isBlank(base.acceptedFactoryLabel) && base.acceptedFactoryLabel) ||
      (!isBlank(source?.acceptedFactoryLabel) && source.acceptedFactoryLabel) ||
      `受注工場：${fname || fid}`,
    factorySiteName: fname || base.factorySiteName || source?.factorySiteName || fid,
    factorySiteId: fid,
    factory_site_id: fid,
    factoryResponseLocked: true,
    factoryUnlockRequested: false,
    confirmedQuantityM3:
      qRaw !== undefined && qRaw !== null && String(qRaw).trim() !== '' ? qRaw : null,
    confirmedMixText: source?.mixText?.trim() || '',
    factory_consult_status: '',
    factoryConsultStatus: '',
    factory_consult_started_at: '',
    factory_consult_by_factory_id: '',
    factoryConsultByFactoryId: '',
    is_customer_modified: false,
  };
  delete next.factoryPendingStartedAt;
  delete next.factoryPendingByName;
  for (const key of ACCEPT_DISPLAY_NAME_KEYS) {
    if (!isBlank(next[key])) continue;
    if (!isBlank(source?.[key])) next[key] = source[key];
    else if (!isBlank(displayOrder?.[key])) next[key] = displayOrder[key];
  }
  return next;
}
