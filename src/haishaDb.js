import { MAP_STORAGE_BUCKET, MAP_STAMP_TYPES, publishMapEditorOrderSaved } from './mapEditorConstants.js';
import {
  annotationsToLegacyStamps,
  boundsFromCenter,
  getInitialMapViewFromAnnotations,
  normalizeMapAnnotations,
} from './utils/mapAnnotations.js';
import { stripSavedSnapshotOverlay } from './utils/mapEditorOverlay.js';
import { normalizeExternalUrl } from './utils/urlValidation.js';
import { supabase, ensurePanelRealtimeAuth } from './supabaseClient.js';
import { normalizeAllowedDeliveryAreas, parseSpotThresholdVolume } from './utils/deliveryAreas.js';
import { isValidSiteOrderUrlToken, resolveUrlTokenForInsert } from './utils/urlValidation.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from './utils/siteNameDisplay.js';
import { normalizeAssociationFactorySelection } from './utils/associationFactoryAssignment.js';
import { shouldResetOrderStatusOnFactoryReassign } from './utils/orderFactoryReassign.js';
import {
  DISPATCH_DEFAULT_FACTORY_SITE_ID,
  DISPATCH_DEFAULT_FACTORY_SITE_NAME,
  computeScheduleAutoRejectReason,
  getOrderMinutesForScheduleScan,
  normalizeDayBlockSchedule,
  normalizeFullSchedule,
} from './haishaConstants.js';

const ORDER_SELECT =
  'id, order_data, chat_messages, created_at, has_test, project_id, customer_id, ordered_by, is_spot, delivery_lat, delivery_lng, preferred_factory_id, factory_site_id, status, rejected_factory_ids, override_map_image_url, is_location_pending, map_annotations';

const CUSTOMER_SELECT_MIN =
  'id, company_name, phone_number, manager_name, url_token';

// projects は環境差分（未適用マイグレーション）でカラム欠損しやすい。
// まずは trading_company_name を優先し、無ければ段階的にフォールバックする。
const PROJECT_SELECT_MIN =
  'id, name, customer_id, trading_company_name, main_factory_id, sub_factory_ids, lat, lng, contractor, sub_contractor_name, delivery_area, site_address, created_at, updated_at';
const PROJECT_SELECT_MIN_LEGACY =
  'id, name, main_factory_id, sub_factory_ids, lat, lng, trading_company, contractor, created_at, updated_at';
const PROJECT_SELECT_MIN_BASE =
  'id, name, main_factory_id, sub_factory_ids, lat, lng, created_at, updated_at';

/** 物件の url_token が無い場合、紐づく業者（customers）の url_token を補完する */
function pickSiteUrlToken(project, customer) {
  const fromProject = String(project?.url_token ?? '').trim();
  if (isValidSiteOrderUrlToken(fromProject)) return fromProject;
  const fromCustomer = String(customer?.url_token ?? '').trim();
  if (isValidSiteOrderUrlToken(fromCustomer)) return fromCustomer;
  return '';
}

async function enrichProjectsWithCustomerUrlTokens(projects) {
  const list = Array.isArray(projects) ? projects.filter(Boolean) : [];
  const customerIds = [...new Set(list.map((p) => p?.customer_id).filter(Boolean))];
  if (!customerIds.length) return list;

  const { data, error } = await supabase.from('customers').select('id, url_token').in('id', customerIds);
  if (error) {
    console.warn('[fetchProjects] customers.url_token の取得に失敗しました', error);
    return list;
  }

  const tokenByCustomerId = new Map(
    (data || []).map((c) => [String(c.id), c.url_token != null ? String(c.url_token).trim() : '']),
  );

  return list.map((p) => {
    const merged = pickSiteUrlToken(p, { url_token: tokenByCustomerId.get(String(p.customer_id || '')) });
    if (!merged || merged === String(p.url_token ?? '').trim()) return p;
    return { ...p, url_token: merged };
  });
}

function normalizeChatMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      id: m.id != null ? String(m.id) : `msg_${Date.now()}`,
      from:
        m.from === 'factory'
          ? 'factory'
          : m.from === 'system'
            ? 'system'
            : m.from === 'admin'
              ? 'admin'
              : m.from === 'customer'
                ? 'customer'
                : 'master',
      body: String(m.body ?? ''),
      createdAt: m.createdAt != null ? String(m.createdAt) : new Date().toISOString(),
    }))
    .slice(-100);
}

function createOrderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ord_${crypto.randomUUID()}`;
  }
  return `ord_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function sanitizeRefId(value) {
  if (value == null) return null;
  const s = String(value).trim();
  const lower = s.toLowerCase();
  const placeholders = new Set([
    'undefined',
    'null',
    'none',
    'n/a',
    '-',
    '未定',
    'なし',
    '無し',
    '未設定',
    DISPATCH_DEFAULT_FACTORY_SITE_ID,
  ]);
  if (!s || placeholders.has(s) || placeholders.has(lower)) return null;
  return s;
}

function sanitizeOrderRefs(order) {
  const o = order && typeof order === 'object' && !Array.isArray(order) ? { ...order } : {};
  const factorySiteId = sanitizeRefId(o.factory_site_id);
  const legacyFactorySiteId = sanitizeRefId(o.factorySiteId);
  const preferredFactoryId = sanitizeRefId(o.preferred_factory_id ?? o.preferredFactoryId);
  const mainFactoryId = sanitizeRefId(o.main_factory_id ?? o.mainFactoryId);
  o.factory_site_id = factorySiteId;
  o.factorySiteId = legacyFactorySiteId;
  o.preferred_factory_id = preferredFactoryId;
  o.preferredFactoryId = preferredFactoryId;
  o.main_factory_id = mainFactoryId;
  o.mainFactoryId = mainFactoryId;
  return o;
}

function sanitizeOrderDataForDb(order) {
  const o = sanitizeOrderRefs(order);
  const siteName = sanitizeSiteNameValue(o.siteName ?? o.site_name);
  const projectName = sanitizeSiteNameValue(o.projectName ?? o.project_name);
  return {
    ...o,
    siteName,
    site_name: siteName,
    projectName,
    project_name: projectName,
    factory_site_id: sanitizeRefId(o.factory_site_id),
    factorySiteId: sanitizeRefId(o.factorySiteId),
    preferred_factory_id: sanitizeRefId(o.preferred_factory_id),
    preferredFactoryId: sanitizeRefId(o.preferredFactoryId),
    main_factory_id: sanitizeRefId(o.main_factory_id),
    mainFactoryId: sanitizeRefId(o.mainFactoryId),
    association_assigned_factory_ids: Array.isArray(o.association_assigned_factory_ids)
      ? o.association_assigned_factory_ids.map((x) => String(x).trim()).filter(Boolean)
      : Array.isArray(o.associationAssignedFactoryIds)
        ? o.associationAssignedFactoryIds.map((x) => String(x).trim()).filter(Boolean)
        : [],
    associationAssignedFactoryIds: Array.isArray(o.associationAssignedFactoryIds)
      ? o.associationAssignedFactoryIds.map((x) => String(x).trim()).filter(Boolean)
      : Array.isArray(o.association_assigned_factory_ids)
        ? o.association_assigned_factory_ids.map((x) => String(x).trim()).filter(Boolean)
        : [],
  };
}

function buildOrderDbPatch(row) {
  return {
    has_test: Boolean(row.has_test),
    order_data: sanitizeOrderDataForDb(row.order_data),
    chat_messages: row.chat_messages,
    customer_id: sanitizeRefId(row.customer_id),
    ordered_by: row.ordered_by != null ? String(row.ordered_by).trim() || null : null,
    factory_site_id: sanitizeRefId(row.factory_site_id),
    status: row.status || 'pending',
    rejected_factory_ids: Array.isArray(row.rejected_factory_ids) ? row.rejected_factory_ids : [],
  };
}

export function normalizeOrderRow(row) {
  if (!row || typeof row !== 'object') return null;
  const colHasTest = row.has_test === true;
  const od =
    row.order_data && typeof row.order_data === 'object' && !Array.isArray(row.order_data)
      ? { ...row.order_data, id: row.id, has_test: colHasTest }
      : { id: row.id, has_test: colHasTest };
  const createdAt =
    od.createdAt != null ? String(od.createdAt) : row.created_at != null ? String(row.created_at) : '';
  const deliveryLat =
    row.delivery_lat != null && row.delivery_lat !== ''
      ? Number(row.delivery_lat)
      : od.delivery_lat != null
        ? Number(od.delivery_lat)
        : null;
  const deliveryLng =
    row.delivery_lng != null && row.delivery_lng !== ''
      ? Number(row.delivery_lng)
      : od.delivery_lng != null
        ? Number(od.delivery_lng)
        : null;
  return {
    ...od,
    createdAt,
    project_id: row.project_id != null ? String(row.project_id) : od.project_id ?? null,
    is_spot: row.is_spot === true || od.is_spot === true,
    customer_id: row.customer_id != null ? String(row.customer_id) : od.customer_id != null ? String(od.customer_id) : null,
    customerName: od.customerName != null ? String(od.customerName) : od.customer_name != null ? String(od.customer_name) : '',
    trading_company_name:
      od.trading_company_name != null
        ? String(od.trading_company_name)
        : od.projectTradingCompanyName != null
          ? String(od.projectTradingCompanyName)
          : od.traderName != null
            ? String(od.traderName)
            : '',
    projectTradingCompanyName:
      od.projectTradingCompanyName != null
        ? String(od.projectTradingCompanyName)
        : od.trading_company_name != null
          ? String(od.trading_company_name)
          : od.traderName != null
            ? String(od.traderName)
            : '',
    ordered_by: row.ordered_by != null ? String(row.ordered_by) : od.ordered_by != null ? String(od.ordered_by) : '',
    orderedBy: row.ordered_by != null ? String(row.ordered_by) : od.orderedBy != null ? String(od.orderedBy) : od.ordered_by != null ? String(od.ordered_by) : '',
    delivery_lat: Number.isFinite(deliveryLat) ? deliveryLat : null,
    delivery_lng: Number.isFinite(deliveryLng) ? deliveryLng : null,
    preferred_factory_id: sanitizeRefId(row.preferred_factory_id ?? od.preferred_factory_id ?? od.preferredFactoryId),
    preferredFactoryId: sanitizeRefId(row.preferred_factory_id ?? od.preferred_factory_id ?? od.preferredFactoryId),
    factory_site_id: sanitizeRefId(row.factory_site_id ?? od.factory_site_id ?? od.factorySiteId),
    factorySiteId: sanitizeRefId(row.factory_site_id ?? od.factory_site_id ?? od.factorySiteId),
    status:
      row.status != null
        ? String(row.status)
        : od.status != null
          ? String(od.status)
          : od.factoryResponseStatus != null
            ? String(od.factoryResponseStatus)
            : null,
    is_admin_modified: row.is_admin_modified === true || od.is_admin_modified === true,
    rejected_factory_ids: Array.isArray(row.rejected_factory_ids)
      ? row.rejected_factory_ids.map((x) => String(x)).filter(Boolean)
      : Array.isArray(od.rejected_factory_ids)
        ? od.rejected_factory_ids.map((x) => String(x)).filter(Boolean)
        : [],
    association_assigned_factory_ids: Array.isArray(od.association_assigned_factory_ids)
      ? od.association_assigned_factory_ids.map((x) => String(x).trim()).filter(Boolean)
      : Array.isArray(od.associationAssignedFactoryIds)
        ? od.associationAssignedFactoryIds.map((x) => String(x).trim()).filter(Boolean)
        : [],
    associationAssignedFactoryIds: Array.isArray(od.associationAssignedFactoryIds)
      ? od.associationAssignedFactoryIds.map((x) => String(x).trim()).filter(Boolean)
      : Array.isArray(od.association_assigned_factory_ids)
        ? od.association_assigned_factory_ids.map((x) => String(x).trim()).filter(Boolean)
        : [],
    override_map_image_url:
      row.override_map_image_url != null
        ? String(row.override_map_image_url).trim()
        : od.override_map_image_url != null
          ? String(od.override_map_image_url).trim()
          : od.map_image_url != null
            ? String(od.map_image_url).trim()
            : '',
    is_location_pending: resolveOrderLocationPending(row, od),
    isLocationPending: resolveOrderLocationPending(row, od),
    siteName: sanitizeSiteNameValue(od.siteName ?? od.site_name),
    site_name: sanitizeSiteNameValue(od.siteName ?? od.site_name),
    projectName: sanitizeSiteNameValue(od.projectName ?? od.project_name),
    project_name: sanitizeSiteNameValue(od.projectName ?? od.project_name),
  };
}

