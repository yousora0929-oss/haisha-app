import React, { useEffect, useRef, useState } from 'react';
import * as db from '../haishaDb.js';
import { TIME_SLOTS } from '../haishaConstants.js';
import BillingMark from './BillingMark.jsx';
import { SiteOrderUrlActions } from './SiteOrderUrlActions.jsx';
import {
  resolveOrderPartyDisplay,
  resolveProjectPartyDisplay,
} from '../utils/projectPartyDisplay.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from '../utils/siteNameDisplay.js';
import { buildAgentOrganizationSyncPatch } from '../utils/orderAgentOrganization.js';
import { isValidSiteOrderUrlToken } from '../utils/urlValidation.js';

function unloadDurationLabel(value) {
  const v = String(value || '30');
  if (v === '15') return '15分';
  if (v === '30') return '30分（標準）';
  if (v === '45') return '45分';
  if (v === '60') return '60分（手押し車など時間要）';
  if (v === '95_plus') return '95分以上（要相談）';
  return String(value || '30分（標準）');
}

function vehicleTypeLabel(value) {
  return String(value || '') === 'small' ? '小型' : '大型';
}

/** 商社組織IDを比較用に正規化（未選択は空文字） */
function normalizeAgentOrganizationId(value) {
  if (value == null) return '';
  return String(value).trim();
}

/** 商社の表示名（チャット・サマリー用。判定には使わない） */
function resolveTraderDisplayName(source) {
  if (!source || typeof source !== 'object') return '';
  return String(
    source.traderName ??
      source.trading_company_name ??
      source.projectTradingCompanyName ??
      '',
  ).trim();
}

/**
 * 商社（agent_organization_id）の変更を検出する。
 * 表示名ではなく ID のみで判定し、null/未選択への変更も対象にする。
 */
function hasAgentOrganizationIdChanged(order, patch) {
  if (!patch || typeof patch !== 'object') return false;
  if (!Object.prototype.hasOwnProperty.call(patch, 'agent_organization_id')) return false;
  const before = normalizeAgentOrganizationId(
    order?.agent_organization_id ?? order?.agentOrganizationId,
  );
  const after = normalizeAgentOrganizationId(patch.agent_organization_id);
  return before !== after;
}

/** 変更依頼チャット本文を組み立てる（差分のみ） */
export function buildChangeRequestChatMessage(order, patch) {
  const rows = buildChangeRequestDiffRows(order, patch);
  if (rows.length === 0) return '';
  return `【変更依頼】${rows.map((r) => `${r.label}: ${r.before} → ${r.after}`).join('、')}`;
}

/**
 * 承諾用の構造化パッチ（変更があったフィールドのみ）
 * updateOrderDetails が解釈できるキーだけを含める
 */
