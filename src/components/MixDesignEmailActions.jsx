import React, { useEffect, useMemo, useState } from 'react';
import { parseRequesterDisplay } from '../utils/mixDesignRequest.js';
import {
  buildMixDesignEmailFactoryOptions,
  buildMixDesignFactoryMail,
  buildMixDesignMailto,
  formatMixDesignAcceptedAt,
  mixDesignMailtoIsTooLong,
} from '../utils/mixDesignAccept.js';

async function copyText(value) {
  const text = String(value ?? '');
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  if (typeof document === 'undefined') {
    throw new Error('コピーに対応していません');
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
}

/**
 * 印刷・詳細画面用。工場ごとの受注URL付きメール本文をコピー / mailto 起動する。
 */
export function MixDesignEmailActions({
  factoryLinks = [],
  factories = [],
  header = {},
}) {
  const options = useMemo(
    () => buildMixDesignEmailFactoryOptions(factoryLinks, factories),
    [factoryLinks, factories],
  );
  const [selectedId, setSelectedId] = useState('');
  const [copied, setCopied] = useState('');
  const [copyError, setCopyError] = useState('');

  useEffect(() => {
    if (!options.length) {
      setSelectedId('');
      return;
    }
    if (!options.some((opt) => opt.factoryId === selectedId)) {
      setSelectedId(options[0].factoryId);
    }
  }, [options, selectedId]);

  const selected = options.find((opt) => opt.factoryId === selectedId) || options[0] || null;
  const parsedRequester = parseRequesterDisplay(header?.requestedBy);
  const mail = selected
    ? buildMixDesignFactoryMail({
        factoryName: selected.factoryName,
        projectName: header?.projectName,
        contractorName: header?.contractorName,
        requesterName: parsedRequester.name,
        requesterAffiliation: header?.requestedByAffiliation || parsedRequester.affiliation,
        acceptUrl: selected.acceptUrl,
      })
    : { subject: '', body: '' };
  const mailto = selected
    ? buildMixDesignMailto({
        to: selected.email,
        subject: mail.subject,
        body: mail.body,
      })
    : 'mailto:';
  const mailtoTooLong = mixDesignMailtoIsTooLong(mailto);

  const markCopied = (key) => {
    setCopied(key);
    setCopyError('');
    window.setTimeout(() => {
      setCopied((cur) => (cur === key ? '' : cur));
    }, 1600);
  };

  const handleCopy = async (key, value) => {
    try {
      await copyText(value);
      markCopied(key);
    } catch (err) {
      console.error('メール本文のコピーに失敗しました', err);
      setCopyError('コピーに失敗しました。手動で選択してコピーしてください。');
    }
  };

  if (!options.length) {
    return (
      <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 print:hidden">
        <h4 className="text-sm font-black text-amber-950">工場へ送るメール</h4>
        <p className="mt-2 text-xs font-medium leading-relaxed text-amber-800">
          受注用URLがまだ発行されていません。依頼を保存し直すか、時間をおいて印刷画面を開き直してください。
        </p>
      </section>
    );
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4 print:hidden">
      <h4 className="text-sm font-black text-slate-900">工場へ送るメール</h4>
      <p className="mt-1 text-xs font-medium leading-relaxed text-slate-500">
        工場ごとに受注用URLが異なります。PDFをダウンロードしてメールに添付し、本文をコピーして送ってください。
      </p>

      {options.length > 1 ? (
        <label className="mt-3 block text-xs font-black text-slate-600">
          依頼先工場
          <select
            value={selected?.factoryId || ''}
            onChange={(e) => setSelectedId(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900"
          >
            {options.map((opt) => (
              <option key={opt.factoryId} value={opt.factoryId}>
                {opt.factoryName}
                {opt.acceptedAt ? '（受注済み）' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="mt-3 text-sm font-black text-slate-800">{selected?.factoryName}</p>
      )}

      {selected?.acceptedAt ? (
        <p className="mt-2 text-xs font-bold text-emerald-800">
          この工場は受注済みです（{formatMixDesignAcceptedAt(selected.acceptedAt) || '日時不明'}）
        </p>
      ) : null}

      {!selected?.acceptUrl ? (
        <p className="mt-2 text-xs font-bold text-amber-800">この工場の受注用URLがありません。</p>
      ) : null}

      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-black text-slate-600">件名</p>
          <button
            type="button"
            onClick={() => void handleCopy('subject', mail.subject)}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-700 hover:bg-slate-100"
          >
            {copied === 'subject' ? 'コピーしました' : '件名をコピー'}
          </button>
        </div>
        <p className="mt-1 break-words rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900">
          {mail.subject}
        </p>
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-black text-slate-600">本文</p>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => void handleCopy('body', mail.body)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-700 hover:bg-slate-100"
            >
              {copied === 'body' ? 'コピーしました' : '本文をコピー'}
            </button>
            <button
              type="button"
              onClick={() => void handleCopy('both', `件名: ${mail.subject}\n\n${mail.body}`)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-black text-slate-700 hover:bg-slate-100"
            >
              {copied === 'both' ? 'コピーしました' : '件名+本文'}
            </button>
          </div>
        </div>
        <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-relaxed text-slate-800">
          {mail.body}
        </pre>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <a
          href={mailtoTooLong ? undefined : mailto}
          onClick={(event) => {
            if (mailtoTooLong) event.preventDefault();
          }}
          className={
            'inline-flex min-h-[44px] items-center justify-center rounded-xl border-2 px-4 text-sm font-black ' +
            (mailtoTooLong
              ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
              : 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700')
          }
        >
          メールを作成
        </a>
        <p className="text-xs font-medium leading-relaxed text-slate-500">
          OSのメールソフトが件名・本文
          {selected?.email ? `・宛先（${selected.email}）` : '（宛先は工場メール未登録のため空欄）'}
          を入れた状態で開きます。mailto では添付できないため、PDFは手動で添付してください。
        </p>
        {mailtoTooLong ? (
          <p className="text-xs font-bold text-amber-800">本文が長いためメールソフト起動は使わず、コピーしてください。</p>
        ) : null}
        {copyError ? (
          <p className="text-xs font-bold text-red-700" role="alert">
            {copyError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
