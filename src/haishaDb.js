import { MAP_STORAGE_BUCKET, MAP_STAMP_TYPES, publishMapEditorOrderSaved } from './mapEditorConstants.js';
import {
  annotationsToLegacyStamps,
  applyInitialViewCenter,
  boundsFromCenter,
  getInitialMapViewFromAnnotations,
  normalizeMapAnnotations,
  pickCoordsFromMapAnnotations,
} from './utils/mapAnnotations.js';
import { stripSavedSnapshotOverlay } from './utils/mapEditorOverlay.js';
import { normalizeExternalUrl } from './utils/urlValidation.js';
import { supabase, ensurePanelRealtimeAuth } from './supabaseClient.js';
import { normalizeAllowedDeliveryAreas, parseSpotThresholdVolume } from './utils/deliveryAreas.js';
import { isValidSiteOrderUrlToken, resolveUrlTokenForInsert } from './utils/urlValidation.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from './utils/siteNameDisplay.js';
import { normalizeAssociationFactorySelection } from './utils/associationFactoryAssignment.js';
import { shouldResetOrderStatusOnFactoryReassign } from './utils/orderFactoryReassign.js';
import { ensureOrderPreferredFactoryForInsert } from './utils/dispatchBulkOrder.js';
import { resolveProjectTradingCompanyName } from './utils/projectTradingCompany.js';
import {
  customerFactoryRejectionChatMessage,
  customerScheduleAutoRejectChatBody,
} from './utils/customerStatusLabels.js';
import {
  DISPATCH_DEFAULT_FACTORY_SITE_ID,
  DISPATCH_DEFAULT_FACTORY_SITE_NAME,
  computeScheduleAutoRejectReason,
  getOrderMinutesForScheduleScan,
  normalizeDayBlockSchedule,
  normalizeFullSchedule,
} from './haishaConstants.js';
import {
  computeAssignedProjectRejectUpdates,
  isAssignedProject,
} from './utils/assignedProjectEscalation.js';
import { normalizeSalesStaffList } from './utils/salesStaff.js';

const ORDER_SELECT =
  'id, order_data, chat_messages, created_at, updated_at, has_test, project_id, customer_id, ordered_by, is_spot, delivery_lat, delivery_lng, preferred_factory_id, factory_site_id, status, rejected_factory_ids, override_map_image_url, is_location_pending, map_annotations, factory_consult_status, factory_consult_started_at, factory_consult_by_factory_id, accepted_at, sub_factory_current_index, sub_factory_notified_at, admin_followup_notes, admin_followup_started_at, contractor_customer_id, agent_organization_id, is_admin_modified, is_factory_modified';

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

async function enrichProjectsWithTradingCompanyOrgs(projects) {
  const list = Array.isArray(projects) ? projects.filter(Boolean) : [];
  const orgIds = [
    ...new Set(list.map((p) => p?.trading_company_organization_id).filter(Boolean)),
  ];
  if (!orgIds.length) {
    return list.map((p) => ({ ...p, trading_company_organization_name: '' }));
  }

  const { data, error } = await supabase
    .from('organizations')
    .select('id, name')
    .in('id', orgIds);
  if (error) {
    console.warn('[fetchProjects] organizations の取得に失敗しました', error);
    return list.map((p) => ({ ...p, trading_company_organization_name: '' }));
  }

  const nameById = new Map(
    (data || []).map((o) => [String(o.id), o.name != null ? String(o.name) : '']),
  );

  return list.map((p) => ({
    ...p,
    trading_company_organization_name: p.trading_company_organization_id
      ? nameById.get(String(p.trading_company_organization_id)) || ''
      : '',
  }));
}

function buildProjectTradingCompanyFields(payload) {
  const trading_company_name =
    String(payload.trading_company_name || payload.trading_company || '').trim() || null;
  const trading_company =
    String(payload.trading_company || payload.trading_company_name || '').trim() || null;
  const trading_company_organization_id = sanitizeRefId(payload.trading_company_organization_id);
  return {
    trading_company_name,
    trading_company,
    trading_company_organization_id: trading_company_organization_id || null,
  };
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

function areChatMessagesEqual(a, b) {
  const left = normalizeChatMessages(a);
  const right = normalizeChatMessages(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l.id !== r.id || l.from !== r.from || l.body !== r.body || l.createdAt !== r.createdAt) {
      return false;
    }
  }
  return true;
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
  const factorySiteId = sanitizeRefId(o.factory_site_id ?? o.factorySiteId);
  const preferredFactoryId = sanitizeRefId(o.preferred_factory_id ?? o.preferredFactoryId);
  const mainFactoryId = sanitizeRefId(o.main_factory_id ?? o.mainFactoryId);
  o.factory_site_id = factorySiteId;
  o.factorySiteId = factorySiteId;
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
  const patch = {
    has_test: Boolean(row.has_test),
    order_data: sanitizeOrderDataForDb(row.order_data),
    customer_id: sanitizeRefId(row.customer_id),
    ordered_by: row.ordered_by != null ? String(row.ordered_by).trim() || null : null,
    factory_site_id: sanitizeRefId(row.factory_site_id),
    status: row.status || 'pending',
    rejected_factory_ids: Array.isArray(row.rejected_factory_ids) ? row.rejected_factory_ids : [],
  };
  if (Object.prototype.hasOwnProperty.call(row, 'chat_messages')) {
    patch.chat_messages = row.chat_messages;
  }
  if (row.accepted_at != null && String(row.accepted_at).trim()) {
    patch.accepted_at = String(row.accepted_at).trim();
  }
  return patch;
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
  const updatedAt =
    row.updated_at != null ? String(row.updated_at) : od.updatedAt != null ? String(od.updatedAt) : '';
  const acceptedAt =
    row.accepted_at != null ? String(row.accepted_at) : od.accepted_at != null ? String(od.accepted_at) : '';
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
    updatedAt,
    updated_at: updatedAt,
    accepted_at: acceptedAt,
    acceptedAt,
    project_id: row.project_id != null ? String(row.project_id) : od.project_id ?? null,
    is_spot: row.is_spot === true || od.is_spot === true,
    customer_id: row.customer_id != null ? String(row.customer_id) : od.customer_id != null ? String(od.customer_id) : null,
    contractor_customer_id:
      row.contractor_customer_id != null
        ? String(row.contractor_customer_id)
        : od.contractor_customer_id != null
          ? String(od.contractor_customer_id)
          : null,
    agent_organization_id:
      row.agent_organization_id != null
        ? String(row.agent_organization_id)
        : od.agent_organization_id != null
          ? String(od.agent_organization_id)
          : null,
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
    ordered_by: row.ordered_by != null ? String(row.ordered_by) : od.order_placer_name != null ? String(od.order_placer_name) : od.orderPlacerName != null ? String(od.orderPlacerName) : od.ordered_by != null ? String(od.ordered_by) : '',
    orderedBy:
      od.siteContactName != null && String(od.siteContactName).trim()
        ? String(od.siteContactName).trim()
        : od.site_contact_name != null && String(od.site_contact_name).trim()
          ? String(od.site_contact_name).trim()
          : row.ordered_by != null
            ? String(row.ordered_by)
            : od.orderedBy != null
              ? String(od.orderedBy)
              : od.ordered_by != null
                ? String(od.ordered_by)
                : '',
    orderPlacerName:
      row.ordered_by != null
        ? String(row.ordered_by)
        : od.orderPlacerName != null
          ? String(od.orderPlacerName)
          : od.order_placer_name != null
            ? String(od.order_placer_name)
            : '',
    siteContactName:
      od.siteContactName != null
        ? String(od.siteContactName)
        : od.site_contact_name != null
          ? String(od.site_contact_name)
          : od.orderedBy != null && (od.orderPlacerName != null || od.order_placer_name != null || row.ordered_by != null)
            ? String(od.orderedBy)
            : '',
    delivery_lat: Number.isFinite(deliveryLat) ? deliveryLat : null,
    delivery_lng: Number.isFinite(deliveryLng) ? deliveryLng : null,
    preferred_factory_id: sanitizeRefId(
      row.preferred_factory_id ?? od.preferred_factory_id ?? od.preferredFactoryId,
    ),
    preferredFactoryId: sanitizeRefId(
      row.preferred_factory_id ?? od.preferred_factory_id ?? od.preferredFactoryId,
    ),
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
    is_factory_modified: row.is_factory_modified === true || od.is_factory_modified === true,
    // 相談ステータスは専用カラムを唯一の正とする（order_data へはフォールバックしない）
    factory_consult_status:
      row.factory_consult_status != null ? String(row.factory_consult_status).trim() : '',
    factoryConsultStatus:
      row.factory_consult_status != null ? String(row.factory_consult_status).trim() : '',
    factory_consult_started_at:
      row.factory_consult_started_at != null ? String(row.factory_consult_started_at) : '',
    factory_consult_by_factory_id: sanitizeRefId(row.factory_consult_by_factory_id),
    factoryConsultByFactoryId: sanitizeRefId(row.factory_consult_by_factory_id),
    factoryConsultByName:
      od.factoryConsultByName != null
        ? String(od.factoryConsultByName).trim()
        : od.factory_consult_by_name != null
          ? String(od.factory_consult_by_name).trim()
          : '',
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
    customer_chat_read_key:
      od.customer_chat_read_key != null
        ? String(od.customer_chat_read_key).trim()
        : od.customerChatReadKey != null
          ? String(od.customerChatReadKey).trim()
          : '',
    customerChatReadKey:
      od.customerChatReadKey != null
        ? String(od.customerChatReadKey).trim()
        : od.customer_chat_read_key != null
          ? String(od.customer_chat_read_key).trim()
          : '',
    customer_chat_read_at:
      od.customer_chat_read_at != null
        ? String(od.customer_chat_read_at)
        : od.customerChatReadAt != null
          ? String(od.customerChatReadAt)
          : '',
    customerChatReadAt:
      od.customerChatReadAt != null
        ? String(od.customerChatReadAt)
        : od.customer_chat_read_at != null
          ? String(od.customer_chat_read_at)
          : '',
    sub_factory_current_index:
      row.sub_factory_current_index != null
        ? Number(row.sub_factory_current_index)
        : od.sub_factory_current_index != null
          ? Number(od.sub_factory_current_index)
          : od.subFactoryCurrentIndex != null
            ? Number(od.subFactoryCurrentIndex)
            : -1,
    subFactoryCurrentIndex:
      row.sub_factory_current_index != null
        ? Number(row.sub_factory_current_index)
        : od.subFactoryCurrentIndex != null
          ? Number(od.subFactoryCurrentIndex)
          : od.sub_factory_current_index != null
            ? Number(od.sub_factory_current_index)
            : -1,
    sub_factory_notified_at:
      row.sub_factory_notified_at != null
        ? String(row.sub_factory_notified_at)
        : od.sub_factory_notified_at != null
          ? String(od.sub_factory_notified_at)
          : '',
    subFactoryNotifiedAt:
      row.sub_factory_notified_at != null
        ? String(row.sub_factory_notified_at)
        : od.subFactoryNotifiedAt != null
          ? String(od.subFactoryNotifiedAt)
          : '',
    admin_followup_notes: Array.isArray(row.admin_followup_notes)
      ? row.admin_followup_notes
      : Array.isArray(od.admin_followup_notes)
        ? od.admin_followup_notes
        : Array.isArray(od.adminFollowupNotes)
          ? od.adminFollowupNotes
          : [],
    adminFollowupNotes: Array.isArray(row.admin_followup_notes)
      ? row.admin_followup_notes
      : Array.isArray(od.adminFollowupNotes)
        ? od.adminFollowupNotes
        : Array.isArray(od.admin_followup_notes)
          ? od.admin_followup_notes
          : [],
    admin_followup_started_at:
      row.admin_followup_started_at != null
        ? String(row.admin_followup_started_at)
        : od.admin_followup_started_at != null
          ? String(od.admin_followup_started_at)
          : '',
    adminFollowupStartedAt:
      row.admin_followup_started_at != null
        ? String(row.admin_followup_started_at)
        : od.adminFollowupStartedAt != null
          ? String(od.adminFollowupStartedAt)
          : '',
  };
}

