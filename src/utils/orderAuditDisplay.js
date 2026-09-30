/** 管理者向け order_audit_logs の表示用ヘルパー（Admin のみ） */

const ORDER_STATUS_LABELS = {
  pending: '配車待ち',
  accepted: '受注',
  completed: '完了',
  customer_cancelled: 'キャンセル',
  rejected: '見送り',
  pending_association: '組合承認待ち',
  awaiting_admin_followup: '要フォロー',
};

/** order_data.* / トップレベル列 → 日本語ラベル（対応なしは null） */
const AUDIT_FIELD_LABELS = {
  status: 'ステータス',
  ordered_by: '発注アカウント',
  'order_data.orderedBy': '現場担当者名',
  'order_data.preferredDate': '希望日',
  'order_data.timeSlot': '希望時刻',
  'order_data.timeSlotLabel': '希望時刻',
  'order_data.timePointLabel': '希望時刻',
  'order_data.timeSlotMinutes': '希望時刻',
  'order_data.vehicleType': '車種',
  'order_data.vehicleLabel': '車種',
  'order_data.quantityM3': '数量',
  'order_data.quantityCube': '数量',
  'order_data.confirmedQuantityM3': '数量',
  'order_data.unloadDuration': '荷卸し時間',
  'order_data.unloadDurationMinutes': '荷卸し時間',
  'order_data.unloadDurationLabel': '荷卸し時間',
  'order_data.mixText': '配合',
  'order_data.confirmedMixText': '配合',
  'order_data.siteName': '現場名',
  'order_data.projectName': '現場名',
  'order_data.siteAddress': '現場住所',
  'order_data.sitePhone': '電話番号',
  'order_data.contractorName': '業者名',
  'order_data.contractor_name': '業者名',
  'order_data.traderName': '商社',
  'order_data.trading_company_name': '商社',
  'order_data.projectTradingCompanyName': '商社',
  'order_data.has_test': '試験体',
  'order_data.manager_name': '担当者名',
  'order_data.delivery_lat': '緯度',
  'order_data.delivery_lng': '経度',
  contractor_customer_id: '業者名',
  agent_organization_id: '商社',
  trading_agent_customer_id: '商社担当者',
  factory_site_id: '受注工場',
  preferred_factory_id: '希望工場',
  project_id: '物件',
  customer_id: '発注アカウント',
  has_test: '試験体',
  is_spot: 'スポット',
  is_phone_order: '電話注文',
  delivery_lat: '緯度',
  delivery_lng: '経度',
  rejected_factory_ids: '辞退工場',
};

const ACTOR_ROLE_LABELS = {
  admin: '管理者',
  factory: '工場',
  customer: '顧客',
  guest: 'ゲスト',
  system: 'システム',
};

/**
 * @param {string} field
 * @returns {{ label: string, known: boolean }}
 */
export function auditFieldLabel(field) {
  const key = String(field || '').trim();
  if (!key) return { label: '', known: false };
  if (AUDIT_FIELD_LABELS[key]) return { label: AUDIT_FIELD_LABELS[key], known: true };
  // order_data.xxx の末尾キーだけでも照合
  if (key.startsWith('order_data.')) {
    const short = key.slice('order_data.'.length);
    if (AUDIT_FIELD_LABELS[`order_data.${short}`]) {
      return { label: AUDIT_FIELD_LABELS[`order_data.${short}`], known: true };
    }
    if (AUDIT_FIELD_LABELS[short]) return { label: AUDIT_FIELD_LABELS[short], known: true };
  }
  return { label: key, known: false };
}

/** JST の M/D HH:mm */
export function formatAuditOccurredAtJst(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const month = String(Number(get('month')));
  const day = String(Number(get('day')));
  let hour = get('hour');
  // en-US hour12:false で 24:xx になる環境がある
  if (hour === '24') hour = '00';
  const minute = get('minute');
  return `${month}/${day} ${hour}:${minute}`;
}

/**
 * @param {unknown} value
 * @param {string} [field]
 */
