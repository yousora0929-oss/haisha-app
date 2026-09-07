import React, { useCallback, useEffect, useState } from 'react';
import { APP_BRAND_NAME } from './constants/brand.js';
import { supabase } from './supabaseClient.js';
import {
  formatMixDesignAcceptedAt,
  isValidMixDesignAcceptToken,
  parseMixDesignAcceptTokenFromPath,
} from './utils/mixDesignAccept.js';

function normalizeRpc(data) {
  if (data == null) return null;
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return typeof data === 'object' && !Array.isArray(data) ? data : null;
}

function invalidState() {
  return { kind: 'invalid' };
}

function alreadyState(acceptedAt) {
  return { kind: 'already', acceptedAt: acceptedAt || null };
}

export function MixDesignAcceptApp() {
  const [state, setState] = useState({ kind: 'loading' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const token = parseMixDesignAcceptTokenFromPath();
    if (!isValidMixDesignAcceptToken(token)) {
      setState(invalidState());
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_mix_design_accept_by_token', { p_token: token });
      if (error) throw error;
      const payload = normalizeRpc(data);
      if (!payload?.ok) {
        setState(invalidState());
        return;
      }
      if (payload.already_accepted) {
        setState(alreadyState(payload.accepted_at));
        return;
      }
      setState({
        kind: 'ready',
        token,
        projectName: String(payload.project_name || '').trim(),
        contractorName: String(payload.contractor_name || '').trim(),
        factoryName: String(payload.factory_name || '').trim(),
        itemCount: Number(payload.item_count) || 0,
        mixLabels: Array.isArray(payload.mix_labels)
          ? payload.mix_labels.map((v) => String(v || '').trim()).filter(Boolean)
          : [],
      });
    } catch (err) {
      console.error('配合計画書の受注確認データの取得に失敗しました', err);
      setState(invalidState());
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAccept = async () => {
    if (state.kind !== 'ready' || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('accept_mix_design_request_factory', {
        p_token: state.token,
      });
      if (error) throw error;
      const payload = normalizeRpc(data);
      if (payload?.ok) {
        setState({ kind: 'success', acceptedAt: payload.accepted_at || null });
        return;
      }
      if (payload?.reason === 'already_accepted') {
        setState(alreadyState(payload.accepted_at));
        return;
      }
      setState(invalidState());
    } catch (err) {
      console.error('配合計画書の受注に失敗しました', err);
      setState({ kind: 'error', message: '受注処理に失敗しました。時間をおいて再度お試しください。' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-100 px-4 py-8 text-slate-900">
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
        <p className="text-xs font-black uppercase tracking-wider text-indigo-700">{APP_BRAND_NAME}</p>
        <h1 className="mt-1 text-xl font-black">配合計画書 受注確認</h1>

        {state.kind === 'loading' ? (
          <p className="mt-6 text-sm font-bold text-slate-500">読み込み中…</p>
        ) : null}

        {state.kind === 'invalid' ? (
          <p className="mt-6 text-sm font-black text-red-700" role="alert">
            無効なURLです
          </p>
        ) : null}

        {state.kind === 'error' ? (
          <p className="mt-6 text-sm font-black text-red-700" role="alert">
            {state.message}
          </p>
        ) : null}

        {state.kind === 'already' ? (
          <p className="mt-6 text-sm font-black text-slate-800" role="status">
            既に受注済みです（受注日時: {formatMixDesignAcceptedAt(state.acceptedAt) || '日時不明'}）
          </p>
        ) : null}

        {state.kind === 'success' ? (
          <p className="mt-6 text-sm font-black text-emerald-800" role="status">
            受注を受け付けました
          </p>
        ) : null}

        {state.kind === 'ready' ? (
          <div className="mt-6">
            <dl className="space-y-2 text-sm font-bold text-slate-700">
              <div>
                <dt className="text-xs font-black text-slate-400">依頼先工場</dt>
                <dd className="mt-0.5 text-slate-900">{state.factoryName || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-black text-slate-400">現場名</dt>
                <dd className="mt-0.5 text-slate-900">{state.projectName || '—'}</dd>
              </div>
              {state.contractorName ? (
                <div>
                  <dt className="text-xs font-black text-slate-400">業者名</dt>
                  <dd className="mt-0.5 text-slate-900">{state.contractorName}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-black text-slate-400">配合パターン数</dt>
                <dd className="mt-0.5 text-slate-900">{state.itemCount}件</dd>
              </div>
            </dl>
            {state.mixLabels.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs font-medium text-slate-600">
                {state.mixLabels.map((label, idx) => (
                  <li key={`${idx}-${label}`}>{label}</li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              onClick={() => void handleAccept()}
              disabled={submitting}
              className="mt-6 min-h-[48px] w-full rounded-xl border-2 border-indigo-600 bg-indigo-600 text-sm font-black text-white disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
            >
              {submitting ? '送信中…' : '受注する'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