/** カスタマーがチャットを開いた際の既読キー（order_data に保存） */
export async function markCustomerChatRead(orderId, readKey) {
  const id = String(orderId || '').trim();
  const key = String(readKey || '').trim();
  if (!id || !key) return null;
  const readAt = new Date().toISOString();
  return updateOrderDetails(id, {
    customer_chat_read_key: key,
    customerChatReadKey: key,
    customer_chat_read_at: readAt,
    customerChatReadAt: readAt,
  });
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
        resolveProjectTradingCompanyName(p),
      projectTradingCompanyName:
        o.projectTradingCompanyName ||
        o.trading_company_name ||
        resolveProjectTradingCompanyName(p),
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
    const orderPlacerName = String(
      o.order_placer_name ??
        o.orderPlacerName ??
        o.ordered_by ??
        safeOrder.order_placer_name ??
        safeOrder.orderPlacerName ??
        safeOrder.ordered_by ??
        '',
    ).trim();
    const siteContactName = String(
      o.site_contact_name ??
        o.siteContactName ??
        o.orderedBy ??
        safeOrder.site_contact_name ??
        safeOrder.siteContactName ??
        safeOrder.orderedBy ??
        '',
    ).trim();
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
    const acceptedAt = String(o.accepted_at ?? o.acceptedAt ?? '').trim();
    const row = {
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
        ordered_by: orderPlacerName,
        orderedBy: siteContactName,
        order_placer_name: orderPlacerName,
        orderPlacerName,
        site_contact_name: siteContactName,
        siteContactName,
        rejected_factory_ids: rejectedFactoryIds,
        factory_site_id: factorySiteId,
        factorySiteId: factorySiteId,
        preferred_factory_id: preferredFactoryId,
        preferredFactoryId: preferredFactoryId,
        main_factory_id: mainFactoryId,
        mainFactoryId: mainFactoryId,
      }),
      customer_id: customerId,
      ordered_by: orderPlacerName || null,
      factory_site_id: factorySiteId,
      status: status || 'pending',
      rejected_factory_ids: rejectedFactoryIds,
      ...(acceptedAt ? { accepted_at: acceptedAt } : {}),
    };
    if (!existingById.has(id) || !areChatMessagesEqual(msgs, existingById.get(id))) {
      row.chat_messages = msgs;
    }
    return row;
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
  const orderPlacerName = String(
    order.order_placer_name ?? order.orderPlacerName ?? order.ordered_by ?? '',
  ).trim();
  const siteContactName = String(
    order.site_contact_name ?? order.siteContactName ?? order.orderedBy ?? '',
  ).trim();
  const isLocationPending = Boolean(order.is_location_pending ?? order.isLocationPending);
  const deliveryLat = isSpot ? parseDeliveryCoord(order.delivery_lat ?? order.deliveryLat) : null;
  const deliveryLng = isSpot ? parseDeliveryCoord(order.delivery_lng ?? order.deliveryLng) : null;
  const safeOrder = sanitizeOrderRefs(order);
  let preferredFactoryId = sanitizeRefId(safeOrder.preferred_factory_id);
  const mainFactoryId = sanitizeRefId(safeOrder.main_factory_id ?? safeOrder.mainFactoryId);
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
    ordered_by: orderPlacerName,
    orderedBy: siteContactName,
    order_placer_name: orderPlacerName,
    orderPlacerName,
    site_contact_name: siteContactName,
    siteContactName,
    factory_site_id: null,
    factorySiteId: null,
    preferred_factory_id: preferredFactoryId,
    preferredFactoryId: preferredFactoryId,
    main_factory_id: mainFactoryId,
    mainFactoryId: mainFactoryId,
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
    ordered_by: orderPlacerName || null,
    is_spot: isSpot,
    project_id: projectId || null,
    delivery_lat: deliveryLat,
    delivery_lng: deliveryLng,
    preferred_factory_id: sanitizeRefId(preferredFactoryId),
    factory_site_id: null,
    status: statusRaw,
    is_location_pending: isLocationPending,
    rejected_factory_ids: [],
    contractor_customer_id: sanitizeRefId(order.contractor_customer_id) || null,
    agent_organization_id: sanitizeRefId(order.agent_organization_id) || null,
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
export async function insertOrdersBulk(orders, { factories = [], projects = [] } = {}) {
  const list = Array.isArray(orders) ? orders.filter((o) => o && typeof o === 'object') : [];
  if (list.length === 0) throw new Error('登録する注文がありません');

  const rows = list
    .map((order) => ensureOrderPreferredFactoryForInsert(order, { factories, projects }))
    .map((order) => buildOrderInsertRow(order));
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
  const orderPlacerName = String(
    nextOrder.order_placer_name ?? nextOrder.orderPlacerName ?? nextOrder.ordered_by ?? '',
  ).trim();
  const siteContactName = String(
    nextOrder.site_contact_name ?? nextOrder.siteContactName ?? nextOrder.orderedBy ?? '',
  ).trim();
  const mergedOrderData = {
    ...nextOrder,
    ordered_by: orderPlacerName,
    orderedBy: siteContactName,
    order_placer_name: orderPlacerName,
    orderPlacerName,
    site_contact_name: siteContactName,
    siteContactName,
  };
  const updateRow = {
    order_data: mergedOrderData,
    has_test: hasTest,
    customer_id: customerId,
    ordered_by: orderPlacerName || null,
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
  if (
    Object.prototype.hasOwnProperty.call(patch, 'factory_consult_status') ||
    Object.prototype.hasOwnProperty.call(patch, 'factoryConsultStatus')
  ) {
    const consultStatus = String(patch.factory_consult_status ?? patch.factoryConsultStatus ?? '').trim();
    updateRow.factory_consult_status = consultStatus || null;
    updateRow.factory_consult_started_at =
      patch.factory_consult_started_at ?? patch.factoryConsultStartedAt ?? (consultStatus ? new Date().toISOString() : null);
    updateRow.factory_consult_by_factory_id = sanitizeRefId(
      patch.factory_consult_by_factory_id ?? patch.factoryConsultByFactoryId,
    ) || null;
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'accepted_at') ||
    Object.prototype.hasOwnProperty.call(patch, 'acceptedAt')
  ) {
    const at = String(patch.accepted_at ?? patch.acceptedAt ?? '').trim();
    updateRow.accepted_at = at || null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sub_factory_current_index') ||
      Object.prototype.hasOwnProperty.call(patch, 'subFactoryCurrentIndex')) {
    const raw = patch.sub_factory_current_index ?? patch.subFactoryCurrentIndex;
    updateRow.sub_factory_current_index = raw == null || raw === '' ? null : Number(raw);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'sub_factory_notified_at') ||
      Object.prototype.hasOwnProperty.call(patch, 'subFactoryNotifiedAt')) {
    const at = String(patch.sub_factory_notified_at ?? patch.subFactoryNotifiedAt ?? '').trim();
    updateRow.sub_factory_notified_at = at || null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'admin_followup_notes') ||
      Object.prototype.hasOwnProperty.call(patch, 'adminFollowupNotes')) {
    const notes = patch.admin_followup_notes ?? patch.adminFollowupNotes;
    updateRow.admin_followup_notes = Array.isArray(notes) ? notes : [];
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'admin_followup_started_at') ||
      Object.prototype.hasOwnProperty.call(patch, 'adminFollowupStartedAt')) {
    const at = String(patch.admin_followup_started_at ?? patch.adminFollowupStartedAt ?? '').trim();
    updateRow.admin_followup_started_at = at || null;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'chat_messages') || Object.prototype.hasOwnProperty.call(patch, 'chatMessages')) {
    updateRow.chat_messages = normalizeChatMessages(patch.chat_messages ?? patch.chatMessages);
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'is_admin_modified') ||
    Object.prototype.hasOwnProperty.call(patch, 'isAdminModified')
  ) {
    updateRow.is_admin_modified = Boolean(patch.is_admin_modified ?? patch.isAdminModified);
  }
  if (
    Object.prototype.hasOwnProperty.call(patch, 'is_factory_modified') ||
    Object.prototype.hasOwnProperty.call(patch, 'isFactoryModified')
  ) {
    updateRow.is_factory_modified = Boolean(patch.is_factory_modified ?? patch.isFactoryModified);
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
    factory_consult_status: '',
  });
}