export async function fetchOrdersWithChat() {
  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const orders = [];
  const chatThreads = {};
  for (const row of data || []) {
    const order = normalizeOrderRow(row);
    if (order) orders.push(order);
    chatThreads[row.id] = normalizeChatMessages(row.chat_messages);
  }
  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter(Boolean))];
  const projectIds = [...new Set(orders.map((o) => o.project_id).filter(Boolean))];
  let customerById = new Map();
  let projectById = new Map();
  if (customerIds.length) {
    const { data: customers } = await supabase.from('customers').select(CUSTOMER_SELECT_MIN).in('id', customerIds);
    customerById = new Map((customers || []).map((c) => [String(c.id), c]));
  }
  if (projectIds.length) {
    let projects = null;
    let pErr = null;
    ({ data: projects, error: pErr } = await supabase.from('projects').select(PROJECT_SELECT_MIN).in('id', projectIds));
    if (pErr && isMissingRelationOrColumnError(pErr)) {
      ({ data: projects, error: pErr } = await supabase
        .from('projects')
        .select(PROJECT_SELECT_MIN_LEGACY)
        .in('id', projectIds));
    }
    if (pErr && isMissingRelationOrColumnError(pErr)) {
      ({ data: projects, error: pErr } = await supabase
        .from('projects')
        .select(PROJECT_SELECT_MIN_BASE)
        .in('id', projectIds));
    }
    if (pErr) {
      console.warn('[fetchOrdersWithChat] projects load failed', pErr);
      projects = [];
    }
    projectById = new Map((projects || []).map((p) => [String(p.id), p]));
  }
  for (let i = 0; i < orders.length; i += 1) {
    const o = orders[i];
    const c = o.customer_id ? customerById.get(String(o.customer_id)) : null;
    const p = o.project_id ? projectById.get(String(o.project_id)) : null;
    orders[i] = {
      ...o,
      customerName: o.customerName || (c?.company_name != null ? String(c.company_name) : ''),
      phone_number: o.phone_number || o.customerPhone || (c?.phone_number != null ? String(c.phone_number) : ''),
      customerPhone: o.customerPhone || o.phone_number || (c?.phone_number != null ? String(c.phone_number) : ''),
      projectName:
        sanitizeSiteNameValue(o.projectName) ||
        sanitizeSiteNameValue(p?.name) ||
        '',
      trading_company_name:
        o.trading_company_name ||
        o.projectTradingCompanyName ||
        (p?.trading_company_name != null
          ? String(p.trading_company_name)
          : p?.trading_company != null
            ? String(p.trading_company)
            : ''),
      projectTradingCompanyName:
        o.projectTradingCompanyName ||
        o.trading_company_name ||
        (p?.trading_company_name != null
          ? String(p.trading_company_name)
          : p?.trading_company != null
            ? String(p.trading_company)
            : ''),
      url_token: pickSiteUrlToken(p, c),
    };
  }
  return { orders, chatThreads };
}

export async function upsertOrdersBatch(orders, chatThreads) {
  const ids = (Array.isArray(orders) ? orders : []).map((o) => o && o.id).filter(Boolean);
  if (ids.length === 0) return;

  let existingById = new Map();
  const { data: existingRows, error: exErr } = await supabase
    .from('orders')
    .select('id, chat_messages')
    .in('id', ids);
  if (!exErr && Array.isArray(existingRows)) {
    existingById = new Map(existingRows.map((r) => [r.id, r.chat_messages]));
  }

  const rows = ids.map((id) => {
    const o = orders.find((x) => x && x.id === id);
    if (!o) return null;
    let msgs;
    if (chatThreads && chatThreads[id]) {
      msgs = normalizeChatMessages(chatThreads[id]);
    } else {
      msgs = normalizeChatMessages(existingById.get(id));
    }
    const hasTest = Boolean(o.has_test);
    const safeOrder = sanitizeOrderRefs(o);
    const customerId = sanitizeRefId(o.customer_id ?? safeOrder.customer_id);
    const orderedBy = String(o.ordered_by ?? o.orderedBy ?? safeOrder.ordered_by ?? '').trim();
    const factorySiteId = sanitizeRefId(safeOrder.factory_site_id);
    const preferredFactoryId = sanitizeRefId(safeOrder.preferred_factory_id);
    const mainFactoryId = sanitizeRefId(safeOrder.main_factory_id);
    const status =
      o.status != null
        ? String(o.status).trim()
        : o.factoryResponseStatus != null
          ? String(o.factoryResponseStatus).trim()
          : '';
    const rejectedFactoryIds = Array.isArray(o.rejected_factory_ids)
      ? [...new Set(o.rejected_factory_ids.map((x) => String(x).trim()).filter(Boolean))]
      : [];
    return {
      id: String(id),
      has_test: hasTest,
      order_data: sanitizeOrderDataForDb({
        ...safeOrder,
        id: String(id),
        has_test: hasTest,
        customer_id: customerId,
        customerName: o.customerName ?? safeOrder.customerName ?? '',
        trading_company_name: o.trading_company_name ?? o.projectTradingCompanyName ?? safeOrder.trading_company_name ?? '',
        projectTradingCompanyName: o.projectTradingCompanyName ?? o.trading_company_name ?? safeOrder.projectTradingCompanyName ?? '',
        ordered_by: orderedBy,
        orderedBy,
        rejected_factory_ids: rejectedFactoryIds,
        factory_site_id: factorySiteId,
        factorySiteId: factorySiteId,
        preferred_factory_id: preferredFactoryId,
        preferredFactoryId: preferredFactoryId,
        main_factory_id: mainFactoryId,
        mainFactoryId: mainFactoryId,
      }),
      chat_messages: msgs,
      customer_id: customerId,
      ordered_by: orderedBy || null,
      factory_site_id: factorySiteId,
      status: status || 'pending',
      rejected_factory_ids: rejectedFactoryIds,
    };
  }).filter(Boolean);

  const existingIds = new Set(existingById.keys());
  const updateRows = rows.filter((r) => existingIds.has(r.id));
  const insertRows = rows.filter((r) => !existingIds.has(r.id));

  for (const row of updateRows) {
    const { error } = await supabase
      .from('orders')
      .update(buildOrderDbPatch(row))
      .eq('id', row.id);
    if (error) throw error;
  }

  if (insertRows.length > 0) {
    const { error } = await supabase.from('orders').insert(insertRows.map((row) => ({ ...row, ...buildOrderDbPatch(row) })));
    if (error) throw error;
  }
}

function parseDeliveryCoord(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildOrderInsertRow(order) {
  const id = createOrderId();
  const hasTest = Boolean(order.has_test);
  const isSpot = Boolean(order.is_spot);
  const projectId = !isSpot && order.project_id != null ? String(order.project_id).trim() : '';
  const customerId = sanitizeRefId(order.customer_id ?? order.customerId);
  const orderedBy = String(order.ordered_by ?? order.orderedBy ?? '').trim();
  const isLocationPending = Boolean(order.is_location_pending ?? order.isLocationPending);
  const deliveryLat = isSpot ? parseDeliveryCoord(order.delivery_lat ?? order.deliveryLat) : null;
  const deliveryLng = isSpot ? parseDeliveryCoord(order.delivery_lng ?? order.deliveryLng) : null;
  const safeOrder = sanitizeOrderRefs(order);
  const preferredFactoryId = sanitizeRefId(safeOrder.preferred_factory_id);
  const statusRaw = String(order.status || 'pending').trim() || 'pending';
  const nextOrder = sanitizeOrderDataForDb({
    ...safeOrder,
    id,
    has_test: hasTest,
    is_location_pending: isLocationPending,
    isLocationPending,
    customer_id: customerId,
    customerName: safeOrder.customerName ?? '',
    trading_company_name: safeOrder.trading_company_name ?? safeOrder.projectTradingCompanyName ?? '',
    projectTradingCompanyName: safeOrder.projectTradingCompanyName ?? safeOrder.trading_company_name ?? '',
    ordered_by: orderedBy,
    orderedBy,
    factory_site_id: null,
    factorySiteId: null,
    preferred_factory_id: preferredFactoryId,
    preferredFactoryId: preferredFactoryId,
    main_factory_id: sanitizeRefId(safeOrder.main_factory_id),
    mainFactoryId: sanitizeRefId(safeOrder.mainFactoryId),
    delivery_lat: deliveryLat,
    delivery_lng: deliveryLng,
    deliveryLat,
    deliveryLng,
  });
  return {
    id,
    has_test: hasTest,
    order_data: nextOrder,
    chat_messages: [],
    customer_id: customerId,
    ordered_by: orderedBy || null,
    is_spot: isSpot,
    project_id: projectId || null,
    delivery_lat: deliveryLat,
    delivery_lng: deliveryLng,
    preferred_factory_id: sanitizeRefId(preferredFactoryId),
    factory_site_id: null,
    status: statusRaw,
    is_location_pending: isLocationPending,
    rejected_factory_ids: [],
  };
}

export async function insertOrder(order) {
  if (!order || typeof order !== 'object') throw new Error('order が必要です');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = buildOrderInsertRow(order);
    const { data, error } = await supabase.from('orders').insert([row]).select(ORDER_SELECT).single();
    if (!error) return normalizeOrderRow(data);
    if (error.code !== '23505' || attempt === 2) {
      console.error('insertOrder failed', error);
      throw error;
    }
  }
  throw new Error('注文IDの生成に失敗しました');
}

