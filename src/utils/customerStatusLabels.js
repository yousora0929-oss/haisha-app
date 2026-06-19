/** 顧客画面・顧客向け通知用の表示文言（DB ステータス値は変更しない） */

import { getVisibleFactoryIdsForOrder, isUserSpecifiedPreferredFactory } from './escalationUtils.js';

/** 第一希望工場を指定したときのステータス */
export const CUSTOMER_ORDER_DISPATCH_WAITING_LABEL = '配車待ち';

/** 工場が「保留」を押したときのみ */
export const CUSTOMER_FACTORY_HOLD_LABEL = '保留対応中';

/** @param {number} factoryCount */
export function customerEscalationCheckingLabel(factoryCount) {
  const n = Math.max(1, Math.floor(Number(factoryCount)) || 1);
  return `${n}工場に確認中`;
}

/**
 * 配車待ち・エスカレーション中の顧客向けラベル
 * @param {object|null|undefined} order
 * @param {object|null|undefined} escalationCtx
 */
export function resolveCustomerDispatchWaitingLabel(order, escalationCtx = null) {
  if (isUserSpecifiedPreferredFactory(order)) {
    return CUSTOMER_ORDER_DISPATCH_WAITING_LABEL;
  }
  if (escalationCtx && order) {
    const visible = getVisibleFactoryIdsForOrder(order, escalationCtx);
    if (visible.length > 0) {
      return customerEscalationCheckingLabel(visible.length);
    }
  }
  return CUSTOMER_ORDER_DISPATCH_WAITING_LABEL;
}

/** 工場が明示的に保留（factoryResponseStatus=pending）したか */
export function isFactoryHoldPending(order) {
  return String(order?.factoryResponseStatus || '').trim() === 'pending';
}

/** 注文全体がお受けできなかったときのステータスバッジ */
export const CUSTOMER_ORDER_REJECTED_LABEL = 'お受けできず';

/** 全社対応不可の説明 */
export const CUSTOMER_FULL_REJECTION_MESSAGE = '対応可能な工場が見つかりませんでした';

/** 個別工場が対応できないときの短いラベル（履歴・タイムライン等） */
export const CUSTOMER_FACTORY_UNAVAILABLE_LABEL = '対応困難';

/**
 * 工場が見送ったときのチャット自動メッセージ（顧客向け）
 * @param {string} factoryName
 */
export function customerFactoryRejectionChatMessage(factoryName) {
  const name = String(factoryName || '').trim() || '工場';
  return `【${name}】今回はご対応が難しい状況です`;
}

/**
 * 満車などスケジュール自動応答のチャット本文
 * @param {string} reasonLine - 先頭行（スケジュール理由）
 * @param {string} factoryName
 */
export function customerScheduleAutoRejectChatBody(reasonLine, factoryName) {
  const reason = String(reasonLine || '').trim();
  const soft = customerFactoryRejectionChatMessage(factoryName);
  return reason ? `${reason}\n${soft}` : soft;
}

/**
 * 顧客ダッシュボード通知（全社対応不可）
 */
export function customerFullRejectionDashboardNotice(siteLabel) {
  const site = String(siteLabel || '').trim();
  if (site) {
    return `「${site}」のご注文は${CUSTOMER_FULL_REJECTION_MESSAGE}`;
  }
  return CUSTOMER_FULL_REJECTION_MESSAGE;
}
