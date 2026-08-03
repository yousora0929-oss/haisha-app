import React from 'react';

export function isPhoneOrder(order) {
  return order?.is_phone_order === true || order?.isPhoneOrder === true;
}

export function PhoneOrderBadge({ order, className = '' }) {
  if (!isPhoneOrder(order)) return null;
  return (
    <span
      className={
        'inline-flex items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black text-sky-800 sm:text-[11px] ' +
        className
      }
    >
      ☎ 電話注文
    </span>
  );
}
