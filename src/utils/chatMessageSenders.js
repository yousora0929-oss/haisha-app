/** チャット UI の左右配置・表示名用（from フィールド） */

export function normalizeChatFrom(from) {
  return String(from ?? '').trim().toLowerCase();
}

/** カスタマー側（顧客画面では右、工場画面では左） */
export function isCustomerSideChatSender(from) {
  const f = normalizeChatFrom(from);
  return f === 'customer' || f === 'master';
}

/** 工場側（工場画面では右、顧客画面では左） */
export function isFactorySideChatSender(from) {
  return normalizeChatFrom(from) === 'factory';
}

export function isSystemChatSender(from) {
  return normalizeChatFrom(from) === 'system';
}

export function isAdminChatSender(from) {
  return normalizeChatFrom(from) === 'admin';
}

/** 工場画面: 左側（相手）= カスタマー・管理者 */
export function isIncomingSideForFactoryView(from) {
  return isCustomerSideChatSender(from) || isAdminChatSender(from);
}

/** 顧客画面: 右側（自分）= カスタマー送信 */
export function isOutgoingSideForCustomerView(from) {
  return isCustomerSideChatSender(from);
}

export function customerChatDisplayName(from, customerName = '担当者') {
  if (isAdminChatSender(from)) return '管理者';
  if (isCustomerSideChatSender(from)) return customerName || '担当者';
  if (isFactorySideChatSender(from)) return '工場';
  return '担当者';
}

export function factoryChatDisplayName(from, customerName = '担当者', factoryLabel = '工場（この端末）') {
  if (isAdminChatSender(from)) return '管理者';
  if (isCustomerSideChatSender(from)) return customerName || '担当者';
  if (isFactorySideChatSender(from)) return factoryLabel;
  return factoryLabel;
}
