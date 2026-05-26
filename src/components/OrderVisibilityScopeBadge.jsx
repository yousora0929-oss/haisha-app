import React from 'react';
import { OrderVisibilityScopePopover } from './OrderVisibilityScopePopover.jsx';

/**
 * 一覧用: 公開範囲の簡易バッジ（クリックで工場一覧）
 */
export function OrderVisibilityScopeBadge(props) {
  return <OrderVisibilityScopePopover {...props} />;
}
