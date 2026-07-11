import React, { useCallback, useEffect, useRef, useState } from 'react';
import * as db from '../haishaDb.js';

function splitTargets(candidates, preferences) {
  const byKey = new Map((candidates || []).map((c) => [db.charterNotificationTargetKey(c), c]));
  const selected = [];
  const selectedKeys = new Set();

  for (const pref of preferences || []) {
    const key = db.charterNotificationTargetKey(pref);
    const hit = byKey.get(key);
    if (hit) {
      selected.push(hit);
      selectedKeys.add(key);
    }
  }

  const excluded = (candidates || []).filter((c) => !selectedKeys.has(db.charterNotificationTargetKey(c)));
  return { selected, excluded };
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
  const [selectedTargets, setSelectedTargets] = useState([]);
  const [excludedTargets, setExcludedTargets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dragIndexRef = useRef(null);

  const loadData = useCallback(async () => {
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setSelectedTargets([]);
      setExcludedTargets([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [candidates, preferences] = await Promise.all([
        db.fetchCharterNotificationTargetsCandidates(fid),
        db.fetchCharterNotificationPreferences(fid),
      ]);
      const { selected, excluded } = splitTargets(candidates, preferences);
      setSelectedTargets(selected);
      setExcludedTargets(excluded);
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
    setSelectedTargets((list) => moveItem(list, index, index - 1));
  };

  const handleMoveDown = (index) => {
    setSelectedTargets((list) => {
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
    setSelectedTargets((list) => moveItem(list, from, index));
  };

  const excludeTarget = (key) => {
    setSelectedTargets((list) => {
      const idx = list.findIndex((t) => db.charterNotificationTargetKey(t) === key);
      if (idx < 0) return list;
      const next = [...list];
      const [item] = next.splice(idx, 1);
      setExcludedTargets((ex) => [...ex, item]);
      return next;
    });
  };

  const includeTarget = (key) => {
    setExcludedTargets((list) => {
      const idx = list.findIndex((t) => db.charterNotificationTargetKey(t) === key);
      if (idx < 0) return list;
      const next = [...list];
      const [item] = next.splice(idx, 1);
      setSelectedTargets((sel) => [...sel, item]);
      return next;
    });
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
      await db.saveCharterNotificationPreferences(fid, selectedTargets);
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

  const emptyAll = !loading && selectedTargets.length === 0 && excludedTargets.length === 0;

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-black text-slate-900">通知優先順位設定</h2>
      <p className="mt-1 text-sm font-medium text-slate-600">
        通知する相手を選び、優先順位を設定します。「通知しない」側には通知が届きません。
      </p>

      {notice ? <p className="mt-3 text-sm font-bold text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}

      {loading && emptyAll ? <p className="mt-4 text-sm text-slate-500">読み込み中…</p> : null}

      {emptyAll ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          通知先候補がありません（他工場またはチャーター業者を登録してください）
        </p>
      ) : (
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <div>
            <h4 className="text-sm font-black text-slate-800">🔔 通知する（優先順位あり）</h4>
            <p className="mt-0.5 text-xs text-slate-500">上にあるほど先に通知されます</p>
            {selectedTargets.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/50 px-3 py-4 text-center text-xs font-medium text-slate-500">
                まだ誰にも通知しません。「通知しない」から追加してください
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {selectedTargets.map((target, index) => {
                  const badge = targetTypeBadge(target.target_type);
                  const key = db.charterNotificationTargetKey(target);
                  return (
                    <li
                      key={key}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(index)}
                      className="flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5"
                    >
                      <span
                        className="cursor-grab select-none px-1 text-lg font-black text-slate-400 active:cursor-grabbing"
                        title="ドラッグして並べ替え"
                        aria-hidden
                      >
                        ≡
                      </span>
                      <span className="w-5 shrink-0 text-center text-xs font-black text-indigo-600">{index + 1}</span>
                      <span className="min-w-0 flex-1 text-sm font-bold text-slate-900">
                        {badge.icon} {target.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0 || saving}
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-black text-slate-700 disabled:opacity-40"
                        aria-label="上へ"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMoveDown(index)}
                        disabled={index >= selectedTargets.length - 1 || saving}
                        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-black text-slate-700 disabled:opacity-40"
                        aria-label="下へ"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => excludeTarget(key)}
                        disabled={saving}
                        className="rounded border border-red-200 bg-white px-2 py-0.5 text-xs font-black text-red-600 hover:bg-red-50 disabled:opacity-40"
                      >
                        除外
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <h4 className="text-sm font-black text-slate-500">🔕 通知しない（候補）</h4>
            <p className="mt-0.5 text-xs text-slate-500">このリストの相手には通知しません</p>
            {excludedTargets.length === 0 ? (
              <p className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs font-medium text-slate-400">
                候補はすべて通知リストに含まれています
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {excludedTargets.map((target) => {
                  const badge = targetTypeBadge(target.target_type);
                  const key = db.charterNotificationTargetKey(target);
                  return (
                    <li
                      key={key}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5"
                    >
                      <span className="min-w-0 flex-1 text-sm text-slate-500">
                        {badge.icon} {target.name}
                      </span>
                      <button
                        type="button"
                        onClick={() => includeTarget(key)}
                        disabled={saving}
                        className="rounded border border-indigo-200 bg-white px-2 py-0.5 text-xs font-black text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
                      >
                        追加
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
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
