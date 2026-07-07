const VEHICLE_TYPE_ALIASES = {
  large: 'large',
  大型: 'large',
  small: 'small',
  小型: 'small',
};

const PLATE_CATEGORY_ALIASES = {
  business: 'business',
  事業用: 'business',
  private: 'private',
  自家用: 'private',
};

export const CHARTER_VEHICLE_CSV_TEMPLATE =
  '車両タイプ,ナンバー種別,車両ナンバー,ドアナンバー\nlarge,business,福岡100あ1234,1\nsmall,private,福岡500さ5678,2\n';

export function parseCharterVehicleCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { rows: [], errors: ['ファイルが空です'] };

  const [header, ...dataLines] = lines;
  const cols = header.split(',').map((c) => c.trim());
  const idx = {
    vehicleType: cols.findIndex((c) => /車両タイプ|vehicle_type/i.test(c)),
    plateCategory: cols.findIndex((c) => /ナンバー種別|plate_category/i.test(c)),
    vehicleNumber: cols.findIndex((c) => /車両ナンバー|vehicle_number/i.test(c)),
    doorNumber: cols.findIndex((c) => /ドアナンバー|door_number/i.test(c)),
  };

  if (idx.vehicleType < 0 || idx.plateCategory < 0 || idx.vehicleNumber < 0 || idx.doorNumber < 0) {
    return { rows: [], errors: ['ヘッダー行が不正です（車両タイプ,ナンバー種別,車両ナンバー,ドアナンバー）'] };
  }

  const rows = [];
  const errors = [];

  dataLines.forEach((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const rawType = cells[idx.vehicleType] || '';
    const rawCategory = cells[idx.plateCategory] || '';
    const vehicleType = VEHICLE_TYPE_ALIASES[rawType.toLowerCase()] || VEHICLE_TYPE_ALIASES[rawType];
    const plateCategory = PLATE_CATEGORY_ALIASES[rawCategory.toLowerCase()] || PLATE_CATEGORY_ALIASES[rawCategory];
    const vehicleNumber = cells[idx.vehicleNumber] || '';
    const doorNumber = cells[idx.doorNumber] || '';

    if (!vehicleType) {
      errors.push(`${i + 2}行目: 車両タイプが不正です（${rawType}）`);
      return;
    }
    if (!plateCategory) {
      errors.push(`${i + 2}行目: ナンバー種別が不正です（${rawCategory}）`);
      return;
    }
    rows.push({ vehicleType, plateCategory, vehicleNumber, doorNumber });
  });

  return { rows, errors };
}

export function downloadCharterVehicleCsvTemplate() {
  const blob = new Blob(['\uFEFF' + CHARTER_VEHICLE_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'charter_vehicles_template.csv';
  a.click();
  URL.revokeObjectURL(url);
}