/** 複数注文を orders テーブルへ一括挿入 */
export async function insertOrdersBulk(orders) {
  const list = Array.isArray(orders) ? orders.filter((o) => o && typeof o === 'object') : [];
  if (list.length === 0) throw new Error('登録する注文がありません');

  const rows = list.map((order) => buildOrderInsertRow(order));
  const { data, error } = await supabase.from('orders').insert(rows).select(ORDER_SELECT);
  if (error) {
    console.error('insertOrdersBulk failed', error);
    throw error;
  }
  return (data || []).map(normalizeOrderRow).filter(Boolean);
}

export async function updateOrderDetails(orderId, updatedData) {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('orderId が必要です');
  const patch = updatedData && typeof updatedData === 'object' && !Array.isArray(updatedData) ? updatedData : {};

  const { data: row, error: selErr } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (selErr) {
    console.error('updateOrderDetails select failed', selErr);
    throw selErr;
  }
  if (!row) throw new Error('注文が見つかりません');

  const currentOrder = normalizeOrderRow(row) || { id };
  const nextOrder = sanitizeOrderDataForDb({ ...currentOrder, ...patch, id });
  const status = nextOrder.status != null ? String(nextOrder.status) : row.status;
  const hasTest = Boolean(nextOrder.has_test);
  const factorySiteId = sanitizeRefId(nextOrder.factory_site_id);
  const preferredFactoryId = sanitizeRefId(nextOrder.preferred_factory_id ?? nextOrder.preferredFactoryId);
  const customerId = sanitizeRefId(nextOrder.customer_id);
  const orderedBy = String(nextOrder.ordered_by ?? nextOrder.orderedBy ?? '').trim();
  const updateRow = {
    order_data: nextOrder,
    has_test: hasTest,
    customer_id: customerId,
    ordered_by: orderedBy || null,
    status: status || 'pending',
  };
  if (
    Object.prototype.hasOwnProperty.call(patch, 'factory_site_id') ||
    Object.prototype.hasOwnProperty.call(patch, 'factorySiteId')
  ) {
    updateRow.factory_site_id = factorySiteId;
  } else {
    updateRow.factory_site_id = sanitizeRefId(row.factory_site_id ?? nextOrder.factory_site_id);
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'preferred_factory_id') ||
    Object.prototype.hasOwnProperty.call(patch, 'preferredFactoryId') ||
    Object.prototype.hasOwnProperty.call(patch, 'association_assigned_factory_ids') ||
    Object.prototype.hasOwnProperty.call(patch, 'associationAssignedFactoryIds')
  ) {
    updateRow.preferred_factory_id = preferredFactoryId;
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'rejected_factory_ids') ||
    Object.prototype.hasOwnProperty.call(patch, 'rejectedFactoryIds')
  ) {
    const rejected = patch.rejected_factory_ids ?? patch.rejectedFactoryIds;
    updateRow.rejected_factory_ids = Array.isArray(rejected)
      ? rejected.map((x) => String(x).trim()).filter(Boolean)
      : [];
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'is_location_pending') ||
    Object.prototype.hasOwnProperty.call(patch, 'isLocationPending')
  ) {
    updateRow.is_location_pending = Boolean(patch.is_location_pending ?? patch.isLocationPending);
  }
  const { data: updated, error: upErr } = await supabase
    .from('orders')
    .update(updateRow)
    .eq('id', id)
    .select(ORDER_SELECT)
    .single();
  if (upErr) {
    console.error('updateOrderDetails update failed', upErr);
    throw upErr;
  }
  return normalizeOrderRow(updated);
}

export async function adminUpdateOrder(orderId, updatedData) {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('orderId が必要です');
  const patch = updatedData && typeof updatedData === 'object' && !Array.isArray(updatedData) ? updatedData : {};
  return updateOrderDetails(id, { ...patch, is_admin_modified: true });
}

export async function adminDeleteOrder(orderId) {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('orderId が必要です');
  return adminUpdateOrder(id, {
    status: 'deleted',
    factoryResponseStatus: 'deleted',
    factoryResponseLocked: true,
  });
}

/** 組合承認待ち（pending_association）を工場指定付きで配車待ちへ */
/** 管理者: 手配先工場の振り替え（メイン・応援工場の上書き） */
export async function reassignOrderFactories(orderId, options = {}) {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('orderId が必要です');

  const { preferredFactoryId, associationAssignedFactoryIds } = normalizeAssociationFactorySelection(options);
  if (!preferredFactoryId && associationAssignedFactoryIds.length === 0) {
    throw new Error('手配先工場を1件以上選択してください');
  }

  const { data: row, error: selErr } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle();
  if (selErr) throw selErr;
  if (!row) throw new Error('注文が見つかりません');

  const current = normalizeOrderRow(row);
  const resetStatus = shouldResetOrderStatusOnFactoryReassign(current);
  const now = new Date().toISOString();

  const patch = {
    preferred_factory_id: preferredFactoryId,
    preferredFactoryId,
    association_assigned_factory_ids: associationAssignedFactoryIds,
    associationAssignedFactoryIds,
    association_reassigned_at: now,
    associationReassignedAt: now,
  };

  if (resetStatus) {
    Object.assign(patch, {
      status: 'pending',
      factory_site_id: null,
      factorySiteId: null,
      factoryResponseStatus: undefined,
      factoryResponseLocked: false,
      factoryPendingStartedAt: undefined,
      factoryPendingByName: undefined,
      factoryRejectSource: undefined,
      factoryUnlockRequested: false,
      acceptedFactoryLabel: undefined,
      confirmedQuantityM3: undefined,
      confirmedMixText: undefined,
    });
  }

  return adminUpdateOrder(id, patch);
}

export async function approveOrderForAssociation(orderId, options = {}) {
  const { preferredFactoryId, associationAssignedFactoryIds } = normalizeAssociationFactorySelection(options);
  if (!preferredFactoryId && associationAssignedFactoryIds.length === 0) {
    throw new Error('手配先工場を1件以上選択してください');
  }
  const approvedAt = new Date().toISOString();
  return updateOrderDetails(orderId, {
    status: 'pending',
    preferred_factory_id: preferredFactoryId,
    preferredFactoryId,
    association_assigned_factory_ids: associationAssignedFactoryIds,
    associationAssignedFactoryIds,
    association_approved_at: approvedAt,
    associationApprovedAt: approvedAt,
    factoryResponseStatus: undefined,
    factoryResponseLocked: false,
    factoryPendingStartedAt: undefined,
    factoryPendingByName: undefined,
    factoryRejectSource: undefined,
  });
}

export async function markOrderCustomerCancelled(orderId) {
  return updateOrderDetails(orderId, {
    status: 'customer_cancelled',
    factoryResponseStatus: 'customer_cancelled',
    factoryResponseLocked: true,
    factoryPendingStartedAt: undefined,
    factoryPendingByName: undefined,
  });
}

export async function acceptOrderForFactory(order, factorySiteId, factorySiteName) {
  if (!order?.id) throw new Error('order.id が必要です');
  const id = String(order.id);
  const fid = sanitizeRefId(factorySiteId);
  if (!fid) throw new Error('factorySiteId が必要です');
  const fname = String(factorySiteName || '').trim();
  const hasTest = Boolean(order.has_test);
  const qRaw = order.quantityM3 ?? order.quantityCube;
  const nextOrder = {
    ...order,
    id,
    has_test: hasTest,
    status: 'accepted',
    factoryResponseStatus: 'accepted',
    acceptedFactoryLabel: order.acceptedFactoryLabel || `受注工場：${fname || fid}`,
    factorySiteName: fname || order.factorySiteName || fid,
    factorySiteId: fid,
    factory_site_id: fid,
    factoryResponseLocked: true,
    factoryUnlockRequested: false,
    factoryPendingStartedAt: undefined,
    factoryPendingByName: undefined,
    confirmedQuantityM3:
      qRaw !== undefined && qRaw !== null && String(qRaw).trim() !== '' ? qRaw : null,
    confirmedMixText: order.mixText?.trim() || '',
  };
  const { error } = await supabase
    .from('orders')
    .update({
      factory_site_id: fid,
      status: 'accepted',
      has_test: hasTest,
      order_data: nextOrder,
    })
    .eq('id', id)
    .eq('status', 'pending');
  if (error) {
    console.error('acceptOrderForFactory update failed', error);
    throw error;
  }
  const { data: verify, error: verifyErr } = await supabase
    .from('orders')
    .select('id')
    .eq('id', id)
    .eq('factory_site_id', fid)
    .eq('status', 'accepted')
    .maybeSingle();
  if (verifyErr) {
    console.error('acceptOrderForFactory verify failed', verifyErr);
    throw verifyErr;
  }
  if (!verify) {
    const err = new Error('この注文はすでに他工場が受注済みです。');
    console.error('acceptOrderForFactory optimistic lock failed', { orderId: id, factorySiteId: fid });
    throw err;
  }
  return nextOrder;
}

export async function rejectOrderForFactory(orderId, factoryId) {
  const id = String(orderId || '').trim();
  const fid = sanitizeRefId(factoryId);
  if (!id) throw new Error('orderId が必要です');
  if (!fid) throw new Error('factoryId が必要です');

  const { data: row, error: selErr } = await supabase
    .from('orders')
    .select('order_data, rejected_factory_ids')
    .eq('id', id)
    .maybeSingle();
  if (selErr) {
    console.error('rejectOrderForFactory select failed', selErr);
    throw selErr;
  }
  if (!row) throw new Error('注文が見つかりません');

  const current = Array.isArray(row.rejected_factory_ids)
    ? row.rejected_factory_ids.map((x) => String(x)).filter(Boolean)
    : [];
  const nextIds = [...new Set([...current, fid])];
  const od =
    row.order_data && typeof row.order_data === 'object' && !Array.isArray(row.order_data)
      ? row.order_data
      : {};
  const nextOrderData = { ...od, rejected_factory_ids: nextIds };

  const { error: upErr } = await supabase
    .from('orders')
    .update({
      rejected_factory_ids: nextIds,
      order_data: nextOrderData,
    })
    .eq('id', id);
  if (upErr) {
    console.error('rejectOrderForFactory update failed', upErr);
    throw upErr;
  }
  return nextIds;
}

