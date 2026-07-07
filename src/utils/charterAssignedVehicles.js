export function normalizeAssignedVehicles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => v && typeof v === 'object')
    .map((v) => ({
      vehicle_id: String(v.vehicle_id ?? v.vehicleId ?? '').trim(),
      vehicle_type: v.vehicle_type === 'small' || v.vehicleType === 'small' ? 'small' : 'large',
      plate_category: v.plate_category === 'private' || v.plateCategory === 'private' ? 'private' : 'business',
      vehicle_number: String(v.vehicle_number ?? v.vehicleNumber ?? '').trim(),
      door_number: String(v.door_number ?? v.doorNumber ?? '').trim(),
    }));
}

export function buildAssignedVehicleSnapshot(vehicle) {
  if (!vehicle) return null;
  return {
    vehicle_id: String(vehicle.id ?? '').trim(),
    vehicle_type: vehicle.vehicle_type === 'small' ? 'small' : 'large',
    plate_category: vehicle.plate_category === 'private' ? 'private' : 'business',
    vehicle_number: String(vehicle.vehicle_number ?? '').trim(),
    door_number: String(vehicle.door_number ?? '').trim(),
  };
}

export function vehicleTypeLabel(type) {
  return type === 'small' ? '小型' : '大型';
}

export function plateCategoryLabel(category) {
  return category === 'private' ? '自家用' : '事業用';
}

export function formatAssignedVehicleBadge(v) {
  const type = vehicleTypeLabel(v?.vehicle_type);
  const num = v?.vehicle_number || '—';
  const door = v?.door_number ? `（ドア${v.door_number}）` : '';
  return `🚛 ${type} ${num}${door}`;
}

/** 募集日の3日前ちょうどまでは取り下げ可（DBトリガーと同じ境界） */
export function canWithdrawCharterResponse(requestDate) {
  const dateStr = String(requestDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return true;
  const [y, m, d] = dateStr.split('-').map(Number);
  const req = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  req.setHours(0, 0, 0, 0);
  const diffDays = Math.round((req.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  return diffDays >= 3;
}

export function sortVehiclesForRequest(vehicles, requestVehicleType) {
  const preferred = requestVehicleType === 'small' ? 'small' : 'large';
  return [...(vehicles || [])].sort((a, b) => {
    const aMatch = a.vehicle_type === preferred ? 0 : 1;
    const bMatch = b.vehicle_type === preferred ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;
    return String(a.vehicle_number || '').localeCompare(String(b.vehicle_number || ''), 'ja');
  });
}
