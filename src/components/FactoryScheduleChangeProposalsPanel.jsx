import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';
import { resolveOrderSiteDisplayName } from '../utils/siteNameDisplay.js';
import { orderPartyInfo } from '../utils/orderPartyInfo.js';

function formatChangeLine(change) {
  const field = String(change?.field || '');
  const oldVal = change?.old;
  const newVal = change?.new;
  if (field === 'quantity_m3') {
    return `数量　${oldVal ?? '—'}m³ → ${newVal ?? '—'}m³`;
  }
  if (field === 'delivery_time') {
    return `時間　${oldVal ?? '—'} → ${newVal ?? '—'}`;
  }
  if (field === 'vehicle_type') {
    const label = (v) => {
      const s = String(v || '').toLowerCase();
      if (s === 'small' || s.includes('小型')) return '小型';
      if (s === 'large' || s.includes('大型')) return '大型';
      return v ?? '—';
    };
    return `車両　${label(oldVal)} → ${label(newVal)}`;
  }
  if (field === 'mix_design') {
    return `配合　${oldVal ?? '—'} → ${newVal ?? '—'}`;
  }
  if (field === 'has_test') {
    const label = (v) => (v === true ? '有' : v === false ? '無' : '—');
    return `試験　${label(oldVal)} → ${label(newVal)}`;
  }
  if (field === 'notes') {
    return `備考　${oldVal ?? '—'} → ${newVal ?? '—'}`;
  }
  return `${field}　${oldVal ?? '—'} → ${newVal ?? '—'}`;
}

function orderDateLabel(order) {
  const raw =
    order?.preferredDate ||
    order?.scheduleMatchDate ||
    order?.delivery_date ||
    '';
  return String(raw || '').replace(/-/g, '/') || '—';
}

/**
 * 工場向け：スケジュール取込による予定変更提案一覧
 */
export function FactoryScheduleChangeProposalsPanel({
  factoryId,
  onApplied,
}) {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setProposals([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchPendingOrderChangeProposals(fid);
      setProposals(Array.isArray(rows) ? rows : []);
    } catch (e) {
      console.error(e);
      setError('予定変更の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [factoryId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const fid = String(factoryId || '').trim();
    if (!fid || typeof db.subscribeOrderChangeProposalsRealtime !== 'function') {
      return undefined;
    }
    let timer = null;
    const unsub = db.subscribeOrderChangeProposalsRealtime(fid, () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void reload();
      }, 400);
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      try {
        unsub?.();
      } catch {
        /* ignore */
      }
    };
  }, [factoryId, reload]);

  const handleAccept = async (proposalId) => {
    if (!proposalId || busyId) return;
    if (!window.confirm('この変更内容を承諾し、注文へ反映しますか？')) return;
    setBusyId(proposalId);
    setNotice('');
    try {
      await db.applyOrderChangeProposal(proposalId);
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      setNotice('変更を承諾し、注文へ反映しました');
      onApplied?.();
    } catch (e) {
      console.error(e);
      window.alert('承諾処理に失敗しました。通信状態を確認して再度お試しください。');
    } finally {
      setBusyId('');
    }
  };

  const handleReject = async (proposalId) => {
    if (!proposalId || busyId) return;
    if (
      !window.confirm(
        '内容を確認したいため拒否しますか？\n管理者の確認待ちになります（注文は自動では変わりません）。',
      )
    ) {
      return;
    }
    setBusyId(proposalId);
    setNotice('');
    try {
      await db.rejectOrderChangeProposal(proposalId);
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      setNotice('拒否しました。管理者の確認待ちです。');
    } catch (e) {
      console.error(e);
      window.alert('拒否処理に失敗しました。通信状態を確認して再度お試しください。');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="grid gap-3 py-2 sm:py-4">
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-700 dark:bg-amber-950/40">
        <h2 className="text-lg font-black text-amber-950 dark:text-amber-100">予定変更のお知らせ</h2>
        <p className="mt-1 text-xs font-bold text-amber-900/80 dark:text-amber-200/80">
          スケジュール取込で検出された変更です。「承諾する」で注文へ自動反映されます。
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
          {error}
        </p>
      ) : null}
      {loading ? (
        <p className="text-sm font-bold text-slate-500">読み込み中…</p>
      ) : null}

      {!loading && proposals.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-900">
          現在、対応が必要な予定変更はありません
        </p>
      ) : null}

      <ul className="grid gap-3">
        {proposals.map((proposal) => {
          const order = proposal.order;
          const party = order ? orderPartyInfo(order, { preferSiteContact: true }) : null;
          const siteName = order
            ? resolveOrderSiteDisplayName(order) || party?.site || '現場未設定'
            : '注文情報なし';
          const busy = busyId === proposal.id;
          return (
            <li
              key={proposal.id}
              className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wide text-amber-700">予定変更</p>
                  <p className="mt-1 text-base font-black text-slate-900 dark:text-slate-100">
                    {orderDateLabel(order)}　{siteName}
                  </p>
                  {party?.contractor ? (
                    <p className="mt-0.5 text-sm font-bold text-slate-600 dark:text-slate-300">
                      業者：{party.contractor}
                    </p>
                  ) : null}
                </div>
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white">
                  未応答
                </span>
              </div>

              <ul className="mt-3 space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-800/60">
                {(proposal.proposed_changes || []).map((change, idx) => (
                  <li key={`${proposal.id}-${idx}`} className="text-sm font-black text-slate-800 dark:text-slate-100">
                    {formatChangeLine(change)}
                  </li>
                ))}
                {(proposal.proposed_changes || []).length === 0 ? (
                  <li className="text-sm font-bold text-slate-500">変更詳細なし</li>
                ) : null}
              </ul>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAccept(proposal.id)}
                  className="min-h-[48px] rounded-xl border-2 border-blue-700 bg-blue-600 px-4 text-sm font-black text-white shadow hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {busy ? '処理中…' : '承諾する'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleReject(proposal.id)}
                  className="min-h-[48px] rounded-xl border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100"
                >
                  内容を確認したい（拒否）
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
