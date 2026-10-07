const MAP_FIELD_KEYS = [
  'map_annotations',
  'mapAnnotations',
  'map_stamps',
  'mapStamps',
  'map_submitted_at',
  'mapSubmittedAt',
  'override_map_image_url',
  'overrideMapImageUrl',
  'map_image_url',
  'mapImageUrl',
  'factory_map_received_at',
  'factoryMapReceivedAt',
  'factory_map_received_by',
  'factoryMapReceivedBy',
];

function nestedOrderData(order) {
  const data = order?.order_data;
  if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  return null;
}

function firstText(values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepCopy(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export function mapAnnotationsHaveContent(annotations) {
  if (!isPlainObject(annotations)) return false;
  if (String(annotations.imageOverlay?.url || '').trim()) return true;
  const stamps = Array.isArray(annotations.stamps) ? annotations.stamps.length : 0;
  const unloads = Array.isArray(annotations.unloadPoints) ? annotations.unloadPoints.length : 0;
  const comments = Array.isArray(annotations.comments) ? annotations.comments.length : 0;
  return stamps + unloads + comments > 0;
}

function firstContentAnnotations(values) {
  for (const value of values) {
    if (mapAnnotationsHaveContent(value)) return value;
  }
  return null;
}

function firstStamps(values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

/**
 * 元注文の注文専用地図。無いときは null。
 * URL は専用列 → order_data の順。注釈は deep copy する。
 */
export function extractCarryOverMap(sourceOrder) {
  if (!sourceOrder || typeof sourceOrder !== 'object') return null;
  const orderData = nestedOrderData(sourceOrder) || {};
  const flattened = nestedOrderData(sourceOrder) ? [] : [
    sourceOrder.overrideMapImageUrl,
    sourceOrder.map_image_url,
    sourceOrder.mapImageUrl,
  ];
  const overrideMapImageUrl = firstText([
    sourceOrder.override_map_image_url,
    orderData.override_map_image_url,
    orderData.overrideMapImageUrl,
    orderData.map_image_url,
    orderData.mapImageUrl,
    ...flattened,
  ]);
  const mapAnnotations = firstContentAnnotations([
    sourceOrder.map_annotations,
    orderData.map_annotations,
    orderData.mapAnnotations,
    sourceOrder.mapAnnotations,
  ]);
  const mapStamps = firstStamps([
    sourceOrder.map_stamps,
    sourceOrder.mapStamps,
    orderData.map_stamps,
    orderData.mapStamps,
  ]);
  const annotationContent = mapAnnotationsHaveContent(mapAnnotations);
  if (!overrideMapImageUrl && !annotationContent && !mapStamps) return null;
  const sourceOrderId = firstText([sourceOrder.id, orderData.id]);
  return {
    overrideMapImageUrl,
    mapAnnotations: mapAnnotations ? deepCopy(mapAnnotations) : null,
    mapStamps: mapStamps ? deepCopy(mapStamps) : null,
    sourceOrderId,
  };
}

/** `...item` 展開で地図・工場の受領記録が新注文に残らないようにする */
export function stripMapFieldsFromRepeatSource(item) {
  if (!item || typeof item !== 'object') return item;
  const next = { ...item };
  for (const key of MAP_FIELD_KEYS) delete next[key];
  const orderData = nestedOrderData(item);
  if (orderData) {
    const nextOrderData = { ...orderData };
    for (const key of MAP_FIELD_KEYS) delete nextOrderData[key];
    next.order_data = nextOrderData;
  }
  return next;
}

/**
 * 引き継ぎ内容を新注文へ載せる。carry が null のときは同じオブジェクトを返す。
 * map_submitted_at は設定しない。
 */
export function applyCarryOverMapToOrder(order, carry) {
  if (!carry) return order;
  const next = { ...(order || {}) };
  const url = String(carry.overrideMapImageUrl || '').trim();
  if (url) {
    next.override_map_image_url = url;
    next.map_image_url = url;
  }
  if (carry.mapAnnotations) next.map_annotations = deepCopy(carry.mapAnnotations);
  if (carry.mapStamps) next.map_stamps = deepCopy(carry.mapStamps);
  next.is_location_pending = false;
  next.isLocationPending = false;
  next.map_carried_from_order_id = String(carry.sourceOrderId || '').trim();
  return next;
}

export function hasCarriedMap(order) {
  return Boolean(String(order?.map_carried_from_order_id || order?.mapCarriedFromOrderId || '').trim());
}

/** 注文種別・物件・スポット座標・納入エリア・住所が同じ現場か */
export function buildRepeatMapCarryAnchorKey(fields = {}) {
  const kind = String(fields.orderKind || '').trim();
  const projectId = kind === 'spot' ? '' : String(fields.projectId ?? fields.selectedProjectId ?? '').trim();
  return [
    kind,
    projectId,
    String(fields.deliveryLat ?? '').trim(),
    String(fields.deliveryLng ?? '').trim(),
    String(fields.deliveryArea ?? '').trim(),
    String(fields.siteAddressDetail ?? '').trim(),
    String(fields.siteAddress ?? '').trim(),
  ].join('|');
}

/** normalizeOrderRow は列の map_annotations を載せない。中身があるときだけ履歴元に添える。 */
export function attachColumnMapAnnotations(order, row) {
  if (!order || !mapAnnotationsHaveContent(row?.map_annotations)) return order;
  order.map_annotations = row.map_annotations;
  return order;
}
