import React, { useMemo } from 'react';
import { MasterSuggestInput } from './MasterSuggestInput.jsx';
import { customerSuggestTexts, organizationSuggestTexts } from '../utils/masterSuggest.js';
import { dedupeCustomersByCompany } from '../utils/dedupeCustomersByCompany.js';
import {
  orderAgentOrganizationId,
  orderContractorCustomerId,
  orderTradingAgentCustomerId,
  resolveOrderParties,
} from '../utils/orderPartyInfo.js';

function customerLabel(customer) {
  return String(customer?.company_name || customer?.name || customer?.id || '').trim();
}

function orgLabel(org) {
  return String(org?.name || org?.company_name || org?.id || '').trim();
}

/**
 * 注文の業者・商社をマスタ候補から選ぶ（自由入力も可。候補は補助）。
 * 親が contractorName / traderName を渡す場合はそれを表示値として使う。
 */
export function OrderPartyEditFields({
  order,
  customers = [],
  organizations = [],
  contractorCustomerId,
  agentOrganizationId,
  tradingAgentCustomerId,
  contractorName: contractorNameProp,
  traderName: traderNameProp,
  onChange,
  inputClassName = '',
  labelClassName = '',
  showContractor = true,
  showTrader = true,
  showTradingAgent = true,
}) {
  const customersById = useMemo(
    () => Object.fromEntries((customers || []).filter((c) => c?.id).map((c) => [String(c.id), c])),
    [customers],
  );
  const organizationsById = useMemo(
    () => Object.fromEntries((organizations || []).filter((o) => o?.id).map((o) => [String(o.id), o])),
    [organizations],
  );

  const nextContractorId =
    contractorCustomerId !== undefined ? String(contractorCustomerId || '').trim() : orderContractorCustomerId(order);
  const nextAgentId =
    agentOrganizationId !== undefined ? String(agentOrganizationId || '').trim() : orderAgentOrganizationId(order);
  const nextTradingAgentId =
    tradingAgentCustomerId !== undefined
      ? String(tradingAgentCustomerId || '').trim()
      : orderTradingAgentCustomerId(order);

  const parties = resolveOrderParties(
    {
      ...order,
      contractor_customer_id: nextContractorId,
      agent_organization_id: nextAgentId,
      trading_agent_customer_id: nextTradingAgentId,
      ...(contractorNameProp !== undefined ? { contractorName: contractorNameProp } : {}),
      ...(traderNameProp !== undefined ? { traderName: traderNameProp } : {}),
    },
    { customersById, organizationsById },
  );

  const contractorItems = useMemo(
    () =>
      dedupeCustomersByCompany(
        (customers || []).filter((c) => c?.id && (c.role ?? 'contractor') === 'contractor'),
      ),
    [customers],
  );
  const agentOrgItems = useMemo(
    () =>
      (organizations || [])
        .filter((o) => o?.id && String(o.type || '').trim() === 'agent')
        .slice()
        .sort((a, b) => orgLabel(a).localeCompare(orgLabel(b), 'ja')),
    [organizations],
  );
  const tradingAgentItems = useMemo(
    () => (customers || []).filter((c) => c?.id && (c.role ?? 'contractor') === 'agent'),
    [customers],
  );

  const selectedContractor = customersById[nextContractorId] || null;
  const selectedOrg = organizationsById[nextAgentId] || null;
  const selectedTradingAgent = customersById[nextTradingAgentId] || null;

  const contractorDisplay =
    nextContractorId && selectedContractor
      ? customerLabel(selectedContractor)
      : contractorNameProp !== undefined
        ? String(contractorNameProp ?? '')
        : selectedContractor
          ? customerLabel(selectedContractor)
          : parties.contractorName;
  const traderDisplay =
    nextAgentId && selectedOrg
      ? orgLabel(selectedOrg)
      : traderNameProp !== undefined
        ? String(traderNameProp ?? '')
        : selectedOrg
          ? orgLabel(selectedOrg)
          : nextAgentId
            ? parties.traderName
            : '';

  const emit = (partial) => {
    onChange?.({
      contractorCustomerId: nextContractorId,
      agentOrganizationId: nextAgentId,
      tradingAgentCustomerId: nextTradingAgentId,
      contractorName: contractorDisplay,
      traderName: traderDisplay,
      ...partial,
    });
  };

  return (
    <div className="grid gap-3 sm:col-span-2">
      {showContractor ? (
        <MasterSuggestInput
          label="業者名"
          htmlFor="foe-contractor"
          name="contractorName"
          value={contractorDisplay}
          onValueChange={(value) => {
            // 自由入力時は ID を外し、表示文字列だけを親へ渡す（マスタ強制にしない）
            emit({
              contractorCustomerId: '',
              contractorName: value,
            });
          }}
          onSelect={(item) =>
            emit({
              contractorCustomerId: String(item?.id || '').trim(),
              contractorName: customerLabel(item),
            })
          }
          items={contractorItems}
          getItemKey={(c) => String(c.id)}
          getItemLabel={customerLabel}
          getSearchTexts={customerSuggestTexts}
          placeholder="業者名を入力（候補から選択、または自由入力）"
          emptyHint="該当する業者がありません（自由入力できます）"
          inputClassName={inputClassName}
          labelClassName={labelClassName}
        />
      ) : null}
      {showTrader ? (
        <MasterSuggestInput
          label="商社名"
          htmlFor="foe-trader"
          name="traderName"
          value={traderDisplay}
          onValueChange={(value) => {
            // 空欄＝商社なし（直接請求）。フォールバック文字列は入れない
            const trimmed = String(value || '');
            emit({
              agentOrganizationId: '',
              traderName: trimmed,
              ...(trimmed.trim() ? {} : { tradingAgentCustomerId: '' }),
            });
          }}
          onSelect={(item) =>
            emit({
              agentOrganizationId: String(item?.id || '').trim(),
              traderName: orgLabel(item),
            })
          }
          items={agentOrgItems}
          getItemKey={(o) => String(o.id)}
          getItemLabel={orgLabel}
          getSearchTexts={organizationSuggestTexts}
          placeholder="商社名を入力（空欄＝商社なし／自由入力可）"
          emptyHint="候補がありません（自由入力できます）"
          inputClassName={inputClassName}
          labelClassName={labelClassName}
        />
      ) : null}
      {showTradingAgent ? (
        <MasterSuggestInput
          label="商社担当者（任意）"
          htmlFor="foe-trading-agent"
          name="order-party-trading-agent"
          value={
            selectedTradingAgent ? customerLabel(selectedTradingAgent) : parties.tradingAgentCompanyName
          }
          onValueChange={(value) => {
            if (!String(value || '').trim()) {
              emit({ tradingAgentCustomerId: '' });
            }
          }}
          onSelect={(item) =>
            emit({
              tradingAgentCustomerId: String(item?.id || '').trim(),
            })
          }
          items={tradingAgentItems}
          getItemKey={(c) => String(c.id)}
          getItemLabel={customerLabel}
          getSearchTexts={customerSuggestTexts}
          placeholder="通知先の商社担当者がいれば選択"
          emptyHint="該当する商社担当者がありません"
          inputClassName={inputClassName}
          labelClassName={labelClassName}
        />
      ) : null}
    </div>
  );
}
