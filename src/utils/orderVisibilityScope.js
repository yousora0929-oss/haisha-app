import {
  buildEscalationContext,
  getEffectiveEscalationMinutes,
  getVisibleFactoryIdsForOrder,
} from './escalationUtils.js';
import { getOrderDeliveryAreaContext } from './deliveryAreaEscalation.js';
import { associationAssignedFactoryIds } from './associationFactoryAssignment.js';

function orderStatus(order) {
  return String(order?.status || 'pending').trim();
}

function orderProjectId(order) {
  const id = order?.project_id ?? order?.projectId;
  return id != null ? String(id).trim() : '';
}

function orderPreferredFactoryId(order) {
  const id = order?.preferred_factory_id ?? order?.preferredFactoryId;
  return id != null ? String(id).trim() : '';
}

function orderAssignedFactoryId(order) {
  const a = order?.factory_site_id != null ? String(order.factory_site_id).trim() : '';
  if (a) return a;
  return order?.factorySiteId != null ? String(order.factorySiteId).trim() : '';
}

function factoryName(factoryNameById, id) {
  const fid = String(id || '').trim();
  if (!fid) return '';
  return String(factoryNameById?.[fid] || fid).trim();
}

/**
 * 注文の公開・エスカレーション範囲（管理画面表示用）
 * @returns {{
 *   kind: string,
 *   summary: string,
 *   detail: string,
 *   escalationMinutes: number|null,
 *   escalationTierLabel: string,
 *   visibleFactoryIds: string[],
 *   visibleFactoryNames: string[],
 *   mainFactoryIds: string[],
 *   subFactoryIds: string[],
 *   listIcon: { emoji: string, count: number|null, shortLabel: string },
 *   chips: Array<{ id: string, name: string, role?: string }>,
 * }}
 */
