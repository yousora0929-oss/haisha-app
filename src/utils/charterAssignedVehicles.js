export function normalizeAssignedVehicles(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => v && typeof v === 'object')
    .map((v) => {
      const rawCategory = v.plate_category ?? v.plateCategory;
      let plate_category = '';
      if (rawCategory === 'private') plate_category = 'private';
      else if (rawCategory === 'business') plate_category = 'business';
      const rawStatus = String(v.status || '').trim();
      let status = 'offered';
      if (rawStatus === 'accepted' || rawStatus === 'rejected' || rawStatus === 'offered') {
        status = rawStatus;
      }
      return {
        vehicle_id: String(v.vehicle_id ?? v.vehicleId ?? '').trim(),
        vehicle_type: v.vehicle_type === 'small' || v.vehicleType === 'small' ? 'small' : 'large',
        plate_category,
        vehicle_number: String(v.vehicle_number ?? v.vehicleNumber ?? '').trim(),
        door_number: String(v.door_number ?? v.doorNumber ?? '').trim(),
        status,
      };
    });
}

export function buildAssignedVehicleSnapshot(vehicle) {
  if (!vehicle) return null;
  return {
    vehicle_id: String(vehicle.id ?? '').trim(),
    vehicle_type: vehicle.vehicle_type === 'small' ? 'small' : 'large',
    plate_category: vehicle.plate_category === 'private' ? 'private' : 'business',
    vehicle_number: String(vehicle.vehicle_number ?? '').trim(),
    door_number: String(vehicle.door_number ?? '').trim(),
    status: 'offered',
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

/** 編集時に既存の accepted / rejected を保持してマージ */
export function mergeAssignedVehicleStatuses(nextVehicles, previousVehicles) {
  const prevById = new Map(
    (previousVehicles || [])
      .filter((v) => v?.vehicle_id)
      .map((v) => [String(v.vehicle_id), v]),
  );
  return normalizeAssignedVehicles(nextVehicles).map((v) => {
    const prev = prevById.get(v.vehicle_id);
    if (prev?.status === 'accepted' || prev?.status === 'rejected') {
      return { ...v, status: prev.status };
    }
    return { ...v, status: 'offered' };
  });
}
