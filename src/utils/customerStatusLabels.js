/** 顧客画面・顧客向け通知用の表示文言（DB ステータス値は変更しない） */

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