export function buildChangeRequestPatch(order, patch) {
  const o = order && typeof order === 'object' ? order : {};
  const p = patch && typeof patch === 'object' ? patch : {};
  const out = {};

  const setIfChanged = (key, before, after) => {
    const b = before == null ? '' : String(before).trim();
    const a = after == null ? '' : String(after).trim();
    if (b === a) return;
    if (typeof after === 'boolean') {
      out[key] = after;
      return;
    }
    // 文字列は trim 後の値を保存（空は空文字のまま）
    if (typeof after === 'string') {
      out[key] = a;
      return;
    }
    out[key] = after;
  };

  setIfChanged('preferredDate', o.preferredDate, p.preferredDate);
  if (
    String(o.timeSlot ?? '').trim() !== String(p.timeSlot ?? '').trim() ||
    String(o.timePointLabel || o.timeSlotLabel || '').trim() !==
      String(p.timePointLabel || p.timeSlotLabel || '').trim()
  ) {
    if (p.timeSlot != null) out.timeSlot = p.timeSlot;
    if (p.timeSlotMinutes != null) out.timeSlotMinutes = p.timeSlotMinutes;
    if (p.timeSlotLabel != null) out.timeSlotLabel = p.timeSlotLabel;
    if (p.timePointLabel != null) out.timePointLabel = p.timePointLabel;
    if (p.scheduleMatchMinutes != null) out.scheduleMatchMinutes = p.scheduleMatchMinutes;
  }
  if (p.preferredDate != null && out.preferredDate !== undefined) {
    out.scheduleMatchDate = p.preferredDate;
  }
  setIfChanged('vehicleType', o.vehicleType, p.vehicleType);
  if (out.vehicleType !== undefined) {
    out.vehicleLabel = p.vehicleLabel ?? (p.vehicleType === 'small' ? '小型' : '大型');
  }
  setIfChanged('quantityM3', o.confirmedQuantityM3 ?? o.quantityM3, p.quantityM3);
  if (
    String(o.unloadDurationMinutes || o.unloadDuration || o.unloadingTime || '').trim() !==
    String(p.unloadDuration || p.unloadDurationMinutes || '').trim()
  ) {
    out.unloadDuration = p.unloadDuration;
    out.unloadDurationMinutes = p.unloadDurationMinutes ?? p.unloadDuration;
    out.unloadDurationLabel = p.unloadDurationLabel;
  }
  setIfChanged('mixText', o.confirmedMixText ?? o.mixText, p.mixText);
  if (out.mixText !== undefined) {
    // 工場承諾時に confirmedMixText へも反映できるよう同値を載せる
    out.confirmedMixText = out.mixText;
  }
  setIfChanged('siteName', o.siteName ?? o.projectName, p.siteName);
  setIfChanged('siteAddress', o.siteAddress, p.siteAddress);
  setIfChanged('sitePhone', o.sitePhone, p.sitePhone);
  setIfChanged('contractorName', o.contractorName, p.contractorName);
  if (Boolean(o.has_test) !== Boolean(p.has_test)) {
    out.has_test = Boolean(p.has_test);
  }

  // 商社: ID 変更、または表示名の変更のどちらかがあればパッチへ含める
  const traderIdChanged = hasAgentOrganizationIdChanged(o, p);
  const beforeTraderName = resolveTraderDisplayName(o);
  const afterTraderName = resolveTraderDisplayName(p);
  const traderNameChanged = beforeTraderName !== afterTraderName;
  if (traderIdChanged || traderNameChanged) {
    if (Object.prototype.hasOwnProperty.call(p, 'agent_organization_id')) {
      const afterId = normalizeAgentOrganizationId(p.agent_organization_id);
      out.agent_organization_id = afterId || null;
    }
    out.traderName = afterTraderName;
    out.trading_company_name = afterTraderName;
    out.projectTradingCompanyName = afterTraderName;
  }
  return out;
}

/** 構造化パッチの簡易日本語サマリー（タブ一覧用） */
export function formatChangeRequestPatchSummary(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return '';
  const labels = {
    preferredDate: '希望日',
    timeSlotLabel: '希望時刻',
    timePointLabel: '希望時刻',
    vehicleLabel: '車種',
    vehicleType: '車種',
    quantityM3: '数量',
    unloadDurationLabel: '荷卸し時間',
    mixText: '配合',
    siteName: '現場名',
    siteAddress: '現場住所',
    sitePhone: '電話番号',
    contractorName: '業者名',
    has_test: '試験体',
    agent_organization_id: '商社',
    traderName: '商社',
    trading_company_name: '商社',
  };
  const parts = [];
  const seen = new Set();
  for (const [key, value] of Object.entries(patch)) {
    const label = labels[key];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    let display = value;
    if (key === 'has_test') display = value ? 'あり' : 'なし';
    if (key === 'vehicleType') display = vehicleTypeLabel(value);
    if (key === 'quantityM3') display = `${value}m³`;
    if (key === 'agent_organization_id') {
      display = resolveTraderDisplayName(patch) || (value ? String(value) : '');
    }
    parts.push(`${label}: ${display == null || display === '' ? '（未設定）' : display}`);
  }
  return parts.join('、');
}

/**
 * 変更点だけを「項目名 / 変更前 / 変更後」の行配列で返す（確認画面・チャット共用）
 * @returns {Array<{ label: string, before: string, after: string }>}
 */
