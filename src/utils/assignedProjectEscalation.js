import { associationAssignedFactoryIds } from './associationFactoryAssignment.js';

function normalizeFactoryRefId(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    const nested = value.id ?? value.factory_id ?? value.factoryId;
    if (nested != null && nested !== value) return normalizeFactoryRefId(nested);
    return '';
  }
  const s = String(value).trim();
  if (!s || s === '[object Object]') return '';
  const lower = s.toLowerCase();
  if (lower === 'undefined' || lower === 'null') return '';
  return s;
}

function rejectedFactoryIdSet(order) {
  const direct = Array.isArray(order?.rejected_factory_ids) ? order.rejected_factory_ids : [];
  const fromData = Array.isArray(order?.rejectedFactoryIds) ? order.rejectedFactoryIds : [];
  const source = direct.length ? direct : fromData;
  return new Set(source.map((x) => normalizeFactoryRefId(x)).filter(Boolean));
}

/** 割当物件: is_spot=false, project_id あり, 組合承認プールなし, メインまたはサブ工場が設定済み */
export function isAssignedProject(order, project) {
  if (!order || !project) return false;
  if (Boolean(order.is_spot)) return false;
  const pid = String(order.project_id ?? order.projectId ?? '').trim();
  if (!pid) return false;
  if (associationAssignedFactoryIds(order).length > 0) return false;
  const mainId = normalizeFactoryRefId(project.main_factory_id);
  const subIds = normalizeSubFactoryIds(project.sub_factory_ids);
  return Boolean(mainId) || subIds.length > 0;
}

export function normalizeSubFactoryIds(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => normalizeFactoryRefId(x)).filter(Boolean);
}

export function assignedProjectSubIndex(order) {
  const preferredId = String(order?.preferred_factory_id ?? order?.preferredFactoryId ?? '').trim();
  const declinedAt = order?.preferredFactoryDeclinedAt ?? order?.preferred_factory_declined_at;
  const choice = order?.preferredFactoryChoice ?? order?.preferred_factory_choice;
  // 第一希望が先頭にいる間はサブインデックスを -1（誤って「サブ0」と表示しない）
  if (preferredId && !declinedAt && !choice) {
    return -1;
  }
  const raw = order?.sub_factory_current_index ?? order?.subFactoryCurrentIndex;
  if (raw == null || raw === '') return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : -1;
}

/** 割当物件の順次公開: 対象工場のみ true */
export function isOrderVisibleToAssignedProjectFactory(order, project, factoryId) {
  if (!isAssignedProject(order, project)) return false;
  const status = String(order?.status || 'pending').trim();
  if (status !== 'pending') return false;

  const fid = normalizeFactoryRefId(factoryId);
  if (!fid) return false;

  const preferredId = String(order?.preferred_factory_id ?? order?.preferredFactoryId ?? '').trim();
  const declinedAt = order?.preferredFactoryDeclinedAt ?? order?.preferred_factory_declined_at;
  const choice = order?.preferredFactoryChoice ?? order?.preferred_factory_choice;
  if (preferredId && !declinedAt && !choice) {
    return fid === preferredId;
  }

  const mainId = normalizeFactoryRefId(project.main_factory_id);
  const subIds = normalizeSubFactoryIds(project.sub_factory_ids);
  const rejectedIds = rejectedFactoryIdSet(order);
  const currentSubIndex = assignedProjectSubIndex(order);

  if (mainId && !rejectedIds.has(mainId)) {
    return fid === mainId;
  }
  if (currentSubIndex >= 0 && currentSubIndex < subIds.length) {
    return fid === subIds[currentSubIndex];
  }
  return false;
}

/** 工場拒否後の割当物件ステート遷移パッチ（rejected_factory_ids は別途更新） */
export function computeAssignedProjectRejectUpdates(order, project, factoryId, nowIso = new Date().toISOString()) {
  if (!isAssignedProject(order, project)) return null;

  const fid = normalizeFactoryRefId(factoryId);
  const mainId = normalizeFactoryRefId(project.main_factory_id);
  const subIds = normalizeSubFactoryIds(project.sub_factory_ids);

  if (fid === mainId) {
    if (subIds.length > 0) {
      return {
        sub_factory_current_index: 0,
        sub_factory_notified_at: nowIso,
      };
    }
    return {
      status: 'awaiting_admin_followup',
      admin_followup_started_at: nowIso,
    };
  }

  if (subIds.includes(fid)) {
    const currentIndex = assignedProjectSubIndex(order);
    const baseIndex = currentIndex >= 0 ? currentIndex : subIds.indexOf(fid);
    const nextIndex = baseIndex + 1;
    if (nextIndex < subIds.length) {
      return {
        sub_factory_current_index: nextIndex,
        sub_factory_notified_at: nowIso,
      };
    }
    return {
      status: 'awaiting_admin_followup',
      admin_followup_started_at: nowIso,
    };
  }

  return null;
}

/** サブ工場タイムアウト（応答なし）時: 現サブを拒否扱いにして次へ */
export function computeAssignedProjectSubTimeoutUpdates(order, project, nowIso = new Date().toISOString()) {
  if (!isAssignedProject(order, project)) return null;
  if (String(order?.status || '').trim() !== 'pending') return null;

  const subIds = normalizeSubFactoryIds(project.sub_factory_ids);
  const currentSubIndex = assignedProjectSubIndex(order);
  if (currentSubIndex < 0 || currentSubIndex >= subIds.length) return null;

  const timedOutFactoryId = subIds[currentSubIndex];
  const rejected = [...rejectedFactoryIdSet(order)];
  if (!rejected.includes(timedOutFactoryId)) rejected.push(timedOutFactoryId);

  const nextIndex = currentSubIndex + 1;
  const patch = {
    rejected_factory_ids: rejected,
    rejectedFactoryIds: rejected,
  };

  if (nextIndex < subIds.length) {
    patch.sub_factory_current_index = nextIndex;
    patch.sub_factory_notified_at = nowIso;
  } else {
    patch.status = 'awaiting_admin_followup';
    patch.admin_followup_started_at = nowIso;
  }

  return { patch, timedOutFactoryId };
}

export function assignedProjectCurrentTargetFactoryId(order, project) {
  if (!isAssignedProject(order, project)) return '';

  // 第一希望工場が指定されていて、かつまだ拒否されていない場合は先頭に挿入
  const preferredId = String(
    order?.preferred_factory_id ?? order?.preferredFactoryId ?? '',
  ).trim();
  const declinedAt = order?.preferredFactoryDeclinedAt ?? order?.preferred_factory_declined_at;
  const choice = order?.preferredFactoryChoice ?? order?.preferred_factory_choice;

  if (preferredId && !declinedAt && !choice) {
    return preferredId;
  }

  const mainId = normalizeFactoryRefId(project.main_factory_id);
  const subIds = normalizeSubFactoryIds(project.sub_factory_ids);
  const rejectedIds = rejectedFactoryIdSet(order);
  const currentSubIndex = assignedProjectSubIndex(order);

  if (mainId && !rejectedIds.has(mainId)) return mainId;
  if (currentSubIndex >= 0 && currentSubIndex < subIds.length) return subIds[currentSubIndex];
  return '';
}