export function formatAuditChangeValue(value, field = '') {
  if (value != null && typeof value === 'object' && !Array.isArray(value) && value.omitted === true) {
    return '（長文のため省略）';
  }
  if (value == null) return '（空）';
  if (typeof value === 'boolean') {
    if (field === 'has_test' || field.endsWith('.has_test')) {
      return value ? 'あり' : 'なし';
    }
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '（空）';
    return value.map((v) => formatAuditChangeValue(v, field)).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  const s = String(value).trim();
  if (s === '') return '（空）';
  if (field === 'status' || field.endsWith('.status')) {
    return ORDER_STATUS_LABELS[s] || s;
  }
  if (
    (field === 'has_test' || field.endsWith('.has_test')) &&
    (s === 'true' || s === 'false' || s === '1' || s === '0')
  ) {
    return s === 'true' || s === '1' ? 'あり' : 'なし';
  }
  if (field === 'vehicleType' || field.endsWith('.vehicleType')) {
    if (s === 'small') return '小型';
    if (s === 'large') return '大型';
  }
  return s;
}

export function actorRoleLabel(role) {
  const r = String(role || '').trim();
  return ACTOR_ROLE_LABELS[r] || r || '不明';
}

/** 役割バッジ Tailwind クラス */
export function actorRoleBadgeClass(role) {
  const r = String(role || '').trim();
  if (r === 'admin') return 'border-violet-300 bg-violet-100 text-violet-900';
  if (r === 'factory') return 'border-emerald-300 bg-emerald-100 text-emerald-900';
  if (r === 'customer') return 'border-blue-300 bg-blue-100 text-blue-900';
  if (r === 'guest') return 'border-slate-300 bg-slate-100 text-slate-700';
  if (r === 'system') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

/**
 * 辞退ブロック用の操作者追記（null なら表示しない）
 * @param {{ actor_role?: string, actor_id?: string, actor_name?: string, factory_id?: string }} row
 */
export function formatDeclineActorNote(row) {
  const actorName = String(row?.actor_name ?? '').trim();
  if (actorName === '（記録開始前）') return null;
  const role = String(row?.actor_role || '').trim();
  const actorId = String(row?.actor_id || '').trim();
  const factoryId = String(row?.factory_id || '').trim();
  if (role === 'factory' && actorId && factoryId && actorId === factoryId) return null;
  if (role === 'admin') return '管理者が操作';
  if (role === 'system') return '自動（応答なしタイムアウト等）';
  if (actorName) return actorName;
  if (role) return actorRoleLabel(role);
  return null;
}

/**
 * タイムライン用の操作者表示名
 * @param {{ actor_role?: string, actor_name?: string }} row
 */
export function formatTimelineActorName(row) {
  const name = String(row?.actor_name ?? '').trim();
  if (name === '（記録開始前）') return '';
  if (name) return name;
  return actorRoleLabel(row?.actor_role);
}

/**
 * @param {Array<{ field?: string, before?: unknown, after?: unknown }>|null|undefined} changes
 * @returns {Array<{ field: string, label: string, known: boolean, beforeText: string, afterText: string }>}
 */
export function normalizeAuditChanges(changes) {
  const list = Array.isArray(changes) ? changes : [];
  return list
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const field = String(c.field || '').trim();
      const { label, known } = auditFieldLabel(field);
      return {
        field,
        label: label || field,
        known,
        beforeText: formatAuditChangeValue(c.before, field),
        afterText: formatAuditChangeValue(c.after, field),
      };
    });
}

export function splitAuditLogs(logs) {
  const list = Array.isArray(logs) ? logs : [];
  const declines = list.filter((r) => {
    const t = String(r?.event_type || '');
    return t === 'factory_declined' || t === 'factory_decline_revoked';
  });
  const timeline = list.filter((r) => {
    const t = String(r?.event_type || '');
    return t === 'created' || t === 'updated' || t === 'status_changed';
  });
  return { declines, timeline };
}