export function getOrderVisibilityScope(order, ctx, factoryNameById = {}) {
  const status = orderStatus(order);
  const isSpot = Boolean(order?.is_spot);
  const assignedId = orderAssignedFactoryId(order);
  const preferredId = orderPreferredFactoryId(order);
  const pid = orderProjectId(order);
  const project = pid && ctx?.projectById ? ctx.projectById[pid] : null;
  const mainId = project?.main_factory_id != null ? String(project.main_factory_id).trim() : '';
  const subIds = Array.isArray(project?.sub_factory_ids)
    ? project.sub_factory_ids.map((x) => String(x).trim()).filter(Boolean)
    : [];

  const effectiveMinutes =
    status === 'accepted' || status === 'customer_cancelled' || status === 'completed'
      ? null
      : getEffectiveEscalationMinutes(order, ctx?.projectById, ctx?.settings, ctx?.holidays, ctx?.now);

  const escalationTierLabel =
    effectiveMinutes == null
      ? '—'
      : effectiveMinutes >= 45
        ? '45分+: エリア全域'
        : effectiveMinutes >= 30
          ? '30分+: 近隣拡大'
          : effectiveMinutes >= 15
            ? '15分+: メイン/サブまたは近隣3社'
            : '0〜14分: 優先工場のみ';

  const base = {
    escalationMinutes: effectiveMinutes,
    escalationTierLabel,
    mainFactoryIds: [preferredId, mainId].filter(Boolean),
    subFactoryIds: subIds,
  };

  if (status === 'pending_association') {
    return {
      ...base,
      kind: 'association_pending',
      summary: '組合管理者にのみ表示（工場には非表示）',
      detail:
        'スポット数量が組合しきい値を超えています。承認時に手配先工場を指定すると、指定工場の配車待ち一覧へ公開されます。',
      visibleFactoryIds: [],
      visibleFactoryNames: [],
      listIcon: { emoji: '🛡️', count: null, shortLabel: '組合預かり' },
      chips: [{ id: 'admin', name: '組合管理者', role: 'admin' }],
    };
  }

  const associationIds = associationAssignedFactoryIds(order);
  if (associationIds.length > 0 && status === 'pending') {
    const visibleFactoryIds = associationIds;
    const visibleFactoryNames = visibleFactoryIds.map((id) => factoryName(factoryNameById, id));
    const subPool = associationIds.filter((id) => id !== preferredId);
    const chips = visibleFactoryIds.map((id) => ({
      id,
      name: factoryName(factoryNameById, id),
      role: id === preferredId ? 'preferred' : subPool.includes(id) ? 'association' : 'visible',
    }));
    return {
      ...base,
      kind: 'association_assigned',
      summary: `組合指定の ${visibleFactoryIds.length} 工場に表示中`,
      detail:
        '大口スポット承認時に組合が指定した手配先です。公開範囲はこの工場群に限定されます（物件デフォルトより優先）。',
      visibleFactoryIds,
      visibleFactoryNames,
      mainFactoryIds: preferredId ? [preferredId] : visibleFactoryIds.slice(0, 1),
      subFactoryIds: subPool,
      listIcon: { emoji: '🛡️', count: visibleFactoryIds.length, shortLabel: '組合指定' },
      chips,
    };
  }

  if (status === 'deleted') {
    return {
      ...base,
      kind: 'deleted',
      summary: '削除済み（工場には非表示）',
      detail: '',
      visibleFactoryIds: [],
      visibleFactoryNames: [],
      listIcon: { emoji: '🚫', count: 0, shortLabel: '非表示' },
      chips: [],
    };
  }

  if (status === 'completed' || status === 'customer_cancelled') {
    const label = status === 'completed' ? '完了' : 'キャンセル';
    return {
      ...base,
      kind: 'terminal',
      summary: `${label}（工場の新規受注一覧には非表示）`,
      detail: assignedId ? `受注確定工場: ${factoryName(factoryNameById, assignedId)}` : '',
      visibleFactoryIds: [],
      visibleFactoryNames: [],
      listIcon: { emoji: '📁', count: 0, shortLabel: label },
      chips: assignedId ? [{ id: assignedId, name: factoryName(factoryNameById, assignedId), role: 'assigned' }] : [],
    };
  }

  const visibleFactoryIds = getVisibleFactoryIdsForOrder(order, ctx);
  const visibleFactoryNames = visibleFactoryIds.map((id) => factoryName(factoryNameById, id));
  const allCount = (ctx?.allFactoryIds || []).length;
  const addrCtx = getOrderDeliveryAreaContext(order, ctx?.projectById);
  const areaBasedNote =
    addrCtx.locationPending && !order?.delivery_lat && !order?.delivery_lng && addrCtx.deliveryArea
      ? `（地図待ち・${addrCtx.deliveryArea}エリアで工場を選定）`
      : '';

  const chips = visibleFactoryIds.map((id) => {
    let role = 'visible';
    if (id === assignedId) role = 'assigned';
    else if (id === preferredId) role = 'preferred';
    else if (id === mainId) role = 'main';
    else if (subIds.includes(id)) role = 'sub';
    return { id, name: factoryName(factoryNameById, id), role };
  });

  if (status === 'accepted' && assignedId) {
    return {
      ...base,
      kind: 'accepted_assigned',
      summary: `${factoryName(factoryNameById, assignedId)} に受注確定`,
      detail: isSpot
        ? 'スポット受注確定後は、受注した工場を中心に表示されます。'
        : '物件関連工場・受注工場が閲覧対象です。',
      visibleFactoryIds,
      visibleFactoryNames,
      listIcon: { emoji: '✅', count: visibleFactoryIds.length || 1, shortLabel: '受注確定' },
      chips,
    };
  }

  if (assignedId && status !== 'accepted') {
    return {
      ...base,
      kind: 'assigned_pending',
      summary: `${factoryName(factoryNameById, assignedId)} に割当済み`,
      detail: '工場が応答中、または担当工場に限定表示されています。',
      visibleFactoryIds,
      visibleFactoryNames,
      listIcon: { emoji: '🏭', count: visibleFactoryIds.length || 1, shortLabel: '単独工場' },
      chips,
    };
  }

  const areaPoolSize = ctx?.areaFactoryIdsByOrder?.get(order.id)?.length ?? allCount;
  if (areaPoolSize > 0 && visibleFactoryIds.length >= areaPoolSize) {
    return {
      ...base,
      kind: 'area_all',
      summary: '管轄エリア内の全工場に表示中',
      detail: `エリア内 ${areaPoolSize} 工場すべてが閲覧可能です（エスカレーション ${escalationTierLabel}）${areaBasedNote}`,
      visibleFactoryIds,
      visibleFactoryNames,
      listIcon: { emoji: '🌐', count: visibleFactoryIds.length, shortLabel: '全域共有' },
      chips,
    };
  }

  if (project && visibleFactoryIds.length > 0) {
    const tier0 = preferredId || mainId;
    const visibleSubs = subIds.filter((id) => visibleFactoryIds.includes(id));
    const visibleMain = [preferredId, mainId].filter((id) => id && visibleFactoryIds.includes(id));
    const uniqueMain = [...new Set(visibleMain)];

    if (effectiveMinutes != null && effectiveMinutes < 15 && visibleFactoryIds.length === 1 && tier0) {
      const role = tier0 === preferredId ? '指定' : 'メイン';
      return {
        ...base,
        kind: 'main_only',
        summary: `${factoryName(factoryNameById, tier0)} 工場（${role}）に表示中`,
        detail: `物件注文 · エスカレーション ${escalationTierLabel}`,
        visibleFactoryIds,
        visibleFactoryNames,
        listIcon: { emoji: '🏭', count: 1, shortLabel: '単独工場' },
        chips,
      };
    }

    if (visibleSubs.length > 0) {
      const mainLabel = uniqueMain.map((id) => factoryName(factoryNameById, id)).filter(Boolean).join('、') || factoryName(factoryNameById, tier0);
      const subLabel = visibleSubs.map((id) => factoryName(factoryNameById, id)).join('、');
      return {
        ...base,
        kind: 'main_and_subs',
        summary: `${mainLabel}${subLabel ? `、${subLabel}（サブ）` : ''} に表示中`,
        detail: `物件注文 · メイン/サブ工場へ展開 · ${escalationTierLabel}`,
        visibleFactoryIds,
        visibleFactoryNames,
        listIcon: { emoji: '🏭', count: visibleFactoryIds.length, shortLabel: '複数工場' },
        chips,
      };
    }
  }

  if (preferredId && visibleFactoryIds.length === 1 && visibleFactoryIds[0] === preferredId) {
    return {
      ...base,
      kind: 'preferred_only',
      summary: `${factoryName(factoryNameById, preferredId)} 工場（指定）に表示中`,
      detail: isSpot ? `スポット注文 · ${escalationTierLabel}` : `エスカレーション ${escalationTierLabel}`,
      visibleFactoryIds,
      visibleFactoryNames,
      listIcon: { emoji: '🏭', count: 1, shortLabel: '単独工場' },
      chips,
    };
  }

  if (visibleFactoryIds.length > 1) {
    return {
      ...base,
      kind: 'multi_factory',
      summary: `${visibleFactoryNames.join('、')} の ${visibleFactoryIds.length} 工場に表示中`,
      detail: `${isSpot ? 'スポット' : '物件'}注文 · ${escalationTierLabel}`,
      visibleFactoryIds,
      visibleFactoryNames,
      listIcon: { emoji: '🏭', count: visibleFactoryIds.length, shortLabel: '複数工場' },
      chips,
    };
  }

  if (visibleFactoryIds.length === 1) {
    return {
      ...base,
      kind: 'single_factory',
      summary: `${visibleFactoryNames[0]} 工場に表示中`,
      detail: escalationTierLabel,
      visibleFactoryIds,
      visibleFactoryNames,
      listIcon: { emoji: '🏭', count: 1, shortLabel: '単独工場' },
      chips,
    };
  }

  return {
    ...base,
    kind: 'none',
    summary: '工場には未公開',
    detail: '公開条件を満たしていないか、作成直後のため工場画面にまだ表示されていません。',
    visibleFactoryIds: [],
    visibleFactoryNames: [],
    listIcon: { emoji: '👁️', count: 0, shortLabel: '未公開' },
    chips: [],
  };
}

export function buildOrderVisibilityContext(orders, factories, projects, settings, holidays, now = new Date()) {
  return buildEscalationContext(orders, factories, projects, settings, holidays, now);
}

export function chipRoleLabel(role) {
  if (role === 'admin') return '組合';
  if (role === 'association') return '組合指定';
  if (role === 'assigned') return '受注';
  if (role === 'preferred') return '指定';
  if (role === 'main') return 'メイン';
  if (role === 'sub') return 'サブ';
  return '表示中';
}
