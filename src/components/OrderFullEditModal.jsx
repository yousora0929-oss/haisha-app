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
}) {
  const isCustomer = editorRole === 'customer';
  const showSiteUrlActions = !isCustomer;
  const titleId = isCustomer ? 'customer-order-edit-title' : 'factory-order-edit-title';

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
  const submittingRef = useRef(false);

  useEffect(() => {
    if (open) return;
    submittingRef.current = false;
    setSubmitting(false);
    setSaveError('');
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
    const q = order.quantityM3 ?? order.quantityCube;
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
      mixText: order.mixText != null ? String(order.mixText) : '',
      hasTest: Boolean(order.has_test),
    });
    setSaveError('');
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
    'mt-1 min-h-[48px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 sm:text-lg';

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    setSaveError('');
    const slotMeta = TIME_SLOTS.find((s) => s.value === editData.timeSlot);
    const timeMinutes = parseInt(editData.timeSlot, 10);
    const slotLabel = slotMeta?.label ?? '';
    const agentSync = buildAgentOrganizationSyncPatch(
      editData.agentOrganizationId || null,
      agentOrganizations,
    );
    const patch = {
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
            {isCustomer ? '注文内容の編集' : '注文内容の編集'}
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
            {isCustomer ? (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                工場が受注する前の注文です。変更内容は工場側に通知されます。
              </p>
            ) : null}
            <section className="space-y-4 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3 shadow-inner dark:bg-indigo-950/40">
              <div>
                <label className={fieldLabel} htmlFor="foe-date">
                  日付（納入日）
                </label>
                <input
                  id="foe-date"
                  name="preferredDate"
                  type="date"
                  value={editData.preferredDate}
                  onChange={handleInputChange}
                  className={fieldInput}
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
              {submitting ? '保存中…' : '保存'}
            </button>
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

export default OrderFullEditModal;
