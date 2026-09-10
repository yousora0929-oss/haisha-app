import React, { useMemo, useState } from 'react';
import { TIME_SLOTS, todayLocalISODate } from '../haishaConstants.js';
import { buildDispatchOrderForDate, validateCartLineForm } from '../utils/dispatchBulkOrder.js';
import { resolveInitialOrderStatus, sumOrderVolumesM3 } from '../utils/orderWorkflow.js';
import { defaultReservationDayDates } from '../utils/reservationGroup.js';
import { ReservationGroupStatusPanel } from './ReservationGroupStatusPanel.jsx';

const FIELD_CLASS =
  'min-h-[52px] w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300';

function emptyDay(date, timeSlot, quantityM3, mixText) {
  return {
    date: String(date || '').trim(),
    timeSlot: String(timeSlot || TIME_SLOTS[0]?.value || '480'),
    quantityM3: String(quantityM3 || '').trim(),
    mixText: String(mixText || '').trim(),
  };
}

export function ReservationGroupOrderForm({
  urlToken,
  orderFormContext,
  factories = [],
  projects = [],
  factoryNameById = {},
  guestLockedFields = null,
  isGuestSiteOrder = false,
  today = todayLocalISODate(),
  isPastPreferredDateTime,
  adminSettings,
  submitting,
  onSubmit,
  watchedGroup = null,
  onBack,
  selectedProjectId = '',
  onSelectProject,
  sitePhone = '',
  onSitePhoneChange,
  preferredFactoryId = '',
  onPreferredFactoryChange,
}) {
  const defaults = defaultReservationDayDates(today);
  const [days, setDays] = useState(() =>
    defaults.map((date) =>
      emptyDay(date, orderFormContext?.timeSlot, orderFormContext?.quantityM3, orderFormContext?.mixText),
    ),
  );
  const [sameFactoryRequired, setSameFactoryRequired] = useState(true);
  const [localError, setLocalError] = useState('');

  const tokenOk = Boolean(String(urlToken || '').trim());

  const patchDay = (index, patch) => {
    setDays((prev) => prev.map((day, i) => (i === index ? { ...day, ...patch } : day)));
  };

  const handleSubmit = async (e) => {
    e?.preventDefault?.();
    setLocalError('');
    if (!tokenOk) {
      const message = '3日間予約には専用発注URL（url_token）が必要です。物件の専用URLから開くか、URLが設定された物件を選んでください。';
      setLocalError(message);
      window.alert(message);
      return;
    }
    const dates = days.map((d) => String(d.date || '').trim());
    if (dates.some((d) => !d)) {
      const message = '3日分の希望日を入力してください。';
      setLocalError(message);
      window.alert(message);
      return;
    }
    if (new Set(dates).size !== 3) {
      const message = '3日分はそれぞれ異なる日付にしてください。';
      setLocalError(message);
      window.alert(message);
      return;
    }
    const orders = [];
    const contractorFallback =
      String(orderFormContext?.contractorName || '').trim() ||
      String(orderFormContext?.currentCustomer?.company_name || orderFormContext?.currentCustomer?.name || '').trim();
    for (const day of days) {
      const context = {
        ...orderFormContext,
        contractorName: contractorFallback,
        sitePhone: String(sitePhone || orderFormContext?.sitePhone || '').trim(),
        preferredFactoryId: preferredFactoryId || orderFormContext?.preferredFactoryId,
        selectedProjectId: selectedProjectId || orderFormContext?.selectedProjectId,
        timeSlot: day.timeSlot,
        quantityM3: day.quantityM3,
        mixText: day.mixText,
      };
      const missing = validateCartLineForm(context, day.date, {
        today,
        isPastPreferredDateTime,
        isGuestSiteOrder,
      });
      if (missing.length) {
        const message = `${day.date}: ${missing.join('、')}`;
        setLocalError(message);
        window.alert(message);
        return;
      }
      orders.push(buildDispatchOrderForDate(day.date, context));
    }
    const isSpot = orderFormContext?.orderKind === 'spot';
    const bulkStatus = resolveInitialOrderStatus({
      isSpot,
      totalVolumeM3: sumOrderVolumesM3(orders),
      spotThresholdVolume: adminSettings?.spot_threshold_volume,
    });
    const payload = orders.map((order) => ({ ...order, status: bulkStatus }));
    try {
      await onSubmit(payload, sameFactoryRequired);
    } catch (err) {
      const message = err?.message || '3日間予約の送信に失敗しました';
      setLocalError(message);
    }
  };

  const factoryOptions = useMemo(
    () => (Array.isArray(factories) ? factories.filter((f) => f?.id) : []),
    [factories],
  );

  const projectOptions = useMemo(() => {
    const fromProp = Array.isArray(projects) ? projects : [];
    const fromContext = Array.isArray(orderFormContext?.filteredProjects)
      ? orderFormContext.filteredProjects
      : [];
    return (fromProp.length ? fromProp : fromContext).filter((p) => p?.id);
  }, [projects, orderFormContext?.filteredProjects]);

  return (
    <div className="mx-auto w-full max-w-4xl min-w-0 overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-indigo-700">3日間予約</p>
          <h2 className="mt-1 text-2xl font-black text-slate-900">同じ現場の3日分をまとめて予約</h2>
        </div>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50"
          >
            発注スタイル選択へ戻る
          </button>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
        通常の単発発注とは別の予約です。3件が同じ工場で確定すると「確定」、別工場になると「要調整」になります。
      </p>

      {guestLockedFields ? (
        <div className="mt-4 rounded-2xl border-2 border-slate-200 bg-slate-50/90 p-4">
          <p className="text-xs font-bold text-slate-500">この物件で確定している情報です（変更できません）</p>
          <p className="mt-2 text-sm font-black text-slate-900">
            {guestLockedFields.projectName || guestLockedFields.address || '物件'}
          </p>
        </div>
      ) : null}

      {!tokenOk ? (
        <p className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
          専用発注URLが無いため送信できません。物件の専用URLから開くか、url_token 付きの物件を選択してください。
        </p>
      ) : null}

      <form className="mt-6 flex flex-col gap-5" onSubmit={(e) => void handleSubmit(e)}>
        {!isGuestSiteOrder ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-black text-slate-600">
              物件
              <select
                value={String(selectedProjectId || '')}
                onChange={(e) => onSelectProject?.(e.target.value)}
                className={FIELD_CLASS + ' mt-1 appearance-none'}
                required
              >
                <option value="">物件を選択</option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={String(project.id)}>
                    {project.name || project.id}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-black text-slate-600">
              電話番号
              <input
                type="tel"
                value={sitePhone}
                onChange={(e) => onSitePhoneChange?.(e.target.value)}
                className={FIELD_CLASS + ' mt-1'}
                required
              />
            </label>
            {factoryOptions.length ? (
              <label className="text-xs font-black text-slate-600 sm:col-span-2">
                第一希望工場
                <select
                  value={String(preferredFactoryId || '')}
                  onChange={(e) => onPreferredFactoryChange?.(e.target.value)}
                  className={FIELD_CLASS + ' mt-1 appearance-none'}
                >
                  <option value="">物件のメイン工場</option>
                  {factoryOptions.map((factory) => (
                    <option key={factory.id} value={String(factory.id)}>
                      {factory.name || factory.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-indigo-200 bg-indigo-50 px-4 py-3">
          <input
            type="checkbox"
            checked={sameFactoryRequired}
            onChange={(e) => setSameFactoryRequired(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="text-sm font-bold text-slate-800">
            同一工場必須
            <span className="mt-1 block text-xs font-medium text-slate-500">
              オンにすると、3件とも同じ工場での受注を前提にします。別工場で確定した場合は管理画面に「要調整」と出ます。
            </span>
          </span>
        </label>

        {days.map((day, index) => (
          <fieldset
            key={`reservation-day-${index}`}
            className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-4"
          >
            <legend className="px-1 text-sm font-black text-indigo-800">{index + 1}日目</legend>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-black text-slate-600">
                希望日
                <input
                  type="date"
                  min={today}
                  value={day.date}
                  onChange={(e) => patchDay(index, { date: e.target.value })}
                  className={FIELD_CLASS + ' mt-1'}
                  required
                />
              </label>
              <label className="text-xs font-black text-slate-600">
                希望時刻
                <select
                  value={day.timeSlot}
                  onChange={(e) => patchDay(index, { timeSlot: e.target.value })}
                  className={FIELD_CLASS + ' mt-1 appearance-none'}
                >
                  {TIME_SLOTS.map((slot) => (
                    <option key={slot.value} value={slot.value} disabled={isPastPreferredDateTime?.(day.date || today, slot.value)}>
                      {slot.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-black text-slate-600">
                数量（m³）
                <input
                  type="text"
                  inputMode="decimal"
                  value={day.quantityM3}
                  onChange={(e) => patchDay(index, { quantityM3: e.target.value })}
                  className={FIELD_CLASS + ' mt-1'}
                  required
                />
              </label>
              <label className="text-xs font-black text-slate-600 sm:col-span-2">
                配合
                <input
                  type="text"
                  value={day.mixText}
                  onChange={(e) => patchDay(index, { mixText: e.target.value })}
                  className={FIELD_CLASS + ' mt-1'}
                  placeholder="例: 24-18-20N"
                />
              </label>
            </div>
          </fieldset>
        ))}

        {isGuestSiteOrder && factoryOptions.length ? (
          <p className="text-xs font-bold text-slate-500">
            第一希望工場は物件の設定（{factoryNameById?.[orderFormContext?.preferredFactoryId] || '未指定'}）を使います。
          </p>
        ) : null}

        {localError ? (
          <p className="rounded-xl border-2 border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
            {localError}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={submitting || !tokenOk}
          className="min-h-[52px] rounded-xl border-2 border-indigo-700 bg-indigo-600 text-base font-black text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? '送信中…' : '3日分を予約する'}
        </button>
      </form>

      {watchedGroup?.groupId ? (
        <div className="mt-6">
          <ReservationGroupStatusPanel
            groupId={watchedGroup.groupId}
            factoryNameById={factoryNameById}
          />
        </div>
      ) : null}
    </div>
  );
}