export function buildChangeRequestDiffRows(order, patch) {
  const o = order && typeof order === 'object' ? order : {};
  const p = patch && typeof patch === 'object' ? patch : {};
  const fields = [
    {
      label: '希望日',
      before: String(o.preferredDate ?? '').trim(),
      after: String(p.preferredDate ?? '').trim(),
    },
    {
      label: '希望時刻',
      before: String(o.timePointLabel || o.timeSlotLabel || '').trim(),
      after: String(p.timePointLabel || p.timeSlotLabel || '').trim(),
    },
    {
      label: '車種',
      before: vehicleTypeLabel(o.vehicleType),
      after: vehicleTypeLabel(p.vehicleType),
    },
    {
      label: '数量',
      before: String(o.confirmedQuantityM3 ?? o.quantityM3 ?? '').trim(),
      after: String(p.quantityM3 ?? '').trim(),
      suffix: 'm³',
    },
    {
      label: '荷卸し時間',
      before: unloadDurationLabel(o.unloadDurationMinutes || o.unloadDuration || o.unloadingTime),
      after: unloadDurationLabel(p.unloadDuration || p.unloadDurationMinutes),
    },
    {
      label: '配合',
      before: String(o.confirmedMixText ?? o.mixText ?? '').trim(),
      after: String(p.mixText ?? '').trim(),
    },
    {
      label: '現場名',
      before: String(o.siteName ?? o.projectName ?? '').trim(),
      after: String(p.siteName ?? '').trim(),
    },
    {
      label: '現場住所',
      before: String(o.siteAddress ?? '').trim(),
      after: String(p.siteAddress ?? '').trim(),
    },
    {
      label: '電話番号',
      before: String(o.sitePhone ?? '').trim(),
      after: String(p.sitePhone ?? '').trim(),
    },
    {
      label: '業者名',
      before: String(o.contractorName ?? '').trim(),
      after: String(p.contractorName ?? '').trim(),
    },
    {
      label: '試験体',
      before: o.has_test ? 'あり' : 'なし',
      after: p.has_test ? 'あり' : 'なし',
    },
  ];
  const rows = [];
  for (const f of fields) {
    if (f.before === f.after || (!f.before && !f.after)) continue;
    const suffix = f.suffix ?? '';
    rows.push({
      label: f.label,
      before: f.before ? `${f.before}${suffix}` : '（未設定）',
      after: f.after ? `${f.after}${suffix}` : '（未設定）',
    });
  }

  // 商社: ID または表示名の変更を検出（チャットと structuredPatch を一致させる）
  const traderIdChanged = hasAgentOrganizationIdChanged(o, p);
  const beforeTraderName = resolveTraderDisplayName(o);
  const afterTraderName = resolveTraderDisplayName(p);
  if (traderIdChanged || beforeTraderName !== afterTraderName) {
    rows.push({
      label: '商社',
      before: beforeTraderName || '（未設定）',
      after: afterTraderName || '（未設定）',
    });
  }
  return rows;
}

function resolveSiteUrlToken(order, projectById, customerById) {
  const pid = String(order?.project_id ?? order?.projectId ?? '').trim();
  const cid = String(order?.customer_id ?? order?.customerId ?? '').trim();
  const project = pid ? projectById?.[pid] : null;
  const customer = cid ? customerById?.[cid] : null;
  const fromProject = String(project?.url_token ?? '').trim();
  if (isValidSiteOrderUrlToken(fromProject)) return fromProject;
  const fromCustomer = String(customer?.url_token ?? '').trim();
  if (isValidSiteOrderUrlToken(fromCustomer)) return fromCustomer;
  const fromOrder = String(order?.url_token ?? order?.urlToken ?? '').trim();
  return isValidSiteOrderUrlToken(fromOrder) ? fromOrder : '';
}

/**
 * 確定前〜受注後の注文内容編集モーダル（顧客 / 工場 / 管理者で共通）
 * @param {'customer'|'factory'|'admin'} editorRole
 * @param {'edit'|'request'} mode - customer の確定後変更依頼は mode="request"
 */
