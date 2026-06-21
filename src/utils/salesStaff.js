/** 担当営業マスタ（admin_settings.sales_staff） */

export function createSalesStaffId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `staff_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `staff_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function normalizeSalesStaffMember(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  const name = String(raw.name ?? '').trim();
  if (!id || !name) return null;
  const phone = String(raw.phone ?? raw.phone_number ?? '').trim();
  return {
    id,
    name,
    phone: phone || '',
  };
}

export function normalizeSalesStaffList(raw) {
  if (!Array.isArray(raw)) return [];
  const list = [];
  const seen = new Set();
  for (const item of raw) {
    const member = normalizeSalesStaffMember(item);
    if (!member || seen.has(member.id)) continue;
    seen.add(member.id);
    list.push(member);
  }
  return list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}

export function createSalesStaffMember({ name, phone = '' }) {
  const trimmedName = String(name ?? '').trim();
  if (!trimmedName) throw new Error('担当営業名を入力してください');
  return {
    id: createSalesStaffId(),
    name: trimmedName,
    phone: String(phone ?? '').trim(),
  };
}

export function findSalesStaffById(list, id) {
  const fid = String(id ?? '').trim();
  if (!fid) return null;
  return normalizeSalesStaffList(list).find((m) => m.id === fid) || null;
}

export function findSalesStaffByName(list, name) {
  const n = String(name ?? '').trim();
  if (!n) return null;
  return normalizeSalesStaffList(list).find((m) => m.name === n) || null;
}