export async function acceptOrderForFactory(order, factorySiteId, factorySiteName) {
  if (!order?.id) throw new Error('order.id が必要です');
  const id = String(order.id);
  const fid = sanitizeRefId(factorySiteId);
  if (!fid) throw new Error('factorySiteId が必要です');
  const fname = String(factorySiteName || '').trim();
  const hasTest = Boolean(order.has_test);
  const acceptedAt = new Date().toISOString();
  const qRaw = order.quantityM3 ?? order.quantityCube;
  const nextOrder = {
    ...order,
    id,
    has_test: hasTest,
    status: 'accepted',
    accepted_at: acceptedAt,
    acceptedAt,
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
    factory_consult_status: '',
    factoryConsultStatus: '',
    factory_consult_started_at: '',
    factory_consult_by_factory_id: '',
    factoryConsultByFactoryId: '',
  };
  const { error } = await supabase
    .from('orders')
    .update({
      factory_site_id: fid,
      status: 'accepted',
      has_test: hasTest,
      order_data: nextOrder,
      factory_consult_status: null,
      factory_consult_started_at: null,
      factory_consult_by_factory_id: null,
      accepted_at: acceptedAt,
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

export async function rejectOrderForFactory(orderId, factoryId, options = {}) {
  const id = String(orderId || '').trim();
  const fid = sanitizeRefId(factoryId);
  if (!id) throw new Error('orderId が必要です');
  if (!fid) throw new Error('factoryId が必要です');

  const factoryName = String(options?.factoryName ?? options?.factory_name ?? '').trim();
  const appendCustomerChat = options?.appendCustomerChat !== false;

  const { data: row, error: selErr } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (selErr) {
    console.error('rejectOrderForFactory select failed', selErr);
    throw selErr;
  }
  if (!row) throw new Error('注文が見つかりません');

  const currentOrder = normalizeOrderRow(row) || { id };
  const current = Array.isArray(row.rejected_factory_ids)
    ? row.rejected_factory_ids.map((x) => String(x)).filter(Boolean)
    : [];
  if (current.includes(fid)) return current;

  const nextIds = [...new Set([...current, fid])];
  const od =
    row.order_data && typeof row.order_data === 'object' && !Array.isArray(row.order_data)
      ? row.order_data
      : {};
  const nextOrderData = { ...od, rejected_factory_ids: nextIds };

  let chatMessages = normalizeChatMessages(row.chat_messages);
  if (appendCustomerChat) {
    const name =
      factoryName ||
      String(od.factorySiteName ?? od.factory_site_name ?? od.acceptedFactoryLabel ?? '').trim() ||
      '工場';
    chatMessages = [
      ...chatMessages,
      {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        from: 'system',
        body: customerFactoryRejectionChatMessage(name),
        createdAt: new Date().toISOString(),
      },
    ].slice(-100);
  }

  const updatePayload = {
    rejected_factory_ids: nextIds,
    order_data: nextOrderData,
    chat_messages: chatMessages,
    factory_consult_status: null,
    factory_consult_started_at: null,
    factory_consult_by_factory_id: null,
  };

  const projectId = String(currentOrder.project_id ?? currentOrder.projectId ?? row.project_id ?? '').trim();
  if (projectId) {
    const project = await fetchProjectById(projectId);
    if (project && isAssignedProject(currentOrder, project)) {
      const assignedPatch = computeAssignedProjectRejectUpdates(currentOrder, project, fid);
      if (assignedPatch) {
        Object.assign(updatePayload, assignedPatch);
        if (assignedPatch.status) {
          nextOrderData.status = assignedPatch.status;
          updatePayload.order_data = nextOrderData;
        }
        if (assignedPatch.sub_factory_current_index != null) {
          nextOrderData.sub_factory_current_index = assignedPatch.sub_factory_current_index;
          nextOrderData.subFactoryCurrentIndex = assignedPatch.sub_factory_current_index;
          updatePayload.order_data = nextOrderData;
        }
        if (assignedPatch.sub_factory_notified_at) {
          nextOrderData.sub_factory_notified_at = assignedPatch.sub_factory_notified_at;
          nextOrderData.subFactoryNotifiedAt = assignedPatch.sub_factory_notified_at;
          updatePayload.order_data = nextOrderData;
        }
        if (assignedPatch.admin_followup_started_at) {
          nextOrderData.admin_followup_started_at = assignedPatch.admin_followup_started_at;
          nextOrderData.adminFollowupStartedAt = assignedPatch.admin_followup_started_at;
          updatePayload.order_data = nextOrderData;
        }
      }
    }
  }

  const { error: upErr } = await supabase.from('orders').update(updatePayload).eq('id', id);
  if (upErr) {
    console.error('rejectOrderForFactory update failed', upErr);
    throw upErr;
  }
  return nextIds;
}

async function fetchProjectById(projectId) {
  const id = String(projectId || '').trim();
  if (!id) return null;
  const { data, error } = await supabase
    .from('projects')
    .select('id, main_factory_id, sub_factory_ids, sales_admin_id, sales_admin_name')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('fetchProjectById failed', error);
    throw error;
  }
  return data ? mapProjectRow(data) : null;
}

export async function appendAdminFollowupNote(orderId, { type, content, adminId, adminName }) {
  const id = String(orderId || '').trim();
  const noteType = String(type || 'other').trim() || 'other';
  const body = String(content || '').trim();
  if (!id) throw new Error('orderId が必要です');
  if (!body) throw new Error('内容を入力してください');

  const { data: row, error: selErr } = await supabase
    .from('orders')
    .select('admin_followup_notes')
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!row) throw new Error('注文が見つかりません');

  const current = Array.isArray(row.admin_followup_notes) ? row.admin_followup_notes : [];
  const entry = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    type: ['email', 'phone', 'meeting', 'other'].includes(noteType) ? noteType : 'other',
    timestamp: new Date().toISOString(),
    admin_id: String(adminId || '').trim() || 'admin_1',
    admin_name: String(adminName || '').trim() || '管理者',
    content: body,
  };
  const nextNotes = [...current, entry].slice(-200);

  return updateOrderDetails(id, {
    admin_followup_notes: nextNotes,
    adminFollowupNotes: nextNotes,
  });
}

