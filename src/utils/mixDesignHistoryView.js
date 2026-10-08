import {
  MIX_DESIGN_STATUS_LABELS,
  MIX_DESIGN_STATUS_VALUES,
  mixDesignStatusLabel,
} from './mixDesignRequest.js';

/** 作成中までの作業中。完成・提出済みは「終わったもの」。 */
const DONE_STATUS_INDEX = MIX_DESIGN_STATUS_VALUES.indexOf('completed');

export const MIX_DESIGN_HISTORY_TAB_IDS = ['active', 'done', 'all'];

export const MIX_DESIGN_HISTORY_TABS = [
  { id: 'active', label: '進行中' },
  { id: 'done', label: '完了' },
  { id: 'all', label: 'すべて' },
];

const STATUS_BADGE_CLASS = {
  not_started: 'border-amber-400 bg-amber-100 text-amber-950',
  requested: 'border-rose-400 bg-rose-100 text-rose-950',
  in_progress: 'border-sky-400 bg-sky-100 text-sky-950',
  completed: 'border-emerald-400 bg-emerald-100 text-emerald-950',
  submitted: 'border-violet-400 bg-violet-100 text-violet-950',
};

export function isMixDesignHistoryDone(status) {
  const key = String(status || '').trim();
  const index = MIX_DESIGN_STATUS_VALUES.indexOf(key);
  return DONE_STATUS_INDEX >= 0 && index >= DONE_STATUS_INDEX;
}

/** 保留中・依頼中は確認が必要な見出し。作成中は通常。 */
export function mixDesignHistoryNeedsAttention(status) {
  const key = String(status || '').trim();
  if (isMixDesignHistoryDone(key) || key === 'in_progress') return false;
  return key === 'not_started' || key === 'requested' || !MIX_DESIGN_STATUS_LABELS[key];
}

export function mixDesignStatusBadgeClass(status) {
  return STATUS_BADGE_CLASS[String(status || '').trim()] || 'border-slate-300 bg-slate-100 text-slate-800';
}

export function mixDesignHistoryTabCounts(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let done = 0;
  for (const row of list) {
    if (isMixDesignHistoryDone(row?.status)) done += 1;
  }
  return { active: list.length - done, done, all: list.length };
}

export function filterMixDesignHistoryRows(rows, tab) {
  const list = Array.isArray(rows) ? rows : [];
  if (tab === 'done') return list.filter((row) => isMixDesignHistoryDone(row?.status));
  if (tab === 'all') return list.slice();
  return list.filter((row) => !isMixDesignHistoryDone(row?.status));
}

function compareRequestedAtDesc(a, b) {
  return String(b?.created_at || '').localeCompare(String(a?.created_at || ''));
}

/**
 * 進行中タブ用。既存ステータス順のセクション。0件は含めない。
 * @returns {{ status: string, label: string, count: number, attention: boolean, rows: object[] }[]}
 */
export function groupActiveMixDesignHistory(rows) {
  const list = filterMixDesignHistoryRows(rows, 'active');
  const byStatus = new Map();
  for (const row of list) {
    const key = String(row?.status || '').trim() || 'unknown';
    if (!byStatus.has(key)) byStatus.set(key, []);
    byStatus.get(key).push(row);
  }
  const sections = [];
  const push = (status, items) => {
    if (!items?.length) return;
    sections.push({
      status,
      label: mixDesignStatusLabel(status),
      count: items.length,
      attention: mixDesignHistoryNeedsAttention(status),
      rows: [...items].sort(compareRequestedAtDesc),
    });
  };
  for (const status of MIX_DESIGN_STATUS_VALUES) {
    if (isMixDesignHistoryDone(status)) continue;
    push(status, byStatus.get(status));
    byStatus.delete(status);
  }
  for (const [status, items] of byStatus) push(status, items);
  return sections;
}
