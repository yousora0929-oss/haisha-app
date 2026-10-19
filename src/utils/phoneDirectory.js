import { phoneDigits } from './phoneFormat.js';

export const PHONE_DIRECTORY_LABELS = ['代表', '事務所', '携帯', '現場', 'FAX', 'その他'];

export function phoneDirectoryErrorMessage(err, fallback = '処理に失敗しました') {
  const msg = [err?.message, err?.details, err?.hint]
    .map((value) => String(value || ''))
    .join('\n');
  if (msg.includes('duplicate phone')) return 'この会社にはすでに登録されています';
  if (msg.includes('invalid phone')) return '電話番号は0から始まる10〜11桁で入力してください';
  if (msg.includes('not authorized')) return 'この番号を編集する権限がありません（登録した工場のみ）';
  return String(err?.message || '').trim() || fallback;
}

/** 数字が4桁以上なら番号検索。それ以外は社名検索。 */
export function isPhoneDirectoryQuery(query) {
  return phoneDigits(query).length >= 4;
}

export function formatPhoneDirectoryDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (!year || !month || !day) return '';
  return `${year}/${month}/${day}`;
}

export function organizationTypeLabel(type) {
  if (type === 'agent') return '商社';
  if (type === 'contractor') return '業者';
  return '';
}

export function groupPhoneDirectoryRows(rows) {
  const groups = [];
  const index = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row, rowIndex) => {
    const orgId = String(row?.organization_id || '').trim();
    const key = orgId || `row:${row?.contact_phone_id || row?.customer_id || rowIndex}`;
    let group = index.get(key);
    if (!group) {
      group = {
        key,
        organizationId: orgId,
        organizationName: String(row?.organization_name || '').trim() || '（会社名なし）',
        organizationType: String(row?.organization_type || '').trim(),
        orgCreatedByFactoryId: String(row?.org_created_by_factory_id || '').trim(),
        rows: [],
      };
      index.set(key, group);
      groups.push(group);
    }
    if (!group.orgCreatedByFactoryId) {
      group.orgCreatedByFactoryId = String(row?.org_created_by_factory_id || '').trim();
    }
    if (!group.organizationType && row?.organization_type) {
      group.organizationType = String(row.organization_type).trim();
    }
    group.rows.push(row);
  });
  return groups;
}

export function contactActorLabel(factoryId, factoryNameById) {
  const id = String(factoryId || '').trim();
  if (!id) return '組合';
  return String(factoryNameById?.[id] || '').trim() || '工場';
}

/** 管理者の contact_phones 行。更新が登録と同時なら更新行は出さない。 */
export function mapAdminContactPhone(row) {
  if (!row || typeof row !== 'object' || row.deleted_at) return null;
  const registeredAt = row.registered_at || row.created_at || null;
  const updatedAt = row.updated_at || null;
  const registeredMs = registeredAt ? Date.parse(registeredAt) : Number.NaN;
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const hasUpdate =
    Number.isFinite(updatedMs) && (!Number.isFinite(registeredMs) || updatedMs - registeredMs > 2000);
  return {
    id: row.id != null ? String(row.id) : '',
    organizationId: row.organization_id != null ? String(row.organization_id) : '',
    phone: String(row.phone_display ?? row.phone ?? '').trim(),
    label: String(row.label || '').trim(),
    personName: String(row.person_name || '').trim(),
    note: String(row.note || '').trim(),
    registeredByFactoryId: row.registered_by_factory_id ? String(row.registered_by_factory_id) : '',
    registeredAt,
    updatedByFactoryId: row.updated_by_factory_id
      ? String(row.updated_by_factory_id)
      : row.modified_by_factory_id
        ? String(row.modified_by_factory_id)
        : '',
    updatedAt: hasUpdate ? updatedAt : null,
  };
}

export function unwrapCreatedOrganization(data) {
  const row = Array.isArray(data) ? data[0] : data;
  return {
    organizationId: row?.organization_id != null ? String(row.organization_id) : '',
    created: row?.created === true,
    name: String(row?.name || '').trim(),
  };
}
