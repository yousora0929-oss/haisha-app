import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as db from '../haishaDb.js';

function mergeTargets(candidates, preferences) {
  const byKey = new Map((candidates || []).map((c) => [db.charterNotificationTargetKey(c), c]));
  const ordered = [];
  const seen = new Set();

  for (const pref of preferences || []) {
    const key = db.charterNotificationTargetKey(pref);
    const hit = byKey.get(key);
    if (hit) {
      ordered.push(hit);
      seen.add(key);
    }
  }

  for (const candidate of candidates || []) {
    const key = db.charterNotificationTargetKey(candidate);
    if (!seen.has(key)) ordered.push(candidate);
  }

  return ordered;
}

function moveItem(list, fromIndex, toIndex) {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) {
    return list;
  }
  const next = [...list];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

function targetTypeBadge(targetType) {
  return targetType === 'charter_operator'
    ? { icon: '🚛', label: 'チャーター業者' }
    : { icon: '🏭', label: '工場' };
}

export function CharterNotificationPreferencesPanel({ factoryId, onSaved }) {
  const [orderedTargets, setOrderedTargets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dragIndexRef = useRef(null);

  const loadData = useCallback(async () => {
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setOrderedTargets([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [candidates, preferences] = await Promise.all([
        db.fetchCharterNotificationTargetsCandidates(fid),
        db.fetchCharterNotificationPreferences(fid),
      ]);
      setOrderedTargets(mergeTargets(candidates, preferences));
    } catch (err) {
      setError(err?.message || '優先順位の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [factoryId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleMoveUp = (index) => {
    if (index <= 0) return;
    setOrderedTargets((list) => moveItem(list, index, index - 1));
  };

  const handleMoveDown = (index) => {
    setOrderedTargets((list) => {
      if (index >= list.length - 1) return list;
      return moveItem(list, index, index + 1);
    });
  };

  const handleDragStart = (index) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (index) => {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from == null || from === index) return;
    setOrderedTargets((list) => moveItem(list, from, index));
  };

  const handleSave = async () => {
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setError('工場IDが未設定です');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.saveCharterNotificationPreferences(fid, orderedTargets);
      await loadData();
      setNotice('通知優先順位を保存しました');
      onSaved?.('通知優先順位を保存しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-black text-slate-900">通知優先順位設定</h2>
      <p className="mt-1 text-sm font-medium text-slate-600">
        チャーター募集時に通知する順番を設定します（上にあるほど先に通知。Phase 3 で送信予定）。
      </p>

      {notice ? <p className="mt-3 text-sm font-bold text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}

      {loading && orderedTargets.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">読み込み中…</p>
      ) : null}

      {!loading && orderedTargets.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          通知先候補がありません（他工場またはチャーター業者を登録してください）
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {orderedTargets.map((target, index) => {
            const badge = targetTypeBadge(target.target_type);
            return (
              <li
                key={db.charterNotificationTargetKey(target)}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={handleDragOver}
                onDrop={() => handleDrop(index)}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 sm:px-3"
              >
                <span
                  className="cursor-grab select-none px-1 text-lg font-black text-slate-400 active:cursor-grabbing"
                  title="ドラッグして並べ替え"
                  aria-hidden
                >
                  ≡
                </span>
                <span className="w-6 shrink-0 text-center text-xs font-black text-slate-500">{index + 1}</span>
                <div className="min-w-0 flex-1">
                  <span className="mr-2 inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black text-slate-600">
                    {badge.icon} {badge.label}
                  </span>
                  <span className="text-sm font-bold text-slate-900">{target.name}</span>
                </div>
                <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0 || saving}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 disabled:opacity-40"
                    aria-label="上へ"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(index)}
                    disabled={index >= orderedTargets.length - 1 || saving}
                    className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 disabled:opacity-40"
                    aria-label="下へ"
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || loading}
        className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </section>
  );
}