/** 要フォロー注文: 管理者が工場を手動指定して配車待ちへ戻す */
export async function adminAssignFactoryFromFollowup(orderId, factorySiteId, options = {}) {
  const id = String(orderId || '').trim();
  const fid = sanitizeRefId(factorySiteId);
  if (!id) throw new Error('orderId が必要です');
  if (!fid) throw new Error('factorySiteId が必要です');

  const factoryName = String(options?.factoryName ?? options?.factory_name ?? '').trim() || '指定工場';
  const adminName = String(options?.adminName ?? options?.admin_name ?? '').trim() || '管理者';

  const { data: row, error: selErr } = await supabase
    .from('orders')
    .select(ORDER_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (selErr) throw selErr;
  if (!row) throw new Error('注文が見つかりません');

  const chatMessages = [
    ...normalizeChatMessages(row.chat_messages),
    {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      from: 'system',
      body: `【管理者対応】${factoryName}での対応で進めます`,
      createdAt: new Date().toISOString(),
    },
  ].slice(-100);

  return adminUpdateOrder(id, {
    status: 'pending',
    factory_site_id: fid,
    factorySiteId: fid,
    preferred_factory_id: fid,
    preferredFactoryId: fid,
    factoryResponseStatus: undefined,
    factoryResponseLocked: false,
    factoryPendingStartedAt: undefined,
    factoryPendingByName: undefined,
    factoryRejectSource: undefined,
    sub_factory_current_index: null,
    subFactoryCurrentIndex: null,
    sub_factory_notified_at: null,
    subFactoryNotifiedAt: null,
    chat_messages: chatMessages,
    chatMessages,
    admin_assign_factory_name: factoryName,
    adminAssignFactoryName: factoryName,
    admin_assign_by_name: adminName,
    adminAssignByName: adminName,
  });
}

/** 工場「相談」開始: 時間制限なしの交渉中ステートにする（相談中の工場のみ操作可能） */
export async function startFactoryConsult(order, factorySiteId, factorySiteName) {
  if (!order?.id) throw new Error('order.id が必要です');
  const id = String(order.id);
  const fid = sanitizeRefId(factorySiteId);
  if (!fid) throw new Error('factorySiteId が必要です');
  const fname = String(factorySiteName || '').trim();

  const { data: row, error: selErr } = await supabase
    .from('orders')
    .select('order_data')
    .eq('id', id)
    .maybeSingle();
  if (selErr) {
    console.error('startFactoryConsult select failed', selErr);
    throw selErr;
  }
  if (!row) throw new Error('注文が見つかりません');

  const od =
    row.order_data && typeof row.order_data === 'object' && !Array.isArray(row.order_data)
      ? row.order_data
      : {};
  const startedAt = new Date().toISOString();
  const nextOrderData = {
    ...od,
    factoryConsultByName: fname || od.factoryConsultByName || '',
  };

  const { data: updated, error: upErr } = await supabase
    .from('orders')
    .update({
      factory_consult_status: 'consulting',
      factory_consult_started_at: startedAt,
      factory_consult_by_factory_id: fid,
      order_data: nextOrderData,
    })
    .eq('id', id)
    .eq('status', 'pending')
    .select(ORDER_SELECT)
    .single();
  if (upErr) {
    console.error('startFactoryConsult update failed', upErr);
    throw upErr;
  }
  return normalizeOrderRow(updated);
}

/** 工場「相談」を強制解除（マスター/管理者用）。エスカレーション再開。 */
export async function clearFactoryConsult(orderId) {
  const id = String(orderId || '').trim();
  if (!id) throw new Error('orderId が必要です');
  const { data: updated, error: upErr } = await supabase
    .from('orders')
    .update({
      factory_consult_status: null,
      factory_consult_started_at: null,
      factory_consult_by_factory_id: null,
    })
    .eq('id', id)
    .select(ORDER_SELECT)
    .single();
  if (upErr) {
    console.error('clearFactoryConsult update failed', upErr);
    throw upErr;
  }
  return normalizeOrderRow(updated);
}

function normalizeChatMessageSender(from) {
  const f = String(from || '').trim().toLowerCase();
  if (f === 'factory') return 'factory';
  if (f === 'system') return 'system';
  if (f === 'admin') return 'admin';
  if (f === 'customer') return 'customer';
  return 'master';
}

export function buildChatMessageEntry(from, body) {
  const text = String(body || '').trim();
  if (!text) return null;
  return {
    id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    from: normalizeChatMessageSender(from),
    body: text,
    createdAt: new Date().toISOString(),
  };
}

function chatMessagesToJsonbArray(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      id: m.id != null ? String(m.id) : `msg_${Date.now()}`,
      from: normalizeChatMessageSender(m.from),
      body: String(m.body ?? ''),
      createdAt: m.createdAt != null ? String(m.createdAt) : new Date().toISOString(),
    }));
}

export function logChatSendError(error, context = {}) {
  console.error(
    'チャット送信エラー詳細:',
    error?.message,
    error?.details,
    error?.hint,
    { code: error?.code, ...context },
  );
}

export function formatChatAppendError(err, fallback = '送信に失敗しました') {
  const msg = err?.message ? String(err.message) : '';
  const details = err?.details ? ` (${String(err.details)})` : '';
  if (msg) return `${fallback}: ${msg}${details}`;
  return fallback;
}

export async function appendChatMessage(orderId, from, body) {
  const id = String(orderId || '').trim();
  const entry = buildChatMessageEntry(from, body);
  if (!id || !entry) return null;

  const { data: rpcData, error: rpcErr } = await supabase.rpc('append_order_chat_message', {
    p_order_id: id,
    p_from: entry.from,
    p_body: entry.body,
  });

  if (!rpcErr) {
    return normalizeChatMessages(rpcData);
  }

  const rpcMissing =
    rpcErr.code === 'PGRST202' ||
    rpcErr.code === '42883' ||
    Number(rpcErr.status) === 404 ||
    String(rpcErr.message || '').toLowerCase().includes('not found') ||
    String(rpcErr.message || '').includes('append_order_chat_message') ||
    String(rpcErr.details || '').includes('append_order_chat_message');

  if (!rpcMissing) {
    logChatSendError(rpcErr, { orderId: id, via: 'rpc' });
    throw rpcErr;
  }

  const { data: row, error: selErr } = await supabase
    .from('orders')
    .select('chat_messages')
    .eq('id', id)
    .maybeSingle();
  if (selErr) {
    logChatSendError(selErr, { orderId: id, via: 'select' });
    throw selErr;
  }
  if (!row) {
    const notFound = new Error('注文が見つからないか、参照権限がありません');
    notFound.code = 'ORDER_NOT_FOUND';
    logChatSendError(notFound, { orderId: id, via: 'select' });
    throw notFound;
  }

  const list = normalizeChatMessages(row?.chat_messages);
  list.push(entry);
  const next = chatMessagesToJsonbArray(list.slice(-100));

  const { data: updated, error: upErr } = await supabase
    .from('orders')
    .update({ chat_messages: next })
    .eq('id', id)
    .select('id, chat_messages')
    .maybeSingle();

  if (upErr) {
    logChatSendError(upErr, { orderId: id, via: 'update', payloadKeys: ['chat_messages'] });
    throw upErr;
  }
  if (!updated?.id) {
    const denied = new Error('チャットの更新が拒否されました（権限またはRLSを確認してください）');
    denied.code = 'CHAT_UPDATE_DENIED';
    logChatSendError(denied, { orderId: id, via: 'update' });
    throw denied;
  }

  return normalizeChatMessages(updated.chat_messages);
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

/** 満車自動拒否の判定に使う工場 ID（閲覧中工場へのフォールバックはしない） */
export function resolveScheduleCheckFactoryId(order) {
  if (!order || typeof order !== 'object') return null;
  return (
    sanitizeRefId(order.factory_site_id ?? order.factorySiteId) ||
    sanitizeRefId(order.preferred_factory_id ?? order.preferredFactoryId) ||
    sanitizeRefId(order.main_factory_id ?? order.mainFactoryId) ||
    null
  );
}

/**
 * 満車スケジュールに基づく自動拒否を orders に反映（マスター・工場どちらからでも呼べる）
 * @param {Record<string, ReturnType<typeof normalizeFullSchedule>>} schedulesByFactoryId - 工場 id → 日付別スケジュール
 * @param {Record<string, string>} [factoryNameById] - 工場 id → 表示名（省略時は注文の factorySiteName / デフォルト）
 */
function scheduleAutoRejectedFactoryIds(order) {
  const raw =
    order?.schedule_auto_rejected_factory_ids ?? order?.scheduleAutoRejectedFactoryIds ?? [];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x).trim()).filter(Boolean))];
}

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
  const changedOrderIds = new Set();
  const nextThreads = { ...chatThreads };
  const next = orders.map((o) => {
    if (!o || !o.id) return o;
    if (o.factoryResponseStatus || o.scheduleAutoChecked) return o;

    const date = o.scheduleMatchDate || o.preferredDate;
    const fid = resolveScheduleCheckFactoryId(o);

    if (!date || typeof date !== 'string') {
      changed = true;
      changedOrderIds.add(o.id);
      return { ...o, scheduleAutoChecked: true };
    }
    if (!fid) {
      changed = true;
      changedOrderIds.add(o.id);
      return { ...o, scheduleAutoChecked: true };
    }

    const scheduleMap = normalizeFullSchedule(byF[fid] || {});
    const dayBlocks = normalizeDayBlockSchedule(scheduleMap[date]);
    const reason = computeScheduleAutoRejectReason(o, dayBlocks);

    if (!reason) {
      changed = true;
      changedOrderIds.add(o.id);
      return { ...o, scheduleAutoChecked: true };
    }

    changed = true;
    changedOrderIds.add(o.id);
    const currentRejected = Array.isArray(o.rejected_factory_ids)
      ? o.rejected_factory_ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const id = o.id;
    const resolvedName =
      (o.factorySiteName && String(o.factorySiteName).trim()) ||
      (fid && factoryNameById[fid]) ||
      defaultFactorySiteName;
    const body = customerScheduleAutoRejectChatBody(reason, resolvedName);
    const list = Array.isArray(nextThreads[id]) ? [...nextThreads[id]] : [];
    list.push({
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      from: 'system',
      body,
      createdAt: new Date().toISOString(),
    });
    nextThreads[id] = list.slice(-100);

    const nextRejected = [...new Set([...currentRejected, fid])];
    const nextScheduleAuto = [...new Set([...scheduleAutoRejectedFactoryIds(o), fid])];
    const orderStatus = String(o.status || 'pending').trim() || 'pending';

    return {
      ...o,
      status: orderStatus === 'accepted' ? orderStatus : 'pending',
      rejected_factory_ids: nextRejected,
      schedule_auto_rejected_factory_ids: nextScheduleAuto,
      scheduleAutoRejectedFactoryIds: nextScheduleAuto,
      scheduleAutoChecked: true,
      factoryRejectSource: 'schedule_auto',
      factorySiteName: resolvedName || o.factorySiteName || defaultFactorySiteName,
      factorySiteId: orderStatus === 'accepted' ? (o.factorySiteId ?? o.factory_site_id) : null,
      factory_site_id: orderStatus === 'accepted' ? (o.factory_site_id ?? o.factorySiteId) : null,
      factoryResponseStatus: orderStatus === 'accepted' ? o.factoryResponseStatus : null,
      factoryResponseLocked: orderStatus === 'accepted' ? o.factoryResponseLocked : null,
      acceptedFactoryLabel: orderStatus === 'accepted' ? o.acceptedFactoryLabel : undefined,
      factoryPendingStartedAt: undefined,
      factoryPendingByName: undefined,
      factoryUnlockRequested: false,
    };
  });
  if (!changed) return { changed: false, orders, chatThreads };

  const changedOrders = next.filter((o) => o && changedOrderIds.has(o.id));
  const changedThreads = {};
  for (const id of changedOrderIds) {
    if (nextThreads[id]) changedThreads[id] = nextThreads[id];
  }

  if (changedOrders.length > 0) {
    await upsertOrdersBatch(changedOrders, changedThreads);
  }
  return { changed: true, orders: next, chatThreads: nextThreads };
}

