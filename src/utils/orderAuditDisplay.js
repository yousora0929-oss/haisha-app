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

/**
 * 日本語ラベル定義（主要項目候補）。
 * confirmedQuantityM3 / confirmedMixText はユーザー編集の数量・配合と分離する。
 */
const AUDIT_FIELD_LABELS = {
  status: 'ステータス',
  'order_data.status': 'ステータス',
  'order_data.factoryResponseStatus': 'ステータス',
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
  confirmedQuantityM3: '確定数量(㎥)',
  'order_data.confirmedQuantityM3': '確定数量(㎥)',
  'order_data.unloadDuration': '荷卸し時間',
  'order_data.unloadDurationMinutes': '荷卸し時間',
  'order_data.unloadDurationLabel': '荷卸し時間',
  'order_data.mixText': '配合',
  confirmedMixText: '確定配合',
  'order_data.confirmedMixText': '確定配合',
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
  'order_data.factory_site_id': '受注工場',
  'order_data.factorySiteId': '受注工場',
  preferred_factory_id: '希望工場',
  project_id: '物件',
  customer_id: '発注アカウント',
  has_test: '試験体',
  is_spot: 'スポット',
  is_phone_order: '電話注文',
  delivery_lat: '緯度',
  delivery_lng: '経度',
  rejected_factory_ids: '辞退工場',
  accepted_at: '受注日時',
  'order_data.accepted_at': '受注日時',
  'order_data.acceptedAt': '受注日時',
};

/** ラベルがあっても主要項目にしない（表示ノイズ） */
const FORCE_INTERNAL_FIELD_KEYS = new Set([
  'acceptedFactoryLabel',
  'factorySiteName',
  'displayTraderName',
  'displayContractorName',
  'factoryResponseLocked',
  'factoryUnlockRequested',
  'sub_factory_current_index',
  'subFactoryCurrentIndex',
]);

const ACTOR_ROLE_LABELS = {
  admin: '管理者',
  factory: '工場',
  customer: '顧客',
  guest: 'ゲスト',
  system: 'システム',
};

const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

function fieldShortKey(field) {
  const key = String(field || '').trim();
  if (key.startsWith('order_data.')) return key.slice('order_data.'.length);
  return key;
}

function lookupLabel(field) {
  const key = String(field || '').trim();
  if (!key) return '';
  if (AUDIT_FIELD_LABELS[key]) return AUDIT_FIELD_LABELS[key];
  if (key.startsWith('order_data.')) {
    const short = key.slice('order_data.'.length);
    if (AUDIT_FIELD_LABELS[`order_data.${short}`]) return AUDIT_FIELD_LABELS[`order_data.${short}`];
    if (AUDIT_FIELD_LABELS[short]) return AUDIT_FIELD_LABELS[short];
  }
  return '';
}

/**
 * @param {string} field
 * @returns {{ label: string, known: boolean }}
 */
export function auditFieldLabel(field) {
  const key = String(field || '').trim();
  if (!key) return { label: '', known: false };
  const label = lookupLabel(key);
  if (label) return { label, known: true };
  return { label: key, known: false };
}

/** 主要項目か（ラベル定義あり、かつ FORCE_INTERNAL 以外） */
export function isPrimaryAuditField(field) {
  const short = fieldShortKey(field);
  if (FORCE_INTERNAL_FIELD_KEYS.has(short)) return false;
  if (FORCE_INTERNAL_FIELD_KEYS.has(String(field || '').trim())) return false;
  return auditFieldLabel(field).known;
}

