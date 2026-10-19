import React from 'react';

export const BLACKLIST_NOTE = '取引前に組合へ確認してください';

export function readCompanyFlag(value) {
  return value === true || value === 'true' || value === 't' || value === 1;
}

export function CompanyStatusBadges({ isBlacklisted = false, isCounterCash = false, className = '' }) {
  const blacklisted = readCompanyFlag(isBlacklisted);
  const counterCash = readCompanyFlag(isCounterCash);
  if (!blacklisted && !counterCash) return null;
  return (
    <span className={'inline-flex flex-wrap items-center gap-1 ' + className}>
      {blacklisted ? (
        <span className="inline-flex items-center rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-black text-white">
          要確認
        </span>
      ) : null}
      {counterCash ? (
        <span className="inline-flex items-center rounded-full bg-yellow-300 px-2 py-0.5 text-[11px] font-black text-black">
          窓口現金
        </span>
      ) : null}
    </span>
  );
}

export function CompanyBlacklistNote({ isBlacklisted = false, className = '' }) {
  if (!readCompanyFlag(isBlacklisted)) return null;
  return (
    <p className={'text-xs font-bold text-red-800 ' + className}>{BLACKLIST_NOTE}</p>
  );
}
