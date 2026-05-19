import { supabase } from './supabaseClient.js';
import {
  DISPATCH_DEFAULT_FACTORY_SITE_ID,
  DISPATCH_DEFAULT_FACTORY_SITE_NAME,
  computeScheduleAutoRejectReason,
  getOrderMinutesForScheduleScan,
  normalizeDayBlockSchedule,
  normalizeFullSchedule,
} from './haishaConstants.js';

const ORDER_SELECT =
  'id, order_data, chat_messages, created_at, has_test, project_id, customer_id, ordered_by, is_spot, delivery_lat, delivery_lng, preferred_factory_id, factory_site_id, status, rejected_factory_ids';

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
  return {
    ...o,
    factory_site_id: sanitizeRefId(o.factory_site_id),
    factorySiteId: sanitizeRefId(o.factorySiteId),
    preferred_factory_id: sanitizeRefId(o.preferred_factory_id),
    preferredFactoryId: sanitizeRefId(o.preferredFactoryId),
    main_factory_id: sanitizeRefId(o.main_factory_id),
    mainFactoryId: sanitizeRefId(o.mainFactoryId),
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
    const { data: customers } = await supabase.from('customers').select('id, company_name, phone_number').in('id', customerIds);
    customerById = new Map((customers || []).map((c) => [String(c.id), c]));
  }
  if (projectIds.length) {
    const { data: projects } = await supabase.from('projects').select('id, name, customer_id, trading_company_name, trading_company').in('id', projectIds);
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
      projectName: o.projectName || (p?.name != null ? String(p.name) : ''),
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

export async function insertOrder(order) {
  if (!order || typeof order !== 'object') throw new Error('order が必要です');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = createOrderId();
    const hasTest = Boolean(order.has_test);
    const isSpot = Boolean(order.is_spot);
    const projectId = !isSpot && order.project_id != null ? String(order.project_id).trim() : '';
    const customerId = sanitizeRefId(order.customer_id ?? order.customerId);
    const orderedBy = String(order.ordered_by ?? order.orderedBy ?? '').trim();
    const deliveryLat = isSpot ? parseDeliveryCoord(order.delivery_lat ?? order.deliveryLat) : null;
    const deliveryLng = isSpot ? parseDeliveryCoord(order.delivery_lng ?? order.deliveryLng) : null;
    const safeOrder = sanitizeOrderRefs(order);
    const preferredFactoryId = sanitizeRefId(safeOrder.preferred_factory_id);
    const nextOrder = sanitizeOrderDataForDb({
      ...safeOrder,
      id,
      has_test: hasTest,
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
    });
    const row = {
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
      status: 'pending',
      rejected_factory_ids: [],
    };
    const { data, error } = await supabase.from('orders').insert([row]).select(ORDER_SELECT).single();
    if (!error) return normalizeOrderRow(data);
    if (error.code !== '23505' || attempt === 2) {
      console.error('insertOrder failed', error);
      throw error;
    }
  }
  throw new Error('注文IDの生成に失敗しました');
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
  const customerId = sanitizeRefId(nextOrder.customer_id);
  const orderedBy = String(nextOrder.ordered_by ?? nextOrder.orderedBy ?? '').trim();
  const { data: updated, error: upErr } = await supabase
    .from('orders')
    .update({
      order_data: nextOrder,
      has_test: hasTest,
      customer_id: customerId,
      ordered_by: orderedBy || null,
      factory_site_id: factorySiteId,
      status: status || 'pending',
    })
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

export function subscribeHaishaRealtime(onEvent) {
  const channelName = `haisha-realtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'factories' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, onEvent)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_settings' }, onEvent)
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
    url_token: row.url_token != null ? String(row.url_token) : '',
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
    url_token: row.url_token != null ? String(row.url_token) : '',
    created_at: row.created_at,
  };
}

export async function fetchCustomers() {
  const { data, error } = await supabase.from('customers').select('*').order('company_name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapCustomerRow).filter(Boolean);
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
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('phone_number', phone)
    .eq('login_password', pass)
    .maybeSingle();
  if (error) throw error;
  return data ? mapCustomerRow(data) : null;
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
  const { data, error } = await supabase
    .from('admin_settings')
    .select('*')
    .eq('id', 1)
    .eq('phone_number', phone)
    .eq('login_password', pass)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('管理者の電話番号またはパスワードが間違っています');
  return mapAdminSettingsRow(data);
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

/** 物件マスタ一覧 */
export async function fetchProjects() {
  const { data, error } = await supabase.from('projects').select('*').order('name', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapProjectRow).filter(Boolean);
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
    contractor: String(payload.contractor || '').trim() || null,
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
    contractor: String(payload.contractor || '').trim() || null,
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