export async function appendChatMessage(orderId, from, body) {
  const t = String(body || '').trim();
  if (!orderId || !t) return;
  const id = String(orderId);
  const { data: row, error: selErr } = await supabase
    .from('orders')
    .select('chat_messages')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  const list = normalizeChatMessages(row?.chat_messages);
  list.push({
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    from: from === 'factory' ? 'factory' : from === 'system' ? 'system' : 'master',
    body: t,
    createdAt: new Date().toISOString(),
  });
  const next = list.slice(-100);
  const { error: upErr } = await supabase.from('orders').update({ chat_messages: next }).eq('id', id);
  if (upErr) throw upErr;
}

function mapFactoryRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = row.id != null ? String(row.id) : '';
  const name = row.name != null ? String(row.name) : '';
  const latitude = row.latitude ?? row.lat ?? null;
  const longitude = row.longitude ?? row.lng ?? row.lon ?? null;
  return {
    id,
    name,
    phone_number: row.phone_number != null ? String(row.phone_number) : '',
    latitude,
    longitude,
    allowed_delivery_areas: normalizeAllowedDeliveryAreas(row?.allowed_delivery_areas),
    raw: row,
  };
}

/** factories テーブルから全工場（id, name, latitude, longitude 等） */
export async function fetchFactories() {
  const { data, error } = await supabase.from('factories').select('*').order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapFactoryRow).filter(Boolean);
}

export async function verifyFactoryPassword(factoryId, inputPassword) {
  const fid = String(factoryId || '').trim();
  if (!fid) return false;
  const { data, error } = await supabase
    .from('factories')
    .select('id, login_password')
    .eq('id', fid)
    .maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return String(data.login_password ?? '') === String(inputPassword ?? '');
}

export async function fetchSchedulesForFactory(factorySiteId) {
  const fid = sanitizeRefId(factorySiteId);
  if (!fid) return {};
  const { data, error } = await supabase
    .from('schedules')
    .select('date, blocks')
    .eq('factory_site_id', fid);
  if (error) throw error;
  const map = {};
  for (const r of data || []) {
    const dk = r.date != null ? String(r.date).slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) {
      map[dk] = normalizeDayBlockSchedule(r.blocks);
    }
  }
  return normalizeFullSchedule(map);
}

/**
 * 複数工場のスケジュールを一括取得し、factory_site_id → 日付→blocks のマップにまとめる
 * @returns {Record<string, ReturnType<typeof normalizeFullSchedule>>}
 */
export async function fetchSchedulesForFactories(factorySiteIds) {
  const ids = [...new Set((factorySiteIds || []).map((x) => sanitizeRefId(x)).filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('schedules')
    .select('factory_site_id, date, blocks')
    .in('factory_site_id', ids);
  if (error) throw error;
  /** @type {Record<string, Record<string, unknown>>} */
  const byFactory = {};
  for (const fid of ids) {
    byFactory[fid] = {};
  }
  for (const r of data || []) {
    const fid = r.factory_site_id != null ? String(r.factory_site_id) : '';
    if (!fid || byFactory[fid] === undefined) continue;
    const dk = r.date != null ? String(r.date).slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk)) {
      byFactory[fid][dk] = normalizeDayBlockSchedule(r.blocks);
    }
  }
  for (const fid of ids) {
    byFactory[fid] = normalizeFullSchedule(byFactory[fid] || {});
  }
  return byFactory;
}

export async function upsertScheduleDay(factorySiteId, dateStr, blocks) {
  const fid = sanitizeRefId(factorySiteId);
  if (!fid) throw new Error('factorySiteId が必要です');
  const { error } = await supabase.from('schedules').upsert(
    {
      factory_site_id: fid,
      date: dateStr,
      blocks: normalizeDayBlockSchedule(blocks),
    },
    { onConflict: 'factory_site_id,date' },
  );
  if (error) throw error;
}

/**
 * 満車スケジュールに基づく自動拒否を orders に反映（マスター・工場どちらからでも呼べる）
 * @param {Record<string, ReturnType<typeof normalizeFullSchedule>>} schedulesByFactoryId - 工場 id → 日付別スケジュール
 * @param {Record<string, string>} [factoryNameById] - 工場 id → 表示名（省略時は注文の factorySiteName / デフォルト）
 */
export async function persistScheduleAutoRejections({
  schedulesByFactoryId,
  orders,
  chatThreads,
  factoryNameById = {},
  defaultFactorySiteName = DISPATCH_DEFAULT_FACTORY_SITE_NAME,
  defaultFactorySiteId = DISPATCH_DEFAULT_FACTORY_SITE_ID,
}) {
  const byF = schedulesByFactoryId && typeof schedulesByFactoryId === 'object' ? schedulesByFactoryId : {};
  let changed = false;
  const nextThreads = { ...chatThreads };
  const next = orders.map((o) => {
    if (!o || !o.id) return o;
    if (o.factoryResponseStatus || o.scheduleAutoChecked) return o;
    const date = o.scheduleMatchDate || o.preferredDate;
    if (!date || typeof date !== 'string') {
      changed = true;
      return { ...o, scheduleAutoChecked: true };
    }
    const fid = sanitizeRefId(o.factory_site_id) || sanitizeRefId(defaultFactorySiteId) || '';
    const scheduleMap = normalizeFullSchedule(byF[fid] || {});
    const dayBlocks = normalizeDayBlockSchedule(scheduleMap[date]);
    const reason = computeScheduleAutoRejectReason(o, dayBlocks);
    if (!reason) {
      changed = true;
      return { ...o, scheduleAutoChecked: true };
    }
    changed = true;
    const id = o.id;
    const body = `${reason}\n（満車のため拒否 — システム自動応答）`;
    const list = Array.isArray(nextThreads[id]) ? [...nextThreads[id]] : [];
    list.push({
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      from: 'system',
      body,
      createdAt: new Date().toISOString(),
    });
    nextThreads[id] = list.slice(-100);
    const resolvedName =
      (o.factorySiteName && String(o.factorySiteName).trim()) ||
      (fid && factoryNameById[fid]) ||
      defaultFactorySiteName;
    return {
      ...o,
      factoryResponseStatus: 'rejected',
      factoryResponseLocked: true,
      factoryRejectSource: 'schedule_auto',
      factorySiteName: resolvedName,
      factorySiteId: fid || defaultFactorySiteId,
      scheduleAutoChecked: true,
      acceptedFactoryLabel: undefined,
      factoryPendingStartedAt: undefined,
      factoryPendingByName: undefined,
      factoryUnlockRequested: false,
    };
  });
  if (!changed) return { changed: false, orders, chatThreads };
  await upsertOrdersBatch(next, nextThreads);
  return { changed: true, orders: next, chatThreads: nextThreads };
}