export function OrderFullEditModal({
  order,
  open,
  onClose,
  onSave,
  projectById,
  customerById,
  onSiteUrlCopied,
  editorRole = 'factory',
  mode = 'edit',
}) {
  const isCustomer = editorRole === 'customer';
  const isRequestMode = isCustomer && mode === 'request';
  const showSiteUrlActions = !isCustomer;
  const titleId = isCustomer
    ? isRequestMode
      ? 'customer-order-request-title'
      : 'customer-order-edit-title'
    : 'factory-order-edit-title';

  const [editData, setEditData] = useState({
    preferredDate: '',
    timeSlot: String(TIME_SLOTS[0]?.value ?? '480'),
    vehicleType: 'large',
    quantityM3: '',
    unloadDuration: '30',
    agentOrganizationId: '',
    traderName: '',
    contractorName: '',
    siteName: '',
    siteAddress: '',
    sitePhone: '',
    mixText: '',
    hasTest: false,
  });
  const [agentOrganizations, setAgentOrganizations] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState('');
  /** 依頼モードのみ: 'edit' | 'confirm' */
  const [requestStep, setRequestStep] = useState('edit');
  const [confirmDiffRows, setConfirmDiffRows] = useState([]);
  const [confirmPayload, setConfirmPayload] = useState(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) return;
    submittingRef.current = false;
    setSubmitting(false);
    setSaveError('');
    setRequestStep('edit');
    setConfirmDiffRows([]);
    setConfirmPayload(null);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const orgs = await db.fetchOrganizations();
        if (cancelled) return;
        setAgentOrganizations(
          (Array.isArray(orgs) ? orgs : []).filter((o) => o && String(o.type) === 'agent' && o.id),
        );
      } catch (e) {
        console.warn('[OrderFullEditModal] agent organizations load failed', e);
        if (!cancelled) setAgentOrganizations([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!order || !open) return;
    const ts = order.timeSlot != null ? String(order.timeSlot) : '';
    const ok = TIME_SLOTS.some((s) => s.value === ts);
    const q = order.confirmedQuantityM3 ?? order.quantityM3 ?? order.quantityCube;
    const projectId = String(order?.project_id ?? order?.projectId ?? '').trim();
    const linkedProject = projectId ? projectById?.[projectId] : null;
    const linkedCustomerId = String(
      linkedProject?.customer_id ?? order?.customer_id ?? order?.customerId ?? '',
    ).trim();
    const linkedCustomer =
      (linkedCustomerId ? customerById?.[linkedCustomerId] : null) ?? null;
    const contractorCustomerId = String(
      order?.contractor_customer_id ?? order?.contractorCustomerId ?? '',
    ).trim();
    const contractorCustomer =
      (contractorCustomerId ? customerById?.[contractorCustomerId] : null) ?? null;
    const partyDisplay = resolveOrderPartyDisplay(order, {
      project: linkedProject,
      customer: linkedCustomer,
      contractorCustomer,
    });
    const explicitTrader = order.traderName != null ? String(order.traderName).trim() : '';
    const explicitContractor =
      order.contractorName != null ? String(order.contractorName).trim() : '';
    const agentId =
      order.agent_organization_id != null ? String(order.agent_organization_id).trim() : '';
    const mixInitial = String(order.confirmedMixText ?? order.mixText ?? '').trim();
    setEditData({
      preferredDate:
        order.preferredDate && typeof order.preferredDate === 'string' ? order.preferredDate : '',
      timeSlot: ok ? ts : String(TIME_SLOTS[0]?.value ?? '480'),
      vehicleType: order.vehicleType === 'small' ? 'small' : 'large',
      quantityM3: q != null && String(q).trim() !== '' && String(q) !== 'null' ? String(q) : '',
      unloadDuration: String(
        order.unloadDurationMinutes || order.unloadDuration || order.unloadingTime || '30',
      ),
      agentOrganizationId: agentId,
      traderName: explicitTrader || (partyDisplay.trader !== '—' ? partyDisplay.trader : ''),
      contractorName:
        explicitContractor || (partyDisplay.prime !== '—' ? partyDisplay.prime : ''),
      siteName:
        sanitizeSiteNameValue(order.siteName) || sanitizeSiteNameValue(order.projectName) || '',
      siteAddress: order.siteAddress != null ? String(order.siteAddress) : '',
      sitePhone: order.sitePhone != null ? String(order.sitePhone) : '',
      mixText: mixInitial,
      hasTest: Boolean(order.has_test),
    });
    setSaveError('');
    setRequestStep('edit');
    setConfirmDiffRows([]);
    setConfirmPayload(null);
  }, [order?.id, open, projectById, customerById]);

  if (!open || !order) return null;

  const projectId = String(order?.project_id ?? order?.projectId ?? '').trim();
  const linkedProject = projectId ? projectById?.[projectId] : null;
  const linkedCustomerId = String(
    linkedProject?.customer_id ?? order?.customer_id ?? order?.customerId ?? '',
  ).trim();
  const linkedCustomer =
    (linkedCustomerId ? customerById?.[linkedCustomerId] : null) ?? null;
  const projectPartyDisplay = linkedProject
    ? resolveProjectPartyDisplay(linkedProject, linkedCustomer)
    : null;
  const fieldLabel = 'mb-1 block text-sm font-bold text-slate-600 dark:text-slate-300 sm:text-base';
  const fieldInput =
    'box-border mt-1 min-h-[48px] w-full min-w-0 max-w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 sm:text-lg';
  // iOS Safari の type=date はネイティブUI幅＋パディングではみ出しやすい
  const fieldDateInput =
    fieldInput +
    ' appearance-none px-2.5 text-[16px] leading-normal sm:px-3 sm:text-lg [-webkit-appearance:none]';

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setEditData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };
  const setEditField = (name, value) => {
    setEditData((prev) => ({ ...prev, [name]: value }));
  };
  const handleAgentChange = (e) => {
    const nextId = e.target.value;
    const sync = buildAgentOrganizationSyncPatch(nextId || null, agentOrganizations);
    setEditData((prev) => ({
      ...prev,
      agentOrganizationId: nextId,
      traderName: sync.traderName,
    }));
  };

  const buildFormPatch = () => {
    const slotMeta = TIME_SLOTS.find((s) => s.value === editData.timeSlot);
    const timeMinutes = parseInt(editData.timeSlot, 10);
    const slotLabel = slotMeta?.label ?? '';
    const agentSync = buildAgentOrganizationSyncPatch(
      editData.agentOrganizationId || null,
      agentOrganizations,
    );
    return {
      preferredDate: editData.preferredDate,
      timeSlot: editData.timeSlot,
      timeSlotMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
      timeSlotLabel: slotLabel,
      timePointLabel: slotLabel,
      scheduleMatchDate: editData.preferredDate,
      scheduleMatchMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
      vehicleType: editData.vehicleType,
      vehicleLabel: editData.vehicleType === 'large' ? '大型' : '小型',
      quantityM3: editData.quantityM3.trim(),
      unloadDuration: editData.unloadDuration,
      unloadDurationMinutes: editData.unloadDuration,
      unloadDurationLabel: unloadDurationLabel(editData.unloadDuration),
      contractorName: editData.contractorName.trim(),
      siteName: sanitizeSiteNameValue(editData.siteName),
      siteAddress: editData.siteAddress.trim(),
      sitePhone: editData.sitePhone.trim(),
      mixText: editData.mixText.trim(),
      has_test: editData.hasTest,
      ...agentSync,
    };
  };

  const handleBackToEdit = () => {
    if (submittingRef.current) return;
    setSaveError('');
    setRequestStep('edit');
    setConfirmDiffRows([]);
    setConfirmPayload(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setSaveError('');

    // 依頼モード・入力画面: 送信せず確認画面へ
    if (isRequestMode && requestStep === 'edit') {
      const patch = buildFormPatch();
      const structuredPatch = buildChangeRequestPatch(order, patch);
      const diffRows = buildChangeRequestDiffRows(order, patch);
      if (diffRows.length === 0 || Object.keys(structuredPatch).length === 0) {
        setSaveError('変更点がありません。項目を変更してから確認してください。');
        return;
      }
      const message = buildChangeRequestChatMessage(order, patch);
      setConfirmDiffRows(diffRows);
      setConfirmPayload({ patch, structuredPatch, message });
      setRequestStep('confirm');
      return;
    }

    // 依頼モード・確認画面からの送信は専用ボタンで行う
    if (isRequestMode && requestStep === 'confirm') {
      return;
    }

    const patch = buildFormPatch();
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ok = await onSave(order.id, patch);
      if (ok === false) {
        setSaveError('保存に失敗しました。内容を確認して再度お試しください。');
      }
    } catch (err) {
      console.error('[OrderFullEditModal] save failed', err);
      setSaveError(err?.message || '保存に失敗しました。通信状態を確認してください。');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleConfirmSend = async () => {
    if (!isRequestMode || requestStep !== 'confirm') return;
    if (submittingRef.current) return;
    if (!confirmPayload?.structuredPatch || !confirmPayload?.message) {
      setSaveError('変更点がありません。戻って内容を確認してください。');
      return;
    }
    setSaveError('');
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const ok = await onSave(order.id, confirmPayload.patch, {
        mode: 'request',
        message: confirmPayload.message,
        structuredPatch: confirmPayload.structuredPatch,
      });
      if (ok === false) {
        setSaveError('変更依頼の送信に失敗しました。通信状態を確認してください。');
      }
    } catch (err) {
      console.error('[OrderFullEditModal] change request send failed', err);
      setSaveError(
        err?.message || '変更依頼の送信に失敗しました。通信状態を確認してください。',
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const isConfirmStep = isRequestMode && requestStep === 'confirm';

  return (
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center bg-black bg-opacity-50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 id={titleId} className="text-lg font-black text-slate-900 sm:text-xl">
            {isRequestMode
              ? isConfirmStep
                ? '変更内容の確認'
                : '変更依頼'
              : '注文内容の編集'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-100 disabled:opacity-60 sm:text-base"
          >
            閉じる
          </button>
        </div>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="min-h-0 flex-1 overflow-y-auto pr-2 px-4 py-4">
            {isConfirmStep ? (
              <div className="space-y-3">
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                  以下の変更点だけが工場・管理者へ送信されます。内容を確認してから送信してください。
                </p>
                <ul className="space-y-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-3">
                  {confirmDiffRows.map((row) => (
                    <li
                      key={row.label}
                      className="rounded-lg border border-indigo-100 bg-white px-3 py-2.5 shadow-sm"
                    >
                      <p className="text-xs font-black uppercase tracking-wider text-slate-500">
                        {row.label}
                      </p>
                      <p className="mt-1 break-words text-sm font-black text-slate-900 sm:text-base">
                        <span className="text-slate-600">{row.before}</span>
                        <span className="mx-1.5 text-indigo-600" aria-hidden="true">
                          →
                        </span>
                        <span className="text-indigo-900">{row.after}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
            {isRequestMode ? (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                受注済みの注文です。ここで入力した内容は直接反映されず、工場・管理者への「変更依頼」としてチャットに送信されます。
              </p>
            ) : isCustomer ? (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                工場が受注する前の注文です。変更内容は工場側に通知されます。
              </p>
            ) : null}
            <section className="min-w-0 space-y-4 overflow-hidden rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3 shadow-inner dark:bg-indigo-950/40">
              <div className="min-w-0">
                <label className={fieldLabel} htmlFor="foe-date">
                  日付（納入日）
                </label>
                <input
                  id="foe-date"
                  name="preferredDate"
                  type="date"
                  value={editData.preferredDate}
                  onChange={handleInputChange}
                  className={fieldDateInput}
                  required
                />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="foe-slot">
                  時間（出荷時間）
                </label>
                <select
                  id="foe-slot"
                  name="timeSlot"
                  value={editData.timeSlot}
                  onChange={handleInputChange}
                  className={fieldInput}
                >
                  {TIME_SLOTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabel} htmlFor="foe-unload-duration">
                  1台あたりの荷卸し（車返却）予定時間
                </label>
                <select
                  id="foe-unload-duration"
                  name="unloadDuration"
                  value={editData.unloadDuration}
                  onChange={handleInputChange}
                  className={fieldInput}
                >
                  <option value="15">15分</option>
                  <option value="30">30分（標準）</option>
                  <option value="45">45分</option>
                  <option value="60">60分（手押し車など時間要）</option>
                  <option value="95_plus">95分以上（要相談）</option>
                </select>
              </div>
              <div>
                <span className={fieldLabel}>車両（車種）</span>
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setEditField('vehicleType', 'large')}
                    className={
                      'min-h-[48px] flex-1 rounded-lg border-2 text-base font-black sm:text-lg ' +
                      (editData.vehicleType === 'large'
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50')
                    }
                  >
                    大型
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditField('vehicleType', 'small')}
                    className={
                      'min-h-[48px] flex-1 rounded-lg border-2 text-base font-black sm:text-lg ' +
                      (editData.vehicleType === 'small'
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50')
                    }
                  >
                    小型
                  </button>
                </div>
              </div>
              <div>
                <label className={fieldLabel} htmlFor="foe-qty">
                  数量（m³）
                </label>
                <input
                  id="foe-qty"
                  name="quantityM3"
                  type="text"
                  inputMode="decimal"
                  value={editData.quantityM3}
                  onChange={handleInputChange}
                  className={fieldInput}
                />
              </div>
              <div className="rounded-lg border-2 border-indigo-200 bg-white px-3 py-3">
                <label className="flex cursor-pointer items-start gap-3" htmlFor="foe-has-test">
                  <input
                    id="foe-has-test"
                    name="hasTest"
                    type="checkbox"
                    checked={editData.hasTest}
                    onChange={handleInputChange}
                    className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="min-w-0 text-sm font-bold text-slate-800 sm:text-base">
                    試験の有無（試験あり）
                    <span className="mt-1 block text-xs font-medium text-slate-500">
                      未チェックは試験なしとして保存されます。
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <section className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">物件基本情報</p>
              {projectPartyDisplay ? (
                <dl className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <div>
                    <dt className="font-bold text-slate-500">業者（元請）</dt>
                    <dd className="font-black text-slate-900">
                      {projectPartyDisplay.prime}
                      {projectPartyDisplay.billOnPrime ? <BillingMark /> : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-500">下請</dt>
                    <dd className="font-black text-slate-900">
                      {projectPartyDisplay.sub}
                      {projectPartyDisplay.billOnSub ? <BillingMark /> : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-bold text-slate-500">商社</dt>
                    <dd className="font-black text-slate-900">{projectPartyDisplay.trader}</dd>
                  </div>
                </dl>
              ) : null}
              <div>
                <label className={fieldLabel} htmlFor="foe-contractor">
                  業者名
                </label>
                <input
                  id="foe-contractor"
                  name="contractorName"
                  type="text"
                  value={editData.contractorName}
                  onChange={handleInputChange}
                  className={fieldInput}
                />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="foe-trader">
                  商社
                </label>
                <select
                  id="foe-trader"
                  name="agentOrganizationId"
                  value={editData.agentOrganizationId}
                  onChange={handleAgentChange}
                  className={fieldInput}
                >
                  <option value="">商社なし（直接請求）</option>
                  {agentOrganizations.map((org) => (
                    <option key={org.id} value={String(org.id)}>
                      {org.name || org.id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={fieldLabel} htmlFor="foe-site">
                  現場名
                </label>
                <input
                  id="foe-site"
                  name="siteName"
                  type="text"
                  value={editData.siteName}
                  onChange={handleInputChange}
                  className={fieldInput}
                  placeholder="例：〇〇ビル新築工事"
                />
                {showSiteUrlActions ? (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                    <p className="text-[10px] font-bold text-slate-500">専用発注URL（現場名とは別）</p>
                    <SiteOrderUrlActions
                      urlToken={resolveSiteUrlToken(order, projectById, customerById)}
                      siteName={editData.siteName || resolveOrderSiteDisplayName(order)}
                      customerName={
                        customerById?.[String(order?.customer_id ?? order?.customerId ?? '')]
                          ?.company_name || editData.contractorName
                      }
                      traderName={editData.traderName}
                      project={projectById?.[String(order?.project_id ?? order?.projectId ?? '')]}
                      customer={customerById?.[String(order?.customer_id ?? order?.customerId ?? '')]}
                      onCopied={onSiteUrlCopied}
                      compact
                    />
                  </div>
                ) : null}
              </div>
              <div>
                <label className={fieldLabel} htmlFor="foe-addr">
                  現場住所
                </label>
                <input
                  id="foe-addr"
                  name="siteAddress"
                  type="text"
                  value={editData.siteAddress}
                  onChange={handleInputChange}
                  className={fieldInput}
                />
              </div>
            </section>

            <section className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500">補足情報</p>
              <div>
                <label className={fieldLabel} htmlFor="foe-phone">
                  電話番号
                </label>
                <input
                  id="foe-phone"
                  name="sitePhone"
                  type="text"
                  value={editData.sitePhone}
                  onChange={handleInputChange}
                  className={fieldInput}
                />
              </div>
              <div>
                <label className={fieldLabel} htmlFor="foe-mix">
                  配合
                </label>
                <input
                  id="foe-mix"
                  name="mixText"
                  type="text"
                  value={editData.mixText}
                  onChange={handleInputChange}
                  className={fieldInput}
                />
              </div>
            </section>
              </>
            )}
          </div>
          {saveError ? (
            <p
              className="mx-4 mb-1 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800"
              role="alert"
            >
              {saveError}
            </p>
          ) : null}
          <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row">
            {isConfirmStep ? (
              <>
                <button
                  type="button"
                  onClick={handleBackToEdit}
                  disabled={submitting}
                  className="min-h-[52px] flex-1 rounded-xl border-2 border-slate-300 bg-white text-base font-black text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg"
                >
                  戻る
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmSend()}
                  disabled={submitting}
                  aria-busy={submitting}
                  className="min-h-[52px] flex-1 rounded-xl border-2 border-indigo-700 bg-indigo-600 text-base font-black text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg"
                >
                  {submitting ? '送信中…' : 'この内容で変更依頼を送信'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="min-h-[52px] flex-1 rounded-xl border-2 border-slate-300 bg-white text-base font-black text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  aria-busy={submitting}
                  className="min-h-[52px] flex-1 rounded-xl border-2 border-indigo-700 bg-indigo-600 text-base font-black text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60 sm:text-lg"
                >
                  {submitting
                    ? '保存中…'
                    : isRequestMode
                      ? '確認'
                      : '保存'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/** 顧客が確定前注文を再編集できるか（工場未受注の pending 系のみ） */
export function isPreAcceptOrderEditable(order) {
  if (!order?.id) return false;
  const status = String(order.status || 'pending').trim() || 'pending';
  if (
    status === 'accepted' ||
    status === 'completed' ||
    status === 'customer_cancelled' ||
    status === 'cancelled' ||
    status === 'rejected'
  ) {
    return false;
  }
  if (String(order.factoryResponseStatus || '').trim() === 'accepted') return false;
  return status === 'pending' || status === 'pending_association';
}

/** 確定後（受注済み）の注文に変更依頼を出せるか */
export function isAcceptedOrderChangeRequestable(order) {
  if (!order?.id) return false;
  const status = String(order.status || 'pending').trim() || 'pending';
  if (
    status === 'customer_cancelled' ||
    status === 'cancelled' ||
    status === 'rejected' ||
    status === 'completed'
  ) {
    return false;
  }
  if (status === 'accepted') return true;
  if (String(order.factory_site_id || order.factorySiteId || '').trim()) return true;
  if (String(order.factoryResponseStatus || '').trim() === 'accepted') return true;
  return false;
}

export default OrderFullEditModal;