function formatJstParts(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return {
    year: get('year'),
    month: String(Number(get('month'))),
    day: String(Number(get('day'))),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** JST の M/D HH:mm:ss（辞退・優先順位・変更履歴で共用） */
export function formatAuditOccurredAtJst(iso) {
  if (!iso) return '—';
  const p = formatJstParts(iso);
  if (!p) return '—';
  return `${p.month}/${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** ホバー用 YYYY/MM/DD HH:mm:ss (JST) */
export function formatAuditOccurredAtJstTitle(iso) {
  if (!iso) return '';
  const p = formatJstParts(iso);
  if (!p) return '';
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}/${mm}/${dd} ${p.hour}:${p.minute}:${p.second} (JST)`;
}

export function isIsoDateTimeString(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  if (!ISO_DATETIME_RE.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

/** 「空」= null / 未設定相当 / '' / [] / {} */
export function isAuditEmptyValue(value) {
  if (value == null) return true;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return true;
    if (s === 'null' || s === 'undefined' || s === '未設定') return true;
    return false;
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    if (value.omitted === true) return false;
    return Object.keys(value).length === 0;
  }
  return false;
}

function isFactorySiteField(field) {
  const key = String(field || '').trim();
  const short = fieldShortKey(key);
  return (
    key === 'factory_site_id' ||
    short === 'factory_site_id' ||
    short === 'factorySiteId'
  );
}

function isStatusField(field) {
  const key = String(field || '').trim();
  const short = fieldShortKey(key);
  return key === 'status' || short === 'status' || short === 'factoryResponseStatus';
}

function formatFactorySiteDisplay(value, factoryNameById = {}) {
  if (isAuditEmptyValue(value)) return '（未設定）';
  const fid = String(value).trim();
  const name = factoryNameById?.[fid];
  if (name) return `${name}（${fid}）`;
  return fid;
}

/**
 * @param {unknown} value
 * @param {string} [field]
 * @param {{ factoryNameById?: Record<string, string> }} [opts]
 */
export function formatAuditChangeValue(value, field = '', opts = {}) {
  const factoryNameById = opts.factoryNameById || {};
  if (value != null && typeof value === 'object' && !Array.isArray(value) && value.omitted === true) {
    return '（長文のため省略）';
  }
  if (isAuditEmptyValue(value)) return '（未設定）';

  if (isFactorySiteField(field)) {
    return formatFactorySiteDisplay(value, factoryNameById);
  }

  if (typeof value === 'boolean') {
    if (field === 'has_test' || field.endsWith('.has_test')) {
      return value ? 'あり' : 'なし';
    }
    return value ? 'true' : 'false';
  }
  if (Array.isArray(value)) {
    return value.map((v) => formatAuditChangeValue(v, field, opts)).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  const s = String(value).trim();
  if (isIsoDateTimeString(s)) {
    return formatAuditOccurredAtJst(s);
  }
  if (isStatusField(field)) {
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

/** 空→空 / 空→false は表示しない */
export function shouldHideAuditChange(before, after) {
  const beforeEmpty = isAuditEmptyValue(before);
  const afterEmpty = isAuditEmptyValue(after);
  if (beforeEmpty && afterEmpty) return true;
  if (beforeEmpty && after === false) return true;
  return false;
}

export function actorRoleLabel(role) {
  const r = String(role || '').trim();
  return ACTOR_ROLE_LABELS[r] || r || '不明';
}

export function actorRoleBadgeClass(role) {
  const r = String(role || '').trim();
  if (r === 'admin') return 'border-violet-300 bg-violet-100 text-violet-900';
  if (r === 'factory') return 'border-emerald-300 bg-emerald-100 text-emerald-900';
  if (r === 'customer') return 'border-blue-300 bg-blue-100 text-blue-900';
  if (r === 'guest') return 'border-slate-300 bg-slate-100 text-slate-700';
  if (r === 'system') return 'border-slate-200 bg-slate-50 text-slate-500';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

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

export function formatTimelineActorName(row) {
  const name = String(row?.actor_name ?? '').trim();
  if (name === '（記録開始前）') return '';
  if (name) return name;
  return actorRoleLabel(row?.actor_role);
}

function dedupeChangeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.label}\0${row.beforeText}\0${row.afterText}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * @param {Array<{ field?: string, before?: unknown, after?: unknown }>|null|undefined} changes
 * @param {{ factoryNameById?: Record<string, string> }} [opts]
 * @returns {{ primary: object[], internal: object[] }}
 */
export function normalizeAuditChanges(changes, opts = {}) {
  const list = Array.isArray(changes) ? changes : [];
  const primary = [];
  const internal = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    if (shouldHideAuditChange(c.before, c.after)) continue;
    const field = String(c.field || '').trim();
    const { label, known } = auditFieldLabel(field);
    const row = {
      field,
      label: known ? label : field,
      known,
      primary: isPrimaryAuditField(field),
      beforeText: formatAuditChangeValue(c.before, field, opts),
      afterText: formatAuditChangeValue(c.after, field, opts),
    };
    // 整形後に実質差分が無い行は出さない
    if (row.beforeText === row.afterText) continue;
    if (row.primary) primary.push(row);
    else internal.push(row);
  }
  return {
    primary: dedupeChangeRows(primary),
    internal: dedupeChangeRows(internal),
  };
}

function findChange(changes, predicate) {
  const list = Array.isArray(changes) ? changes : [];
  return list.find((c) => c && typeof c === 'object' && predicate(String(c.field || '').trim()));
}

/**
 * タイムライン1イベント分の表示モデル
 * @param {object} row audit log
 * @param {{ factoryNameById?: Record<string, string> }} [opts]
 */
export function buildAuditEventView(row, opts = {}) {
  const factoryNameById = opts.factoryNameById || {};
  const eventType = String(row?.event_type || '');
  const { primary, internal } = normalizeAuditChanges(row?.changes, { factoryNameById });
  const backfilled = Boolean(row?.is_backfilled);
  const occurredAtText = backfilled
    ? '時刻不明（記録開始前）'
    : formatAuditOccurredAtJst(row?.occurred_at);
  const occurredAtTitle = backfilled ? '' : formatAuditOccurredAtJstTitle(row?.occurred_at);

  let headline = '';
  const headlineExtra = [];

  if (eventType === 'created') {
    headline = '注文が作成されました';
  } else if (eventType === 'status_changed') {
    const statusRaw = findChange(row?.changes, (f) => isStatusField(f));
    if (statusRaw) {
      const beforeText = formatAuditChangeValue(statusRaw.before, statusRaw.field || 'status', {
        factoryNameById,
      });
      const afterText = formatAuditChangeValue(statusRaw.after, statusRaw.field || 'status', {
        factoryNameById,
      });
      headline = `ステータス: ${beforeText} → ${afterText}`;
      const afterStatus = String(statusRaw.after ?? '').trim();
      if (afterStatus === 'accepted' || afterText === '受注') {
        const factoryChange = findChange(row?.changes, (f) => isFactorySiteField(f));
        if (factoryChange && !isAuditEmptyValue(factoryChange.after)) {
          headlineExtra.push(
            `受注工場: ${formatFactorySiteDisplay(factoryChange.after, factoryNameById)}`,
          );
        }
      }
    } else {
      headline = 'ステータスが変更されました';
    }
  } else if (eventType === 'updated') {
    if (primary.length === 0 && internal.length > 0) {
      headline = '内部項目のみ更新';
    } else {
      headline = `${primary.length}項目を変更`;
    }
  } else {
    headline = eventType || '更新';
  }

  return {
    eventType,
    headline,
    headlineExtra,
    primary,
    internal,
    occurredAtText,
    occurredAtTitle,
    backfilled,
    actorName: formatTimelineActorName(row),
    actorRole: String(row?.actor_role || '').trim(),
  };
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

/** 後方互換: フラット配列（主要→内部） */
export function flattenNormalizedAuditChanges(changes, opts = {}) {
  const { primary, internal } = normalizeAuditChanges(changes, opts);
  return [...primary, ...internal];
}