function enrichRealtimePayload(payload, tableName) {
  if (!payload || typeof payload !== 'object') return payload;
  const table = payload.table != null ? String(payload.table).trim() : '';
  if (table) return payload;
  return { ...payload, table: tableName };
}

function createIsolatedRealtimeHandler(onEvent) {
  const dispatch = typeof onEvent === 'function' ? onEvent : () => {};
  return (payload, tableName) => {
    try {
      dispatch(enrichRealtimePayload(payload, tableName));
    } catch (err) {
      console.error(`[realtime] handler error (${tableName})`, err);
    }
  };
}

/** 工場・カスタマー画面向け: orders / schedules のみ（軽量購読） */
export async function subscribeOrdersRealtime(onEvent, options = {}) {
  const route = createIsolatedRealtimeHandler(onEvent);
  const skipAuth = Boolean(options?.skipAuth);
  if (!skipAuth) {
    try {
      await ensurePanelRealtimeAuth?.();
    } catch (e) {
      console.warn('[subscribeOrdersRealtime] panel auth skipped', e);
    }
  }
  if (!supabase?.channel) {
    return () => {};
  }
  const channelName = `haisha-orders-rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => route(payload, 'orders'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, (payload) => route(payload, 'schedules'))
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[subscribeOrdersRealtime] channel error', status, err);
      }
    });
  return () => {
    try {
      void supabase?.removeChannel?.(channel);
    } catch {
      /* ignore */
    }
  };
}

export async function subscribeHaishaRealtime(onEvent) {
  const route = createIsolatedRealtimeHandler(onEvent);
  try {
    await ensurePanelRealtimeAuth?.();
  } catch (e) {
    console.warn('[subscribeHaishaRealtime] panel auth skipped', e);
  }
  if (!supabase?.channel) {
    return () => {};
  }
  const channelName = `haisha-realtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => route(payload, 'orders'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, (payload) => route(payload, 'schedules'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factories' }, (payload) => route(payload, 'factories'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, (payload) => route(payload, 'customers'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trading_companies' }, (payload) =>
      route(payload, 'trading_companies'),
    )
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_settings' }, (payload) => route(payload, 'admin_settings'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factory_news' }, (payload) => route(payload, 'factory_news'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factory_news_reads' }, (payload) =>
      route(payload, 'factory_news_reads'),
    )
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error('[subscribeHaishaRealtime] channel error', status, err);
      }
    });
  return () => {
    try {
      void supabase?.removeChannel?.(channel);
    } catch {
      /* ignore */
    }
  };
}