export async function subscribeHaishaRealtime(onEvent) {
  await ensurePanelRealtimeAuth();
  const channelName = `haisha-realtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factories' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_settings' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factory_news' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factory_news_reads' }, onEvent)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

function normalizeSubFactoryIds(raw) {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  return [];
}

function mapProjectRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: row.id != null ? String(row.id) : '',
    name: row.name != null ? String(row.name) : '',
    customer_id: row.customer_id != null ? String(row.customer_id) : '',
    main_factory_id: row.main_factory_id != null ? String(row.main_factory_id) : '',
    sub_factory_ids: normalizeSubFactoryIds(row.sub_factory_ids),
    lat: row.lat != null && row.lat !== '' ? Number(row.lat) : null,
    lng: row.lng != null && row.lng !== '' ? Number(row.lng) : null,
    trading_company_name:
      row.trading_company_name != null
        ? String(row.trading_company_name)
        : row.trading_company != null
          ? String(row.trading_company)
          : '',
    trading_company: row.trading_company != null ? String(row.trading_company) : '',
    contractor: row.contractor != null ? String(row.contractor) : '',
    sub_contractor_name:
      row.sub_contractor_name != null
        ? String(row.sub_contractor_name)
        : row.contractor != null
          ? String(row.contractor)
          : '',
    delivery_area: row.delivery_area != null ? String(row.delivery_area) : '',
    site_address: row.site_address != null ? String(row.site_address) : '',
    url_token:
      row.url_token != null && isValidSiteOrderUrlToken(String(row.url_token))
        ? String(row.url_token).trim()
        : '',
    folder_url: normalizeExternalUrl(row.folder_url),
    sheet_url: normalizeExternalUrl(row.sheet_url),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapCustomerRow(row) {
  if (!row || typeof row !== 'object') return null;
  const companyName = row.company_name != null ? String(row.company_name) : row.name != null ? String(row.name) : '';
  return {
    id: row.id != null ? String(row.id) : '',
    company_name: companyName,
    name: companyName,
    manager_name: row.manager_name != null ? String(row.manager_name) : '',
    phone_number: row.phone_number != null ? String(row.phone_number) : '',
    login_password: row.login_password != null ? String(row.login_password) : '',
    url_token:
      row.url_token != null && isValidSiteOrderUrlToken(String(row.url_token))
        ? String(row.url_token).trim()
        : '',
    created_at: row.created_at,
  };
}

export async function fetchCustomers() {
  const { data, error } = await supabase.from('customers').select('*').order('company_name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapCustomerRow).filter(Boolean);
}

const BULK_INSERT_CHUNK = 100;

export async function bulkInsertCustomers(customerRows) {
  const list = Array.isArray(customerRows) ? customerRows.filter((r) => r && typeof r === 'object') : [];
  if (list.length === 0) return [];

  const prepared = list.map((customerData) => {
    const companyName = String(customerData?.company_name || customerData?.name || '').trim();
    if (!companyName) throw new Error('業者名（会社名）が空の行があります');
    const loginPassword = String(customerData?.login_password || '').trim();
    if (!loginPassword) throw new Error('ログインパスワードが空の行があります');
    const phoneNumber = String(customerData?.phone_number || '').trim();
    if (!phoneNumber) throw new Error('電話番号が空の行があります');
    return {
      company_name: companyName,
      manager_name: String(customerData?.manager_name || '').trim() || null,
      phone_number: phoneNumber,
      login_password: loginPassword,
    };
  });

  const inserted = [];
  for (let i = 0; i < prepared.length; i += BULK_INSERT_CHUNK) {
    const chunk = prepared.slice(i, i + BULK_INSERT_CHUNK);
    const { data, error } = await supabase.from('customers').insert(chunk).select('*');
    if (error) throw error;
    inserted.push(...(data || []));
  }
  return inserted.map(mapCustomerRow).filter(Boolean);
}

export async function addCustomer(customerData) {
  const companyName = String(customerData?.company_name || customerData?.name || '').trim();
  if (!companyName) throw new Error('業者名（会社名）を入力してください');
  const loginPassword = String(customerData?.login_password || '').trim();
  if (!loginPassword) throw new Error('ログインパスワードを入力してください');
  const phoneNumber = String(customerData?.phone_number || '').trim();
  if (!phoneNumber) throw new Error('電話番号を入力してください');
  const row = {
    company_name: companyName,
    manager_name: String(customerData?.manager_name || '').trim() || null,
    phone_number: phoneNumber,
    login_password: loginPassword,
  };
  const { data, error } = await supabase.from('customers').insert(row).select('*').single();
  if (error) throw error;
  return mapCustomerRow(data);
}

export async function updateCustomer(id, customerData) {
  const customerId = sanitizeRefId(id);
  if (!customerId) throw new Error('業者IDが必要です');
  const companyName = String(customerData?.company_name || customerData?.name || '').trim();
  if (!companyName) throw new Error('業者名（会社名）を入力してください');
  const loginPassword = String(customerData?.login_password || '').trim();
  if (!loginPassword) throw new Error('ログインパスワードを入力してください');
  const phoneNumber = String(customerData?.phone_number || '').trim();
  if (!phoneNumber) throw new Error('電話番号を入力してください');
  const row = {
    company_name: companyName,
    manager_name: String(customerData?.manager_name || '').trim() || null,
    phone_number: phoneNumber,
    login_password: loginPassword,
  };
  const { data, error } = await supabase.from('customers').update(row).eq('id', customerId).select('*').single();
  if (error) throw error;
  return mapCustomerRow(data);
}

export async function loginCustomer(phoneNumber, password) {
  const phone = String(phoneNumber || '').trim();
  const pass = String(password || '').trim();
  if (!phone || !pass) return null;

  const { data, error } = await supabase.rpc('login_customer', {
    p_phone: phone,
    p_password: pass,
  });
  if (!error && data != null) {
    const row = typeof data === 'string' ? JSON.parse(data) : data;
    if (!row || !row.id) return null;
    return mapCustomerRow({ ...row, login_password: pass, realtime_token: row.realtime_token });
  }

  const missingFn =
    error && (error.code === '42883' || /login_customer/i.test(String(error.message || '')));
  if (!missingFn) throw error;

  const { data: legacy, error: legacyErr } = await supabase
    .from('customers')
    .select('*')
    .eq('phone_number', phone)
    .eq('login_password', pass)
    .maybeSingle();
  if (legacyErr) throw legacyErr;
  return legacy ? mapCustomerRow(legacy) : null;
}

export async function deleteCustomer(id) {
  const customerId = sanitizeRefId(id);
  if (!customerId) throw new Error('業者IDが必要です');
  const { error } = await supabase.from('customers').delete().eq('id', customerId);
  if (error) throw error;
}

function mapAdminSettingsRow(row) {
  return {
    id: 1,
    admin_name: row?.admin_name != null ? String(row.admin_name) : '',
    phone_number: row?.phone_number != null ? String(row.phone_number) : '',
    login_password: row?.login_password != null ? String(row.login_password) : '',
    allowed_delivery_areas: normalizeAllowedDeliveryAreas(row?.allowed_delivery_areas),
    spot_threshold_volume: parseSpotThresholdVolume(row?.spot_threshold_volume),
    updated_at: row?.updated_at,
  };
}

export async function fetchAdminSettings() {
  const { data, error } = await supabase.from('admin_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return mapAdminSettingsRow(data || { id: 1, admin_name: '管理者', phone_number: '', login_password: '' });
}

export async function loginAdmin(phoneNumber, password) {
  const phone = String(phoneNumber || '').trim();
  const pass = String(password || '').trim();
  if (!phone || !pass) throw new Error('管理者の電話番号とパスワードを入力してください');

  const { data, error } = await supabase.rpc('login_admin', {
    p_phone: phone,
    p_password: pass,
  });
  if (!error && data != null) {
    const row = typeof data === 'string' ? JSON.parse(data) : data;
    return mapAdminSettingsRow({ ...row, login_password: pass, realtime_token: row.realtime_token });
  }

  const missingFn =
    error &&
    (error.code === '42883' || /login_admin/i.test(String(error.message || '')));
  if (!missingFn) throw error;

  const { data: legacy, error: legacyErr } = await supabase
    .from('admin_settings')
    .select('*')
    .eq('id', 1)
    .eq('phone_number', phone)
    .eq('login_password', pass)
    .maybeSingle();
  if (legacyErr) throw legacyErr;
  if (!legacy) throw new Error('管理者の電話番号またはパスワードが間違っています');
  return mapAdminSettingsRow(legacy);
}

export async function updateAdminSettings(payload) {
  const row = {
    id: 1,
    admin_name: String(payload?.admin_name || '').trim() || null,
    phone_number: String(payload?.phone_number || '').trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'login_password')) {
    row.login_password = String(payload?.login_password || '').trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'allowed_delivery_areas')) {
    row.allowed_delivery_areas = normalizeAllowedDeliveryAreas(payload.allowed_delivery_areas);
  }
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'spot_threshold_volume')) {
    row.spot_threshold_volume = parseSpotThresholdVolume(payload.spot_threshold_volume);
  }
  const { data, error } = await supabase
    .from('admin_settings')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw error;
  return mapAdminSettingsRow(data);
}

export async function updateAdminPassword(currentPassword, newPassword) {
  const current = String(currentPassword || '').trim();
  const next = String(newPassword || '').trim();
  if (!current || !next) throw new Error('現在のパスワードと新しいパスワードを入力してください');
  const { data: row, error: selectError } = await supabase
    .from('admin_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!row) throw new Error('管理者設定が見つかりません');
  if (String(row.login_password ?? '') !== current) {
    throw new Error('現在のパスワードが間違っています');
  }
  const { data, error } = await supabase
    .from('admin_settings')
    .update({ login_password: next, updated_at: new Date().toISOString() })
    .eq('id', 1)
    .select('*')
    .single();
  if (error) throw error;
  return mapAdminSettingsRow(data);
}

/** Supabase RPC の json / jsonb 戻り値をオブジェクトに正規化 */
function normalizeSupabaseRpcJson(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    } catch {
      return null;
    }
  }
  if (typeof data === 'object') return data;
  return null;
}

function normalizeRpcProjectsArray(raw) {
  const p = raw?.projects;
  if (Array.isArray(p)) return p;
  if (p && typeof p === 'object' && !Array.isArray(p)) return Object.values(p);
  return [];
}

/** 専用発注URLトークンから物件・業者を解決（RPC・未ログイン可） */
export async function fetchSiteOrderContextByUrlToken(urlToken) {
  const token = String(urlToken || '').trim();
  if (!isValidSiteOrderUrlToken(token)) return null;

  const { data, error } = await supabase.rpc('get_site_order_context_by_token', { p_token: token });
  if (error) throw error;
  if (data == null) return null;

  const raw = normalizeSupabaseRpcJson(data);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  let project = null;
  let customer = null;
  let projects = [];

  try {
    project = raw.project && typeof raw.project === 'object' ? mapProjectRow(raw.project) : null;
    customer =
      raw.customer && typeof raw.customer === 'object'
        ? mapCustomerRow({ ...raw.customer, login_password: '' })
        : null;
    const rawList = normalizeRpcProjectsArray(raw);
    projects = rawList.map((row) => (row && typeof row === 'object' ? mapProjectRow(row) : null)).filter(Boolean);
    if (!projects.length && project) projects = [project];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`専用発注コンテキストの解釈に失敗しました: ${msg}`);
  }

  const parties =
    raw.parties && typeof raw.parties === 'object' && !Array.isArray(raw.parties) ? raw.parties : null;

  return {
    token: String(raw.token ?? token),
    project,
    customer,
    projects,
    parties,
    match: raw.match === 'customer' ? 'customer' : 'project',
  };
}

/** 発注画面向け運用設定（login_password なし・未ログイン可） */
export async function fetchDispatchOperationalSettings() {
  const { data, error } = await supabase.rpc('get_dispatch_operational_settings');
  if (!error) {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return mapAdminSettingsRow({ id: 1, admin_name: '', phone_number: '', login_password: '' });
    return mapAdminSettingsRow({ ...row, login_password: '' });
  }
  // RPC 未作成時（デモ環境で admin_settings が anon 読取可の場合）のフォールバック
  const missingFn =
    error.code === '42883' ||
    /get_dispatch_operational_settings/i.test(String(error.message || ''));
  if (!missingFn) throw error;
  const { data: row, error: selErr } = await supabase.from('admin_settings').select('*').eq('id', 1).maybeSingle();
  if (selErr) throw selErr;
  return mapAdminSettingsRow(row ? { ...row, login_password: '' } : { id: 1, admin_name: '', phone_number: '', login_password: '' });
}

/** 専用発注URL向け工場一覧（物件のメイン・サブ工場、未ログイン可） */
export async function fetchGuestFactoriesForToken(urlToken) {
  const token = String(urlToken || '').trim();
  if (!isValidSiteOrderUrlToken(token)) return [];
  const { data, error } = await supabase.rpc('get_guest_factories_for_token', { p_token: token });
  if (error) throw error;
  const normalized = normalizeSupabaseRpcJson(data);
  let list = [];
  if (Array.isArray(normalized)) list = normalized;
  else if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
    list = Object.values(normalized);
  }
  return list.map((row) => (row && typeof row === 'object' ? mapFactoryRow(row) : null)).filter(Boolean);
}

/** ゲスト専用発注の一括登録（RPC） */
export async function submitGuestOrders(urlToken, orders) {
  const token = String(urlToken || '').trim();
  if (!isValidSiteOrderUrlToken(token)) throw new Error('専用発注URLが無効です');
  const list = Array.isArray(orders) ? orders.filter((o) => o && typeof o === 'object') : [];
  if (list.length === 0) throw new Error('登録する注文がありません');

  const { data, error } = await supabase.rpc('submit_guest_orders', {
    p_token: token,
    p_orders: list,
  });
  if (error) throw error;
  const inserted = Array.isArray(data) ? data : [];
  return inserted.map((row) => (row && row.id ? { id: String(row.id) } : null)).filter(Boolean);
}

/** 物件マスタ一覧 */
export async function fetchProjects() {
  const { data, error } = await supabase.from('projects').select('*').order('name', { ascending: true });
  if (error) throw error;
  const mapped = (data || []).map(mapProjectRow).filter(Boolean);
  return enrichProjectsWithCustomerUrlTokens(mapped);
}

export async function bulkInsertProjects(projectRows) {
  const list = Array.isArray(projectRows) ? projectRows.filter((r) => r && typeof r === 'object') : [];
  if (list.length === 0) return [];

  const prepared = list.map((payload) => {
    const main_factory_id = String(payload.main_factory_id || '').trim();
    if (!main_factory_id) throw new Error('メイン工場が未設定の行があります');
    const name = String(payload.name || '').trim();
    if (!name) throw new Error('物件名が空の行があります');
    const sub_factory_ids = normalizeSubFactoryIds(payload.sub_factory_ids).filter((id) => id !== main_factory_id);
    return {
      name,
      customer_id: sanitizeRefId(payload.customer_id),
      main_factory_id,
      sub_factory_ids,
      lat:
        payload.lat != null && payload.lat !== '' && Number.isFinite(Number(payload.lat))
          ? Number(payload.lat)
          : null,
      lng:
        payload.lng != null && payload.lng !== '' && Number.isFinite(Number(payload.lng))
          ? Number(payload.lng)
          : null,
      trading_company_name: String(payload.trading_company_name || payload.trading_company || '').trim() || null,
      trading_company: String(payload.trading_company || payload.trading_company_name || '').trim() || null,
      contractor: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
      sub_contractor_name: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
      delivery_area: String(payload.delivery_area || '').trim() || null,
      site_address: String(payload.site_address || '').trim() || null,
      folder_url: normalizeExternalUrl(payload.folder_url) || null,
      sheet_url: normalizeExternalUrl(payload.sheet_url) || null,
      url_token: resolveUrlTokenForInsert(payload),
    };
  });

  const inserted = [];
  for (let i = 0; i < prepared.length; i += BULK_INSERT_CHUNK) {
    const chunk = prepared.slice(i, i + BULK_INSERT_CHUNK);
    const { data, error } = await supabase.from('projects').insert(chunk).select('*');
    if (error) throw error;
    inserted.push(...(data || []));
  }
  const mapped = inserted.map(mapProjectRow).filter(Boolean);
  return enrichProjectsWithCustomerUrlTokens(mapped);
}

export async function insertProject(payload) {
  const main_factory_id = String(payload.main_factory_id || '').trim();
  if (!main_factory_id) throw new Error('メイン工場を選択してください');
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('物件名を入力してください');
  const sub_factory_ids = normalizeSubFactoryIds(payload.sub_factory_ids).filter((id) => id !== main_factory_id);
  const row = {
    name,
    customer_id: sanitizeRefId(payload.customer_id),
    main_factory_id,
    sub_factory_ids,
    lat: payload.lat != null && payload.lat !== '' && Number.isFinite(Number(payload.lat)) ? Number(payload.lat) : null,
    lng: payload.lng != null && payload.lng !== '' && Number.isFinite(Number(payload.lng)) ? Number(payload.lng) : null,
    trading_company_name: String(payload.trading_company_name || payload.trading_company || '').trim() || null,
    trading_company: String(payload.trading_company || payload.trading_company_name || '').trim() || null,
    contractor: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
    sub_contractor_name: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
    delivery_area: String(payload.delivery_area || '').trim() || null,
    site_address: String(payload.site_address || '').trim() || null,
    folder_url: normalizeExternalUrl(payload.folder_url) || null,
    sheet_url: normalizeExternalUrl(payload.sheet_url) || null,
    url_token: resolveUrlTokenForInsert(payload),
  };
  const { data, error } = await supabase.from('projects').insert(row).select('*').single();
  if (error) throw error;
  return mapProjectRow(data);
}

export async function updateProject(projectId, payload) {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('projectId が必要です');
  const main_factory_id = String(payload.main_factory_id || '').trim();
  if (!main_factory_id) throw new Error('メイン工場を選択してください');
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('物件名を入力してください');
  const sub_factory_ids = normalizeSubFactoryIds(payload.sub_factory_ids).filter((fid) => fid !== main_factory_id);
  const row = {
    name,
    customer_id: sanitizeRefId(payload.customer_id),
    main_factory_id,
    sub_factory_ids,
    lat: payload.lat != null && payload.lat !== '' && Number.isFinite(Number(payload.lat)) ? Number(payload.lat) : null,
    lng: payload.lng != null && payload.lng !== '' && Number.isFinite(Number(payload.lng)) ? Number(payload.lng) : null,
    trading_company_name: String(payload.trading_company_name || payload.trading_company || '').trim() || null,
    trading_company: String(payload.trading_company || payload.trading_company_name || '').trim() || null,
    contractor: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
    sub_contractor_name: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
    delivery_area: String(payload.delivery_area || '').trim() || null,
    site_address: String(payload.site_address || '').trim() || null,
    folder_url: normalizeExternalUrl(payload.folder_url) || null,
    sheet_url: normalizeExternalUrl(payload.sheet_url) || null,
  };
  const { data, error } = await supabase.from('projects').update(row).eq('id', id).select('*').single();
  if (error) throw error;
  return mapProjectRow(data);
}

function isMissingRelationOrColumnError(error) {
  const code = error?.code ? String(error.code) : '';
  const msg = error?.message ? String(error.message).toLowerCase() : '';
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache')
  );
}

async function deleteProjectDependentRows(tableName, columnName, value) {
  const v = String(value || '').trim();
  if (!tableName || !columnName || !v) return;
  const { error } = await supabase.from(tableName).delete().eq(columnName, v);
  if (error && !isMissingRelationOrColumnError(error)) throw error;
}

async function deleteProjectDependentRowsIn(tableName, columnName, values) {
  const ids = [...new Set((Array.isArray(values) ? values : []).map((x) => String(x || '').trim()).filter(Boolean))];
  if (!tableName || !columnName || ids.length === 0) return;
  const { error } = await supabase.from(tableName).delete().in(columnName, ids);
  if (error && !isMissingRelationOrColumnError(error)) throw error;
}

export async function deleteProject(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return;
  const { data: orderRows, error: orderSelectError } = await supabase.from('orders').select('id').eq('project_id', id);
  if (orderSelectError) throw orderSelectError;
  const orderIds = (orderRows || []).map((row) => row?.id).filter(Boolean);

  // Optional dependent tables may not exist in every environment. Ignore only
  // missing-table/column errors; real permission or constraint errors still fail.
  await deleteProjectDependentRows('allocations', 'project_id', id);
  await deleteProjectDependentRows('schedules', 'project_id', id);
  await deleteProjectDependentRows('chats', 'project_id', id);
  await deleteProjectDependentRows('chat_messages', 'project_id', id);
  await deleteProjectDependentRows('order_chats', 'project_id', id);

  await deleteProjectDependentRowsIn('allocations', 'order_id', orderIds);
  await deleteProjectDependentRowsIn('schedules', 'order_id', orderIds);
  await deleteProjectDependentRowsIn('chats', 'order_id', orderIds);
  await deleteProjectDependentRowsIn('chat_messages', 'order_id', orderIds);
  await deleteProjectDependentRowsIn('order_chats', 'order_id', orderIds);

  const { error: ordersDeleteError } = await supabase.from('orders').delete().eq('project_id', id);
  if (ordersDeleteError) throw ordersDeleteError;

  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function deleteProjectComplete(projectId) {
  return deleteProject(projectId);
}

function mapHolidayRow(row) {
  if (!row || typeof row !== 'object') return null;
  const d = row.holiday_date != null ? String(row.holiday_date).slice(0, 10) : '';
  return {
    id: row.id != null ? String(row.id) : '',
    holiday_date: d,
    description: row.description != null ? String(row.description) : '',
    created_at: row.created_at,
  };
}

/** 休日一覧 */
export async function fetchHolidays() {
  const { data, error } = await supabase.from('holidays').select('*').order('holiday_date', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapHolidayRow).filter(Boolean);
}

export async function insertHoliday({ holiday_date, description }) {
  const d = String(holiday_date || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('休日の日付が不正です');
  const row = {
    holiday_date: d,
    description: description != null ? String(description).trim() : null,
  };
  const { data, error } = await supabase.from('holidays').insert(row).select('*').single();
  if (error) throw error;
  return mapHolidayRow(data);
}

export async function deleteHoliday(holidayId) {
  const id = String(holidayId || '').trim();
  if (!id) return;
  const { error } = await supabase.from('holidays').delete().eq('id', id);
  if (error) throw error;
}

function mapSystemSettingsRow(row) {
  if (!row || typeof row !== 'object') {
    return { id: 1, start_time: '08:00:00', end_time: '16:00:00' };
  }
  return {
    id: row.id != null ? Number(row.id) : 1,
    start_time: row.start_time != null ? String(row.start_time) : '08:00:00',
    end_time: row.end_time != null ? String(row.end_time) : '16:00:00',
    updated_at: row.updated_at,
  };
}

/** 稼働時間設定（id=1） */
export async function fetchSystemSettings() {
  const { data, error } = await supabase.from('system_settings').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  if (!data) {
    return { id: 1, start_time: '08:00:00', end_time: '16:00:00' };
  }
  return mapSystemSettingsRow(data);
}

export async function updateSystemSettings({ start_time, end_time }) {
  const st = String(start_time || '08:00:00').trim();
  const et = String(end_time || '16:00:00').trim();
  const { data, error } = await supabase
    .from('system_settings')
    .upsert({ id: 1, start_time: st, end_time: et }, { onConflict: 'id' })
    .select('*')
    .single();
  if (error) throw error;
  return mapSystemSettingsRow(data);
}

// -----------------------------------------------------------------------------
// 地図スタンプエディタ（/map-editor/:order_id）ハイブリッド連携
// -----------------------------------------------------------------------------

const PROJECT_MAP_SELECT =
  'id, name, default_map_image_url, map_base_image_url, lat, lng, map_annotations';

function dataUrlToBlob(dataUrl) {
  const raw = String(dataUrl || '');
  const comma = raw.indexOf(',');
  const base64 = comma >= 0 ? raw.slice(comma + 1) : raw;
  const meta = comma >= 0 ? raw.slice(0, comma) : '';
  const mimeMatch = meta.match(/data:([^;]+);/);
  const mime = mimeMatch?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function getMapsStoragePublicUrl(storagePath) {
  const path = String(storagePath || '').replace(/^\//, '');
  const { data } = supabase.storage.from(MAP_STORAGE_BUCKET).getPublicUrl(path);
  return data?.publicUrl ? String(data.publicUrl) : '';
}

function pickProjectDefaultMapUrl(project) {
  if (!project) return '';
  return String(
    project.default_map_image_url ?? project.map_base_image_url ?? project.mapBaseImageUrl ?? '',
  ).trim();
}

function pickOrderOverrideMapUrl(order, orderRow) {
  const fromCol = orderRow?.override_map_image_url != null ? String(orderRow.override_map_image_url).trim() : '';
  if (fromCol) return fromCol;
  return String(order?.override_map_image_url ?? order?.map_image_url ?? order?.mapImageUrl ?? '').trim();
}

/**
 * 表示する背景地図の優先順位
 * 1. orders.override_map_image_url
 * 2. projects.default_map_image_url
 * 3. なし（白紙キャンバス）
 */
export function resolveMapDisplayUrl(order, project, orderRow) {
  const overrideUrl = normalizeExternalUrl(pickOrderOverrideMapUrl(order, orderRow));
  if (overrideUrl) {
    return { url: overrideUrl, source: 'override' };
  }
  const defaultUrl = normalizeExternalUrl(pickProjectDefaultMapUrl(project));
  if (defaultUrl) {
    return { url: defaultUrl, source: 'default' };
  }
  return { url: '', source: 'none' };
}

/** @deprecated resolveMapDisplayUrl を使用 */
export function resolveMapBaseImageUrl(order, project) {
  return resolveMapDisplayUrl(order, project, null).url;
}

function normalizeMapStamps(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const type = String(s.type || '');
      const scale = Number(s.scale);
      const lat = Number(s.lat);
      const lng = Number(s.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return {
          type,
          lat,
          lng,
          scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
        };
      }
      return {
        type,
        x: Number(s.x),
        y: Number(s.y),
        scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      };
    })
    .filter((s) => {
      if (!MAP_STAMP_TYPES.includes(s.type)) return false;
      if (Number.isFinite(s.lat) && Number.isFinite(s.lng)) return true;
      return Number.isFinite(s.x) && Number.isFinite(s.y);
    });
}

/** 地図送付済みなら地図待ちフラグは常に false */
function resolveOrderLocationPending(row, orderData) {
  const od = orderData && typeof orderData === 'object' ? orderData : {};
  const hasMap =
    Boolean(String(row?.override_map_image_url || '').trim()) ||
    Boolean(String(od.override_map_image_url ?? od.overrideMapImageUrl ?? od.map_image_url ?? '').trim()) ||
    Boolean(od.map_submitted_at ?? od.mapSubmittedAt) ||
    (od.map_annotations && typeof od.map_annotations === 'object') ||
    (row?.map_annotations && typeof row.map_annotations === 'object') ||
    (Array.isArray(od.map_stamps ?? od.mapStamps) && (od.map_stamps ?? od.mapStamps).length > 0);
  if (hasMap) return false;
  if (row?.is_location_pending === false) return false;
  if (od.is_location_pending === false || od.isLocationPending === false) return false;
  return row?.is_location_pending === true || od.is_location_pending === true || od.isLocationPending === true;
}

function applyLocationPendingClearedToOrder(order) {
  const base = order && typeof order === 'object' ? { ...order } : {};
  return {
    ...base,
    is_location_pending: false,
    isLocationPending: false,
  };
}

function pickMapEditorCenter(order, project) {
  const plat = project?.lat != null ? Number(project.lat) : NaN;
  const plng = project?.lng != null ? Number(project.lng) : NaN;
  if (Number.isFinite(plat) && Number.isFinite(plng)) {
    return { lat: plat, lng: plng, zoom: 17 };
  }
  const dlat = order?.delivery_lat != null ? Number(order.delivery_lat) : NaN;
  const dlng = order?.delivery_lng != null ? Number(order.delivery_lng) : NaN;
  if (Number.isFinite(dlat) && Number.isFinite(dlng)) {
    return { lat: dlat, lng: dlng, zoom: 17 };
  }
  return null;
}

function withImageOverlay(annotations, imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url) return annotations;
  const center = annotations?.center;
  const bounds =
    annotations?.imageOverlay?.bounds ||
    boundsFromCenter(center?.lat, center?.lng);
  if (!bounds) return annotations;
  return {
    ...annotations,
    imageOverlay: {
      url: annotations?.imageOverlay?.url || url,
      bounds,
    },
  };
}

function isMapStorageUploadError(error) {
  const msg = String(error?.message || '').toLowerCase();
  const code = error?.statusCode != null ? String(error.statusCode) : '';
  return (
    code === '404' ||
    msg.includes('bucket') ||
    msg.includes('not found') ||
    msg.includes('does not exist') ||
    msg.includes('invalid bucket')
  );
}

function formatMapStorageErrorMessage(error) {
  const raw = error?.message ? String(error.message) : '不明なエラー';
  if (isMapStorageUploadError(error)) {
    return `Storage バケット「${MAP_STORAGE_BUCKET}」が見つからないか、権限がありません。Supabase で公開バケット「${MAP_STORAGE_BUCKET}」を作成してください。`;
  }
  return `Storage（バケット「${MAP_STORAGE_BUCKET}」）への画像保存に失敗しました: ${raw}`;
}

/**
 * PNG を Supabase Storage バケット `maps` にアップロード
 * @returns {{ ok: true, publicUrl: string, storagePath: string } | { ok: false, publicUrl: '', storagePath: string, error: Error }}
 */
async function uploadMapPngToStorageOptional(storagePath, imageDataUrl) {
  const path = String(storagePath || '').replace(/^\//, '');
  if (!imageDataUrl) {
    return { ok: false, publicUrl: '', storagePath: path, error: new Error('画像データがありません') };
  }
  try {
    const blob = dataUrlToBlob(imageDataUrl);
    const { error: uploadError } = await supabase.storage.from(MAP_STORAGE_BUCKET).upload(path, blob, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: false,
    });
    if (uploadError) {
      console.error(`[Storage:${MAP_STORAGE_BUCKET}] upload failed`, uploadError);
      return { ok: false, publicUrl: '', storagePath: path, error: uploadError };
    }
    return { ok: true, publicUrl: getMapsStoragePublicUrl(path), storagePath: path, error: null };
  } catch (err) {
    console.error(`[Storage:${MAP_STORAGE_BUCKET}] upload exception`, err);
    return { ok: false, publicUrl: '', storagePath: path, error: err };
  }
}

/** 地図エディタ用: 単一注文 + 表示用背景URL（ハイブリッド優先順位） */
export async function fetchOrderForMapEditor(orderId) {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('orderId が必要です');

  let row = null;
  let projectFromRpc = null;

  const { data: rpcData, error: rpcError } = await supabase.rpc('fetch_order_for_map_editor', {
    p_order_id: id,
  });
  const rpcMissing =
    rpcError &&
    (rpcError.code === '42883' || /fetch_order_for_map_editor/i.test(String(rpcError.message || '')));
  if (!rpcError && rpcData != null) {
    const payload = typeof rpcData === 'string' ? JSON.parse(rpcData) : rpcData;
    if (payload && typeof payload === 'object' && payload.order) {
      row = payload.order;
      projectFromRpc = payload.project && typeof payload.project === 'object' ? payload.project : null;
    } else if (payload === null) {
      return null;
    }
  } else if (!rpcMissing && rpcError) {
    console.warn('[fetchOrderForMapEditor] RPC failed, falling back to direct select', rpcError);
  }

  if (!row) {
    let error;
    ({ data: row, error } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle());
    if (error && isMissingRelationOrColumnError(error)) {
      ({ data: row, error } = await supabase
        .from('orders')
        .select(
          'id, order_data, chat_messages, created_at, has_test, project_id, customer_id, ordered_by, is_spot, delivery_lat, delivery_lng, preferred_factory_id, factory_site_id, status, rejected_factory_ids, override_map_image_url, is_location_pending',
        )
        .eq('id', id)
        .maybeSingle());
    }
    if (error) {
      console.error('fetchOrderForMapEditor failed', error);
      throw error;
    }
  }
  if (!row) return null;

  const order = normalizeOrderRow(row);
  if (!order || order.status === 'deleted') return null;

  let project = projectFromRpc;
  const projectId = String(order.project_id || '').trim();
  if (projectId && !project) {
    let p;
    let pErr;
    ({ data: p, error: pErr } = await supabase.from('projects').select(PROJECT_MAP_SELECT).eq('id', projectId).maybeSingle());
    if (pErr && isMissingRelationOrColumnError(pErr)) {
      ({ data: p, error: pErr } = await supabase
        .from('projects')
        .select('id, name, default_map_image_url, map_base_image_url, lat, lng')
        .eq('id', projectId)
        .maybeSingle());
    }
    if (pErr) console.warn('[fetchOrderForMapEditor] project load failed', pErr);
    project = p;
  }

  const { url: displayImageUrl, source: mapSource } = resolveMapDisplayUrl(order, project, row);
  const legacyStamps = normalizeMapStamps(order.map_stamps ?? order.mapStamps);
  const projectCenter = pickMapEditorCenter(order, project);
  const rawAnnotations =
    row.map_annotations ?? order.map_annotations ?? order.mapAnnotations ?? order.order_data?.map_annotations;
  let mapAnnotations = normalizeMapAnnotations(rawAnnotations, {
    legacyStamps,
    projectCenter,
    imageUrl: '',
  });
  mapAnnotations = stripSavedSnapshotOverlay(mapAnnotations, displayImageUrl);
  const { annotations: viewAnnotations, flyTarget: initialFlyTarget } =
    getInitialMapViewFromAnnotations(mapAnnotations);
  mapAnnotations = viewAnnotations;
  const overrideMapImageUrl = pickOrderOverrideMapUrl(order, row);
  const defaultMapImageUrl = pickProjectDefaultMapUrl(project);

  return {
    order,
    project,
    projectId,
    displayImageUrl,
    mapSource,
    overrideMapImageUrl,
    defaultMapImageUrl,
    mapAnnotations,
    initialFlyTarget,
    existingStamps: legacyStamps,
    title:
      resolveOrderSiteDisplayName(order, project) || `注文 ${id}`,
  };
}

/**
 * プロジェクト基本マップとして保存
 * Storage: maps/projects/{project_id}_{timestamp}.png
 */
export async function saveProjectDefaultMap(projectId, imageDataUrl, mapAnnotations) {
  const pid = String(projectId || '').trim();
  if (!pid) throw new Error('projectId が必要です（物件に紐づく注文のみ基本マップを保存できます）');

  const normalized = normalizeMapAnnotations(mapAnnotations, { imageUrl: '' });
  const timestamp = Date.now();
  const storagePath = `projects/${pid}_${timestamp}.png`;
  const upload = imageDataUrl
    ? await uploadMapPngToStorageOptional(storagePath, imageDataUrl)
    : { ok: false, publicUrl: '', storagePath, error: null };

  let existingUrl = '';
  const { data: existingProject } = await supabase
    .from('projects')
    .select('default_map_image_url, map_base_image_url')
    .eq('id', pid)
    .maybeSingle();
  if (existingProject) {
    existingUrl = String(existingProject.default_map_image_url || existingProject.map_base_image_url || '').trim();
  }

  const publicUrl = upload.ok ? upload.publicUrl : existingUrl;
  const savedAnnotations = withImageOverlay({ ...normalized, center: normalized.center }, publicUrl);

  const row = { map_annotations: savedAnnotations };
  if (upload.ok && publicUrl) row.default_map_image_url = publicUrl;

  let data;
  let error;
  ({ data, error } = await supabase.from('projects').update(row).eq('id', pid).select(PROJECT_MAP_SELECT).single());
  if (error && isMissingRelationOrColumnError(error)) {
    const fallbackRow = upload.ok && publicUrl ? { default_map_image_url: publicUrl } : {};
    if (Object.keys(fallbackRow).length === 0) {
      ({ data, error } = await supabase
        .from('projects')
        .select('id, name, default_map_image_url, map_base_image_url, lat, lng')
        .eq('id', pid)
        .single());
    } else {
      ({ data, error } = await supabase
        .from('projects')
        .update(fallbackRow)
        .eq('id', pid)
        .select('id, name, default_map_image_url, map_base_image_url, lat, lng')
        .single());
    }
  }
  if (error) {
    console.error('saveProjectDefaultMap failed', error);
    throw error;
  }

  const storageWarning = upload.ok ? '' : formatMapStorageErrorMessage(upload.error);

  return {
    publicUrl: upload.ok ? publicUrl : '',
    storagePath: upload.storagePath,
    storageUploadFailed: !upload.ok,
    storageWarning,
    dbSaved: true,
    savedFully: upload.ok,
    project: data,
    map_annotations: savedAnnotations,
    map_stamps: annotationsToLegacyStamps(savedAnnotations),
  };
}

/**
 * 打設日・注文専用マップとして保存（上書き）
 * Storage: maps/orders/{order_id}_{timestamp}.png
 */
export async function saveOrderOverrideMap(orderId, imageDataUrl, mapAnnotations) {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('orderId が必要です');

  const normalized = normalizeMapAnnotations(mapAnnotations);
  const timestamp = Date.now();
  const storagePath = `orders/${id}_${timestamp}.png`;
  const upload = imageDataUrl
    ? await uploadMapPngToStorageOptional(storagePath, imageDataUrl)
    : { ok: false, publicUrl: '', storagePath, error: null };

  const { data: row, error: selErr } = await supabase.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle();
  if (selErr && !isMissingRelationOrColumnError(selErr)) throw selErr;
  const { data: rowFallback, error: selErr2 } =
    selErr && isMissingRelationOrColumnError(selErr)
      ? await supabase
          .from('orders')
          .select(
            'id, order_data, chat_messages, created_at, has_test, project_id, customer_id, ordered_by, is_spot, delivery_lat, delivery_lng, preferred_factory_id, factory_site_id, status, rejected_factory_ids, override_map_image_url, is_location_pending',
          )
          .eq('id', id)
          .maybeSingle()
      : { data: row, error: selErr };
  const orderRow = rowFallback ?? row;
  if (selErr2) throw selErr2;
  if (!orderRow) throw new Error('注文が見つかりません');

  const currentOrder = normalizeOrderRow(orderRow) || { id };
  const existingUrl = pickOrderOverrideMapUrl(currentOrder, orderRow);
  const publicUrl = upload.ok ? upload.publicUrl : existingUrl;
  const submittedAt = new Date().toISOString();
  const savedAnnotations = withImageOverlay({ ...normalized }, publicUrl || normalized?.imageOverlay?.url || '');
  const legacyStamps = annotationsToLegacyStamps(savedAnnotations);

  const nextOrderData = sanitizeOrderDataForDb(
    applyLocationPendingClearedToOrder({
      ...currentOrder,
      map_stamps: legacyStamps,
      map_annotations: savedAnnotations,
      map_submitted_at: submittedAt,
      ...(upload.ok && publicUrl ? { map_image_url: publicUrl, override_map_image_url: publicUrl } : {}),
    }),
  );

  const updateRow = {
    is_location_pending: false,
    order_data: nextOrderData,
    map_annotations: savedAnnotations,
  };
  if (upload.ok && publicUrl) updateRow.override_map_image_url = publicUrl;

  let updated;
  let upErr;
  ({ data: updated, error: upErr } = await supabase.from('orders').update(updateRow).eq('id', id).select(ORDER_SELECT).single());
  if (upErr && isMissingRelationOrColumnError(upErr)) {
    const fallbackUpdate = {
      is_location_pending: false,
      order_data: nextOrderData,
    };
    if (upload.ok && publicUrl) fallbackUpdate.override_map_image_url = publicUrl;
    ({ data: updated, error: upErr } = await supabase
      .from('orders')
      .update(fallbackUpdate)
      .eq('id', id)
      .select(
        'id, order_data, chat_messages, created_at, has_test, project_id, customer_id, ordered_by, is_spot, delivery_lat, delivery_lng, preferred_factory_id, factory_site_id, status, rejected_factory_ids, override_map_image_url, is_location_pending',
      )
      .single());
  }
  if (upErr) {
    console.error('saveOrderOverrideMap failed', upErr);
    throw upErr;
  }

  publishMapEditorOrderSaved(id);

  const storageWarning = upload.ok ? '' : formatMapStorageErrorMessage(upload.error);

  return {
    publicUrl: upload.ok ? publicUrl : '',
    storagePath: upload.storagePath,
    storageUploadFailed: !upload.ok,
    storageWarning,
    dbSaved: true,
    savedFully: upload.ok,
    locationPendingCleared: true,
    order: normalizeOrderRow(updated),
    map_annotations: savedAnnotations,
    map_stamps: legacyStamps,
  };
}

/** @deprecated saveOrderOverrideMap を使用 */
export async function uploadMapEditorResult(orderId, imageDataUrl, mapAnnotations) {
  return saveOrderOverrideMap(orderId, imageDataUrl, mapAnnotations);
}

function mapFactoryNewsRow(row) {
  if (!row || typeof row !== 'object') return null;
  const targets = Array.isArray(row.target_factory_ids)
    ? row.target_factory_ids.map((x) => String(x ?? '').trim()).filter(Boolean)
    : [];
  return {
    id: row.id != null ? String(row.id) : '',
    title: String(row.title ?? '').trim(),
    body: String(row.body ?? '').trim(),
    target_factory_ids: targets,
    created_at: row.created_at != null ? String(row.created_at) : '',
  };
}

function mapFactoryNewsReadRow(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    news_id: row.news_id != null ? String(row.news_id) : '',
    factory_id: row.factory_id != null ? String(row.factory_id) : '',
    read_at: row.read_at != null ? String(row.read_at) : '',
  };
}

/** 工場画面: 閲覧可能なニュース＋全既読ログ */
export async function fetchFactoryNewsFeed(factoryId) {
  const fid = sanitizeRefId(factoryId);
  const { data: newsRows, error: newsErr } = await supabase
    .from('factory_news')
    .select('id, title, body, target_factory_ids, created_at')
    .order('created_at', { ascending: false });
  if (newsErr) throw newsErr;

  const allNews = (newsRows || []).map(mapFactoryNewsRow).filter(Boolean);
  const visible = fid
    ? allNews.filter((n) => {
        if (!n.target_factory_ids?.length) return true;
        return n.target_factory_ids.includes(fid);
      })
    : [];

  const ids = visible.map((n) => n.id).filter(Boolean);
  let reads = [];
  if (ids.length > 0) {
    const { data: readRows, error: readErr } = await supabase
      .from('factory_news_reads')
      .select('news_id, factory_id, read_at')
      .in('news_id', ids);
    if (readErr) throw readErr;
    reads = (readRows || []).map(mapFactoryNewsReadRow).filter(Boolean);
  }

  return { news: visible, reads };
}

/** 工場: 既読登録（RPC・重複はスキップ） */
export async function markFactoryNewsRead(newsId, factoryId) {
  const id = String(newsId || '').trim();
  const fid = sanitizeRefId(factoryId);
  if (!id) return;
  if (!fid) throw new Error('工場IDが指定されていません');
  const { error } = await supabase.rpc('mark_factory_news_read', {
    p_news_id: id,
    p_factory_id: fid,
  });
  if (error) throw error;
}

/** 管理画面: ニュース配信 */
export async function publishFactoryNews({ title, body, targetFactoryIds = [] }) {
  const t = String(title ?? '').trim();
  const b = String(body ?? '').trim();
  if (!t) throw new Error('件名を入力してください');
  if (!b) throw new Error('本文を入力してください');
  const targets = [...new Set((targetFactoryIds || []).map((x) => sanitizeRefId(x)).filter(Boolean))];
  const { data, error } = await supabase
    .from('factory_news')
    .insert({
      title: t,
      body: b,
      target_factory_ids: targets,
    })
    .select('id, title, body, target_factory_ids, created_at')
    .single();
  if (error) throw error;
  return mapFactoryNewsRow(data);
}

/** 管理画面: 配信履歴＋既読一覧 */
export async function fetchFactoryNewsAdminFeed() {
  const { data: newsRows, error: newsErr } = await supabase
    .from('factory_news')
    .select('id, title, body, target_factory_ids, created_at')
    .order('created_at', { ascending: false });
  if (newsErr) throw newsErr;
  const news = (newsRows || []).map(mapFactoryNewsRow).filter(Boolean);
  const ids = news.map((n) => n.id).filter(Boolean);
  let reads = [];
  if (ids.length > 0) {
    const { data: readRows, error: readErr } = await supabase
      .from('factory_news_reads')
      .select('news_id, factory_id, read_at')
      .in('news_id', ids);
    if (readErr) throw readErr;
    reads = (readRows || []).map(mapFactoryNewsReadRow).filter(Boolean);
  }
  return { news, reads };
}