/** 管理画面専用: factory_escalation_steps の Realtime（旧 factory_escalation_settings は使用しない） */
export async function subscribeEscalationStepsRealtime(onEvent) {
  const handler = typeof onEvent === 'function' ? onEvent : () => {};
  try {
    await ensurePanelRealtimeAuth?.();
  } catch (e) {
    console.warn('[subscribeEscalationStepsRealtime] panel auth skipped', e);
  }
  if (!supabase?.channel) {
    return () => {};
  }
  const channelName = `haisha-escalation-steps-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'factory_escalation_steps' },
      handler,
    )
    .subscribe();
  return () => {
    try {
      void supabase?.removeChannel?.(channel);
    } catch {
      /* ignore */
    }
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
    trading_company_organization_id:
      row.trading_company_organization_id != null
        ? String(row.trading_company_organization_id)
        : null,
    trading_company_organization_name: '',
    contractor: row.contractor != null ? String(row.contractor) : '',
    sub_contractor_name:
      row.sub_contractor_name != null
        ? String(row.sub_contractor_name)
        : row.contractor != null
          ? String(row.contractor)
          : '',
    contractor_display_name:
      row.contractor_display_name != null ? String(row.contractor_display_name) : '',
    delivery_area: row.delivery_area != null ? String(row.delivery_area) : '',
    site_address: row.site_address != null ? String(row.site_address) : '',
    url_token:
      row.url_token != null && isValidSiteOrderUrlToken(String(row.url_token))
        ? String(row.url_token).trim()
        : '',
    folder_url: normalizeExternalUrl(row.folder_url),
    sheet_url: normalizeExternalUrl(row.sheet_url),
    default_map_image_url: String(
      row.default_map_image_url ?? row.map_base_image_url ?? row.mapBaseImageUrl ?? '',
    ).trim(),
    sales_admin_id: row.sales_admin_id != null ? String(row.sales_admin_id).trim() : '',
    sales_admin_name: row.sales_admin_name != null ? String(row.sales_admin_name).trim() : '',
    map_annotations: row.map_annotations && typeof row.map_annotations === 'object' ? row.map_annotations : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapOrganizationRow(row) {
  if (!row || typeof row !== 'object') return null;
  const name = String(row.name ?? '').trim();
  if (!name) return null;
  return {
    id: row.id != null ? String(row.id) : '',
    name,
    type: String(row.type ?? ''),
    cooperative_id: row.cooperative_id != null ? String(row.cooperative_id) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchOrganizations() {
  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .order('type', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapOrganizationRow).filter(Boolean);
}

export async function insertOrganization({ name, type, cooperative_id }) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('組織名を入力してください');
  if (!['agent', 'cooperative', 'contractor'].includes(type)) throw new Error('種別が不正です');
  const { data, error } = await supabase
    .from('organizations')
    .insert({
      name: trimmed,
      type,
      cooperative_id: cooperative_id || null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return mapOrganizationRow(data);
}

export async function updateOrganization(id, nameOrOpts) {
  if (nameOrOpts != null && typeof nameOrOpts === 'object') {
    const orgId = sanitizeRefId(id);
    if (!orgId) throw new Error('組織IDが必要です');
    const { name, type, cooperative_id } = nameOrOpts;
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw new Error('組織名を入力してください');
    if (!['agent', 'cooperative', 'contractor'].includes(type)) throw new Error('種別が不正です');
    const { data, error } = await supabase
      .from('organizations')
      .update({
        name: trimmed,
        type,
        cooperative_id: cooperative_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return mapOrganizationRow(data);
  }

  const orgId = sanitizeRefId(id);
  if (!orgId) throw new Error('組織IDが必要です');
  const { error } = await supabase
    .from('organizations')
    .update({ name: String(nameOrOpts ?? '').trim(), updated_at: new Date().toISOString() })
    .eq('id', orgId);
  if (error) throw error;
}

export async function deleteOrganization(id) {
  const orgId = sanitizeRefId(id);
  if (!orgId) throw new Error('組織IDが必要です');
  const { error } = await supabase.from('organizations').delete().eq('id', orgId);
  if (error) throw error;
}

/**
 * 組織と所属担当者を一括削除
 * @param {string} orgId
 */
export async function deleteOrganizationWithMembers(orgId) {
  // 担当者を先に削除（FK制約回避）
  const { error: ce } = await supabase
    .from('customers')
    .delete()
    .eq('organization_id', orgId);
  if (ce) throw ce;

  const { error: oe } = await supabase
    .from('organizations')
    .delete()
    .eq('id', orgId);
  if (oe) throw oe;
}

/**
 * 組織一覧を担当者付きで取得
 * @param {'agent'|'cooperative'|'contractor'} type
 * @returns Array<{
 *   id, name, type, created_at,
 *   members: Array<{id, company_name, furigana, manager_name, phone_number, login_password}>
 * }>
 */
export async function fetchOrganizationsWithMembers(type) {
  const { data: orgs, error: oe } = await supabase
    .from('organizations')
    .select('id, name, type, created_at')
    .eq('type', type)
    .order('name');
  if (oe) throw oe;

  const orgIds = orgs.map((o) => o.id);
  let members = [];
  if (orgIds.length > 0) {
    const { data, error: ce } = await supabase
      .from('customers')
      .select('id, company_name, furigana, manager_name, phone_number, login_password, organization_id')
      .eq('role', type)
      .in('organization_id', orgIds)
      .order('manager_name');
    if (ce) throw ce;
    members = data ?? [];
  }

  return orgs.map((org) => ({
    ...org,
    members: members.filter((m) => String(m.organization_id) === String(org.id)),
  }));
}

/** 組織を新規作成 */
export async function createOrganization(name, type) {
  const { data, error } = await supabase
    .from('organizations')
    .insert({ name: name.trim(), type })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** 担当者を新規作成（customers に INSERT） */
export async function createOrgMember({ organizationId, role, companyName, managerName, phone, password, furigana }) {
  let resolvedCompanyName = String(companyName ?? '').trim();
  if (!resolvedCompanyName && organizationId) {
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    resolvedCompanyName = String(org?.name ?? '').trim();
  }

  const { data, error } = await supabase
    .from('customers')
    .insert({
      organization_id: organizationId,
      role,
      company_name: resolvedCompanyName || null,
      furigana: furigana?.trim() ?? null,
      manager_name: managerName?.trim() ?? null,
      phone_number: phone?.trim() ?? null,
      login_password: password?.trim() ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** 担当者を更新 */
export async function updateOrgMember(id, { organizationId, companyName, managerName, phone, password, furigana }) {
  let resolvedCompanyName = String(companyName ?? '').trim();
  if (!resolvedCompanyName && organizationId) {
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', organizationId)
      .maybeSingle();
    if (orgError) throw orgError;
    resolvedCompanyName = String(org?.name ?? '').trim();
  }

  const { error } = await supabase
    .from('customers')
    .update({
      company_name: resolvedCompanyName || null,
      furigana: furigana?.trim() ?? null,
      manager_name: managerName?.trim() ?? null,
      phone_number: phone?.trim() ?? null,
      login_password: password?.trim() ?? null,
    })
    .eq('id', id);
  if (error) throw error;
}

/** 担当者を削除 */
export async function deleteOrgMember(id) {
  const { error } = await supabase.from('customers').delete().eq('id', id);
  if (error) throw error;
}

/** 組織に属する担当者（customers）一覧 — 現場担当者サジェスト用 */
export async function fetchCustomersByOrganizationId(organizationId) {
  const orgId = sanitizeRefId(organizationId);
  if (!orgId) return [];
  const { data, error } = await supabase
    .from('customers')
    .select('id, company_name, furigana, manager_name, phone_number, login_password, organization_id, role')
    .eq('organization_id', orgId)
    .order('manager_name');
  if (error) throw error;
  return (data ?? []).map(mapCustomerRow).filter(Boolean);
}

/**
 * CSVパース結果を一括インポート
 * @param {Array<{orgName, managerName, phone, password}>} rows
 * @param {'agent'|'cooperative'|'contractor'} orgType
 * @param {Array<{id, name}>} existingOrgs  既存組織一覧
 * @param {Array<{phone_number}>} existingMembers 既存担当者一覧
 * @returns {{ created: number, skipped: number }}
 */
export async function bulkImportOrgMembers(rows, orgType, existingOrgs, existingMembers) {
  // 既存組織名→IDのマップ
  const orgNameToId = {};
  for (const o of existingOrgs) orgNameToId[o.name.trim()] = o.id;

  // 既存電話番号のSet
  const existingPhones = new Set(
    existingMembers.map((m) => (m.phone_number ?? '').trim()).filter(Boolean),
  );

  let created = 0;
  let skipped = 0;

  // 組織名ごとにグループ化して処理
  const grouped = {};
  for (const row of rows) {
    const key = row.orgName.trim();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }

  for (const [orgName, members] of Object.entries(grouped)) {
    // 組織が存在しなければ作成
    let orgId = orgNameToId[orgName];
    if (!orgId) {
      const { data, error } = await supabase
        .from('organizations')
        .insert({ name: orgName, type: orgType })
        .select('id')
        .single();
      if (error) throw error;
      orgId = data.id;
      orgNameToId[orgName] = orgId;
    }

    // 担当者を登録（電話番号重複はスキップ）
    for (const m of members) {
      const phone = (m.phone ?? '').trim();
      if (phone && existingPhones.has(phone)) {
        skipped++;
        continue;
      }
      const { error } = await supabase
        .from('customers')
        .insert({
          organization_id: orgId,
          role: orgType,
          company_name: orgName,
          manager_name: m.managerName?.trim() ?? null,
          phone_number: phone || null,
          login_password: m.password?.trim() ?? null,
        });
      if (error) throw error;
      if (phone) existingPhones.add(phone);
      created++;
    }
  }

  return { created, skipped };
}

function mapCustomerRow(row) {
  if (!row || typeof row !== 'object') return null;
  const companyName = row.company_name != null ? String(row.company_name) : row.name != null ? String(row.name) : '';
  return {
    id: row.id != null ? String(row.id) : '',
    company_name: companyName,
    name: companyName,
    furigana: row.furigana != null ? String(row.furigana) : '',
    manager_name: row.manager_name != null ? String(row.manager_name) : '',
    phone_number: row.phone_number != null ? String(row.phone_number) : '',
    login_password: row.login_password != null ? String(row.login_password) : '',
    url_token:
      row.url_token != null && isValidSiteOrderUrlToken(String(row.url_token))
        ? String(row.url_token).trim()
        : '',
    role: String(row.role ?? 'contractor'),
    organization_id: row.organization_id != null ? String(row.organization_id) : null,
    created_at: row.created_at,
  };
}

export async function fetchCustomers() {
  const { data, error } = await supabase.from('customers').select('*').order('company_name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapCustomerRow).filter(Boolean);
}

const BULK_INSERT_CHUNK = 100;

function mapTradingCompanyRow(row) {
  if (!row || typeof row !== 'object') return null;
  const name = String(row.name ?? '').trim();
  if (!name) return null;
  return {
    id: row.id != null ? String(row.id) : '',
    name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchTradingCompanies() {
  const { data, error } = await supabase.from('trading_companies').select('*').order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapTradingCompanyRow).filter(Boolean);
}

export async function insertTradingCompany({ name }) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('商社名を入力してください');
  const { data, error } = await supabase.from('trading_companies').insert({ name: trimmed }).select('*').single();
  if (error) throw error;
  return mapTradingCompanyRow(data);
}

export async function updateTradingCompany(id, { name }) {
  const companyId = sanitizeRefId(id);
  if (!companyId) throw new Error('商社IDが必要です');
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('商社名を入力してください');
  const { data, error } = await supabase
    .from('trading_companies')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', companyId)
    .select('*')
    .single();
  if (error) throw error;
  return mapTradingCompanyRow(data);
}

export async function deleteTradingCompany(id) {
  const companyId = sanitizeRefId(id);
  if (!companyId) throw new Error('商社IDが必要です');
  const { error } = await supabase.from('trading_companies').delete().eq('id', companyId);
  if (error) throw error;
}

export async function bulkInsertTradingCompanies(rows) {
  const list = Array.isArray(rows) ? rows.filter((r) => r && typeof r === 'object') : [];
  if (list.length === 0) return [];

  const prepared = list.map((row) => {
    const name = String(row.name ?? '').trim();
    if (!name) throw new Error('商社名が空の行があります');
    return { name };
  });

  const inserted = [];
  for (let i = 0; i < prepared.length; i += BULK_INSERT_CHUNK) {
    const chunk = prepared.slice(i, i + BULK_INSERT_CHUNK);
    const { data, error } = await supabase
      .from('trading_companies')
      .upsert(chunk, { onConflict: 'name', ignoreDuplicates: true })
      .select('*');
    if (error) throw error;
    inserted.push(...(data || []));
  }
  return inserted.map(mapTradingCompanyRow).filter(Boolean);
}

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
      furigana: String(customerData?.furigana || '').trim() || null,
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
    furigana: String(customerData?.furigana || '').trim() || null,
    manager_name: String(customerData?.manager_name || '').trim() || null,
    phone_number: phoneNumber,
    login_password: loginPassword,
    role: String(customerData?.role || 'contractor').trim(),
    organization_id: customerData?.organization_id || null,
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
    furigana: String(customerData?.furigana || '').trim() || null,
    manager_name: String(customerData?.manager_name || '').trim() || null,
    phone_number: phoneNumber,
    login_password: loginPassword,
    role: String(customerData?.role || 'contractor').trim(),
    organization_id: customerData?.organization_id || null,
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
  if (!missingFn) {
    if (error) throw error;
    return null;
  }

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
    sales_staff: normalizeSalesStaffList(row?.sales_staff),
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
  if (Object.prototype.hasOwnProperty.call(payload || {}, 'sales_staff')) {
    row.sales_staff = normalizeSalesStaffList(payload.sales_staff);
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
export async function submitGuestOrders(urlToken, orders, { factories = [], projects = [] } = {}) {
  const token = String(urlToken || '').trim();
  if (!isValidSiteOrderUrlToken(token)) throw new Error('専用発注URLが無効です');
  const list = Array.isArray(orders) ? orders.filter((o) => o && typeof o === 'object') : [];
  if (list.length === 0) throw new Error('登録する注文がありません');

  const prepared = list.map((order) => ensureOrderPreferredFactoryForInsert(order, { factories, projects }));

  const { data, error } = await supabase.rpc('submit_guest_orders', {
    p_token: token,
    p_orders: prepared,
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
  const withTokens = await enrichProjectsWithCustomerUrlTokens(mapped);
  return enrichProjectsWithTradingCompanyOrgs(withTokens);
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
      ...buildProjectTradingCompanyFields(payload),
      contractor: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
      sub_contractor_name: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
      contractor_display_name: String(payload.contractor_display_name || '').trim() || null,
      delivery_area: String(payload.delivery_area || '').trim() || null,
      site_address: String(payload.site_address || '').trim() || null,
      folder_url: normalizeExternalUrl(payload.folder_url) || null,
      sheet_url: normalizeExternalUrl(payload.sheet_url) || null,
      url_token: resolveUrlTokenForInsert(payload),
      sales_admin_id: String(payload.sales_admin_id ?? '').trim() || null,
      sales_admin_name: String(payload.sales_admin_name ?? '').trim() || null,
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
  const withTokens = await enrichProjectsWithCustomerUrlTokens(mapped);
  return enrichProjectsWithTradingCompanyOrgs(withTokens);
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
    ...buildProjectTradingCompanyFields(payload),
    contractor: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
    sub_contractor_name: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
    contractor_display_name: String(payload.contractor_display_name || '').trim() || null,
    delivery_area: String(payload.delivery_area || '').trim() || null,
    site_address: String(payload.site_address || '').trim() || null,
    folder_url: normalizeExternalUrl(payload.folder_url) || null,
    sheet_url: normalizeExternalUrl(payload.sheet_url) || null,
    url_token: resolveUrlTokenForInsert(payload),
    sales_admin_id: String(payload.sales_admin_id ?? '').trim() || null,
    sales_admin_name: String(payload.sales_admin_name ?? '').trim() || null,
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
    ...buildProjectTradingCompanyFields(payload),
    contractor: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
    sub_contractor_name: String(payload.sub_contractor_name || payload.contractor || '').trim() || null,
    contractor_display_name: String(payload.contractor_display_name || '').trim() || null,
    delivery_area: String(payload.delivery_area || '').trim() || null,
    site_address: String(payload.site_address || '').trim() || null,
    folder_url: normalizeExternalUrl(payload.folder_url) || null,
    sheet_url: normalizeExternalUrl(payload.sheet_url) || null,
    sales_admin_id: String(payload.sales_admin_id ?? '').trim() || null,
    sales_admin_name: String(payload.sales_admin_name ?? '').trim() || null,
  };
  const latNum = payload.lat != null && payload.lat !== '' ? Number(payload.lat) : NaN;
  const lngNum = payload.lng != null && payload.lng !== '' ? Number(payload.lng) : NaN;
  if (Number.isFinite(latNum)) row.lat = latNum;
  if (Number.isFinite(lngNum)) row.lng = lngNum;
  const { data, error } = await supabase.from('projects').update(row).eq('id', id).select('*').single();
  if (error) throw error;
  return mapProjectRow(data);
}

function isMissingRelationOrColumnError(error) {
  const code = error?.code ? String(error.code) : '';
  const msg = error?.message ? String(error.message).toLowerCase() : '';
  const status = error?.status ?? error?.statusCode;
  return (
    code === '42P01' ||
    code === '42703' ||
    code === 'PGRST204' ||
    code === 'PGRST205' ||
    status === 404 ||
    msg.includes('does not exist') ||
    msg.includes('could not find') ||
    msg.includes('schema cache') ||
    msg.includes('not found')
  );
}

export const ESCALATION_STEPS_MIGRATION_HINT =
  'factory_escalation_steps テーブルが未作成です。Supabase でマイグレーション supabase/migrations/20260602160000_factory_escalation_steps.sql を適用してください（supabase db push）。';

function escalationStepsUnavailableError(error) {
  if (!isMissingRelationOrColumnError(error)) return null;
  const err = new Error(ESCALATION_STEPS_MIGRATION_HINT);
  err.code = 'ESCALATION_STEPS_TABLE_MISSING';
  err.cause = error;
  return err;
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

const PROJECT_MAP_SELECT_ATTEMPTS = [
  'id, name, default_map_image_url, map_base_image_url, lat, lng, map_annotations',
  'id, name, default_map_image_url, lat, lng, map_annotations',
  'id, name, default_map_image_url, lat, lng',
  'id, name, map_base_image_url, lat, lng, map_annotations',
  'id, name, map_base_image_url, lat, lng',
  'id, name, lat, lng, map_annotations',
  'id, name, lat, lng',
];

/** @deprecated PROJECT_MAP_SELECT_ATTEMPTS を使用 */
const PROJECT_MAP_SELECT = PROJECT_MAP_SELECT_ATTEMPTS[0];

function buildProjectMapPatchVariants(patch) {
  const imageUrl = String(patch.default_map_image_url ?? patch.map_base_image_url ?? '').trim();
  const basePatch = { ...patch };
  delete basePatch.default_map_image_url;
  delete basePatch.map_base_image_url;
  const withoutAnnotations = { ...basePatch };
  delete withoutAnnotations.map_annotations;

  const variants = [];
  const bases = basePatch.map_annotations != null ? [basePatch, withoutAnnotations] : [basePatch];
  for (const body of bases) {
    if (imageUrl) {
      variants.push({ ...body, default_map_image_url: imageUrl });
      variants.push({ ...body, map_base_image_url: imageUrl });
    }
    variants.push({ ...body });
  }
  return variants;
}

async function selectProjectMapRow(projectId, select = PROJECT_MAP_SELECT) {
  const id = String(projectId || '').trim();
  const { data, error } = await supabase.from('projects').select(select).eq('id', id).maybeSingle();
  return { data, error };
}

/** 地図URLカラムの有無に依存しない物件マップ行取得 */
async function fetchProjectMapRow(projectId) {
  let lastError = null;
  for (const select of PROJECT_MAP_SELECT_ATTEMPTS) {
    const { data, error } = await selectProjectMapRow(projectId, select);
    if (!error) return data;
    if (!isMissingRelationOrColumnError(error)) throw error;
    lastError = error;
  }
  throw lastError || new Error('物件が見つかりません');
}

async function updateProjectMapRow(projectId, patch) {
  const id = String(projectId || '').trim();
  const variants = buildProjectMapPatchVariants(patch);

  let lastError = null;
  for (const row of variants) {
    for (const select of PROJECT_MAP_SELECT_ATTEMPTS) {
      const { data, error } = await supabase.from('projects').update(row).eq('id', id).select(select).single();
      if (!error) return data;
      if (!isMissingRelationOrColumnError(error)) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error('物件マップの保存に失敗しました');
}

/** 地図保存後の lat/lng を確実に反映（注釈のみ更新が先に成功した場合のフォールバック） */
async function syncProjectLatLng(projectId, lat, lng) {
  const id = String(projectId || '').trim();
  if (!id || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const patch = { lat, lng };
  for (const select of ['id, lat, lng', 'id']) {
    const { data, error } = await supabase.from('projects').update(patch).eq('id', id).select(select).maybeSingle();
    if (!error) return data;
    if (!isMissingRelationOrColumnError(error)) throw error;
  }
  return null;
}

async function selectExistingProjectMapUrl(projectId) {
  const attempts = [
    'default_map_image_url',
    'map_base_image_url',
    'default_map_image_url, map_base_image_url',
  ];
  for (const select of attempts) {
    const { data, error } = await selectProjectMapRow(projectId, select);
    if (!error) return data;
    if (!isMissingRelationOrColumnError(error)) throw error;
  }
  return null;
}

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
    try {
      project = await fetchProjectMapRow(projectId);
    } catch (pErr) {
      console.warn('[fetchOrderForMapEditor] project load failed', pErr);
      project = null;
    }
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

/** 物件マスタ用: 基本現場地図エディタの読み込み */
export async function fetchProjectForMapEditor(projectId) {
  const id = String(projectId || '').trim();
  if (!id) throw new Error('projectId が必要です');

  const row = await fetchProjectMapRow(id);
  if (!row) return null;

  const project = mapProjectRow(row) || { id, name: row.name != null ? String(row.name) : '' };
  const defaultMapImageUrl = pickProjectDefaultMapUrl(row);
  const displayImageUrl = normalizeExternalUrl(defaultMapImageUrl) || '';
  const mapSource = displayImageUrl ? 'default' : 'none';
  const projectCenter = pickMapEditorCenter(null, row);
  const rawAnnotations = row.map_annotations;
  let mapAnnotations = normalizeMapAnnotations(rawAnnotations, {
    projectCenter,
    imageUrl: '',
  });
  mapAnnotations = stripSavedSnapshotOverlay(mapAnnotations, displayImageUrl);
  const { annotations: viewAnnotations, flyTarget: initialFlyTarget } =
    getInitialMapViewFromAnnotations(mapAnnotations);
  mapAnnotations = viewAnnotations;

  return {
    project: row,
    projectId: id,
    displayImageUrl,
    mapSource,
    defaultMapImageUrl,
    mapAnnotations,
    initialFlyTarget,
    title: String(project.name || row.name || '').trim() || `物件 ${id}`,
  };
}

/**
 * プロジェクト基本マップとして保存
 * Storage: maps/projects/{project_id}_{timestamp}.png
 */
export async function saveProjectDefaultMap(projectId, imageDataUrl, mapAnnotations) {
  const pid = String(projectId || '').trim();
  if (!pid) throw new Error('projectId が必要です');

  const normalized = applyInitialViewCenter(normalizeMapAnnotations(mapAnnotations, { imageUrl: '' }));
  const timestamp = Date.now();
  const storagePath = `projects/${pid}_${timestamp}.png`;
  const upload = imageDataUrl
    ? await uploadMapPngToStorageOptional(storagePath, imageDataUrl)
    : { ok: false, publicUrl: '', storagePath, error: null };

  let existingUrl = '';
  const existingProject = await selectExistingProjectMapUrl(pid);
  if (existingProject) {
    existingUrl = String(existingProject.default_map_image_url || existingProject.map_base_image_url || '').trim();
  }

  const publicUrl = upload.ok ? upload.publicUrl : existingUrl;
  const savedAnnotations = applyInitialViewCenter(withImageOverlay(normalized, publicUrl));
  const coords = pickCoordsFromMapAnnotations(savedAnnotations);

  const row = { map_annotations: savedAnnotations };
  if (upload.ok && publicUrl) {
    row.default_map_image_url = publicUrl;
  }
  if (coords) {
    row.lat = coords.lat;
    row.lng = coords.lng;
  }

  let data;
  try {
    data = await updateProjectMapRow(pid, row);
    if (coords) {
      const synced = await syncProjectLatLng(pid, coords.lat, coords.lng);
      if (synced && (synced.lat != null || synced.lng != null)) {
        data = { ...(data || {}), ...synced };
      }
    }
  } catch (error) {
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
  if (targets.length === 0) {
    throw new Error('配信先の工場を1件以上選択してください');
  }
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

/** 管理画面: ニュース削除（既読ログは CASCADE） */
export async function deleteFactoryNews(newsId) {
  const id = String(newsId || '').trim();
  if (!id) throw new Error('削除対象がありません');
  const { error } = await supabase.from('factory_news').delete().eq('id', id);
  if (error) throw error;
}

function mapEscalationStepRow(row) {
  if (!row || typeof row !== 'object') return null;
  const factory_id = sanitizeRefId(row.factory_id);
  if (!factory_id) return null;
  const stepNum = Number(row.step_number);
  const trigger = Number(row.trigger_minutes);
  const count = Number(row.target_factory_count);
  return {
    factory_id,
    step_number: Number.isFinite(stepNum) && stepNum >= 1 ? Math.floor(stepNum) : 1,
    trigger_minutes: Number.isFinite(trigger) && trigger >= 0 ? Math.floor(trigger) : 0,
    target_factory_count: Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1,
  };
}

function normalizeEscalationStepsForSave(stepsArray) {
  const list = Array.isArray(stepsArray) ? stepsArray : [];
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i];
    if (!raw || typeof raw !== 'object') continue;
    const trigger = Number(raw.trigger_minutes);
    const count = Number(raw.target_factory_count);
    out.push({
      step_number: i + 1,
      trigger_minutes: Number.isFinite(trigger) && trigger >= 0 ? Math.floor(trigger) : 0,
      target_factory_count: Number.isFinite(count) && count >= 1 ? Math.floor(count) : 1,
    });
  }
  return out;
}

function groupEscalationStepsRows(data) {
  /** @type {Record<string, Array<{ step_number: number, trigger_minutes: number, target_factory_count: number }>>} */
  const byFactory = {};
  for (const row of data || []) {
    const mapped = mapEscalationStepRow(row);
    if (!mapped) continue;
    const { factory_id, step_number, trigger_minutes, target_factory_count } = mapped;
    if (!byFactory[factory_id]) byFactory[factory_id] = [];
    byFactory[factory_id].push({ step_number, trigger_minutes, target_factory_count });
  }
  for (const fid of Object.keys(byFactory)) {
    byFactory[fid].sort((a, b) => a.step_number - b.step_number);
  }
  return byFactory;
}

/**
 * factory_escalation_steps を工場IDごとにグループ化（step_number 昇順）
 * テーブル未作成時は空オブジェクト（404 を投げない）
 * @returns {Record<string, Array<{ step_number: number, trigger_minutes: number, target_factory_count: number }>>}
 */
export async function fetchEscalationSteps() {
  const meta = await fetchEscalationStepsMeta();
  return meta.byFactory;
}

/**
 * @returns {Promise<{ byFactory: Record<string, Array<{ step_number: number, trigger_minutes: number, target_factory_count: number }>>, tableReady: boolean }>}
 */
export async function fetchEscalationStepsMeta() {
  if (!supabase?.from) {
    console.warn('[fetchEscalationSteps] Supabase client is not ready');
    return { byFactory: {}, tableReady: false };
  }

  const { data, error } = await supabase
    .from('factory_escalation_steps')
    .select('factory_id, step_number, trigger_minutes, target_factory_count')
    .order('factory_id', { ascending: true })
    .order('step_number', { ascending: true });

  if (error) {
    if (isMissingRelationOrColumnError(error)) {
      console.warn('[fetchEscalationSteps]', ESCALATION_STEPS_MIGRATION_HINT, error);
      return { byFactory: {}, tableReady: false };
    }
    throw error;
  }

  return { byFactory: groupEscalationStepsRows(data), tableReady: true };
}

/** 対象工場のステップを全削除のうえ、新しい配列を一括 insert（.from のみ・RPC 不使用） */
export async function saveEscalationSteps(factoryId, stepsArray) {
  const fid = sanitizeRefId(factoryId);
  if (!fid) throw new Error('factoryId が必要です');
  if (!supabase?.from) throw new Error('Supabase クライアントが初期化されていません');

  const { error: deleteError } = await supabase.from('factory_escalation_steps').delete().eq('factory_id', fid);
  if (deleteError) {
    const migrationErr = escalationStepsUnavailableError(deleteError);
    if (migrationErr) throw migrationErr;
    throw deleteError;
  }

  const steps = normalizeEscalationStepsForSave(stepsArray);
  if (steps.length === 0) return;

  const rows = steps.map((step) => ({
    factory_id: fid,
    step_number: step.step_number,
    trigger_minutes: step.trigger_minutes,
    target_factory_count: step.target_factory_count,
  }));

  const { error: insertError } = await supabase.from('factory_escalation_steps').insert(rows);
  if (insertError) {
    const migrationErr = escalationStepsUnavailableError(insertError);
    if (migrationErr) throw migrationErr;
    throw insertError;
  }
}

/**
 * 全工場の月次出荷量を factory_escalation_steps から取得
 * 戻り値: { [factoryId: string]: number }  (未設定は 0)
 */
export async function fetchMonthlyVolumeByFactory() {
  const { data, error } = await supabase
    .from('factory_escalation_steps')
    .select('factory_id, monthly_volume_m3')
    .order('step_number', { ascending: true });
  if (error) throw error;
  const out = {};
  for (const row of data || []) {
    const fid = String(row.factory_id || '').trim();
    if (!fid) continue;
    // factory_id ごとに最初に現れた値を採用（step_number最小）
    if (out[fid] === undefined) {
      out[fid] = row.monthly_volume_m3 != null ? Number(row.monthly_volume_m3) : 0;
    }
  }
  return out;
}

/**
 * 指定工場の全ステップに monthly_volume_m3 を一括更新
 * @param {string} factoryId
 * @param {number|null} volumeM3
 */
export async function saveMonthlyVolumeForFactory(factoryId, volumeM3) {
  const fid = String(factoryId || '').trim();
  if (!fid) throw new Error('factoryId が必要です');
  const value =
    volumeM3 != null && Number.isFinite(Number(volumeM3)) ? Number(volumeM3) : null;
  const { error } = await supabase
    .from('factory_escalation_steps')
    .update({ monthly_volume_m3: value })
    .eq('factory_id', fid);
  if (error) throw error;
}

/**
 * 工場名 → factory_id のマップを返す
 * 戻り値: { [factory_name: string]: string }
 */
export async function fetchFactoryNameToIdMap() {
  const { data, error } = await supabase
    .from('factories')
    .select('id, name');
  if (error) throw error;
  const map = {};
  for (const row of data ?? []) {
    if (row.name) map[row.name.trim()] = String(row.id);
  }
  return map;
}

/**
 * 全工場の monthly_volume_m3 を一括上書き保存
 * @param {Array<{factoryId: string, volumeM3: number|null}>} entries
 */
export async function bulkSaveMonthlyVolumes(entries) {
  for (const { factoryId, volumeM3 } of entries) {
    const fid = String(factoryId || '').trim();
    if (!fid) continue;
    const value =
      volumeM3 != null && Number.isFinite(Number(volumeM3)) ? Number(volumeM3) : null;
    const { error } = await supabase
      .from('factory_escalation_steps')
      .update({ monthly_volume_m3: value })
      .eq('factory_id', fid);
    if (error) throw error;
  }
}

/**
 * 全工場の出荷量サマリーを返す
 * 戻り値: Array<{
 *   factoryId: string,
 *   factoryName: string,
 *   monthlyVolumeM3: number|null,
 *   volumeUpdatedAt: string|null  // ISO8601
 * }>
 * factory_id ごとに重複排除（step_number 最小行を代表）
 */
export async function fetchVolumesSummary() {
  const { data, error } = await supabase
    .from('factory_escalation_steps')
    .select('factory_id, monthly_volume_m3, volume_updated_at')
    .order('step_number', { ascending: true });
  if (error) throw error;

  const seen = new Map();
  for (const row of data ?? []) {
    const fid = String(row.factory_id ?? '').trim();
    if (!fid || seen.has(fid)) continue;
    seen.set(fid, {
      factoryId: fid,
      monthlyVolumeM3: row.monthly_volume_m3 != null
        ? Number(row.monthly_volume_m3)
        : null,
      volumeUpdatedAt: row.volume_updated_at ?? null,
    });
  }

  const { data: factories, error: fe } = await supabase
    .from('factories')
    .select('id, name');
  if (fe) throw fe;

  const nameById = {};
  for (const f of factories ?? []) nameById[String(f.id)] = f.name ?? '不明';

  return [...seen.values()].map((row) => ({
    ...row,
    factoryName: nameById[row.factoryId] ?? `ID:${row.factoryId}`,
  }));
}

/**
 * 単一工場の monthly_volume_m3 を更新（インライン編集用）
 * volume_updated_at はトリガーが自動更新
 */
export async function updateMonthlyVolume(factoryId, volumeM3) {
  const fid = String(factoryId || '').trim();
  if (!fid) throw new Error('factoryId が必要です');
  const value = volumeM3 != null && Number.isFinite(Number(volumeM3))
    ? Number(volumeM3)
    : null;
  const { error } = await supabase
    .from('factory_escalation_steps')
    .update({ monthly_volume_m3: value })
    .eq('factory_id', fid);
  if (error) throw error;
}

/**
 * distance_weight 設定を取得（シングルトン行）
 * 戻り値: number (0.0〜1.0、未設定時は 0.7)
 */
export async function fetchEscalationDistanceWeight() {
  const { data, error } = await supabase
    .from('factory_escalation_weight_config')
    .select('distance_weight')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  const w = data?.distance_weight;
  return w != null && Number.isFinite(Number(w)) ? Number(w) : 0.7;
}

/**
 * distance_weight 設定を保存（UPSERT）
 * @param {number} weight 0.0〜1.0
 */
export async function saveEscalationDistanceWeight(weight) {
  const w = Math.max(0, Math.min(1, Number(weight)));
  const { error } = await supabase
    .from('factory_escalation_weight_config')
    .upsert({ id: 1, distance_weight: w, updated_at: new Date().toISOString() });
  if (error) throw error;
}
