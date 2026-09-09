import React, { useMemo } from 'react';
import { MasterSuggestInput } from './MasterSuggestInput.jsx';
import { customerSuggestTexts, organizationSuggestTexts } from '../utils/masterSuggest.js';
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
 * 注文の業者・商社をマスタ選択する。表示用文字列は選択結果から自動生成する。
 */
export function OrderPartyEditFields({
  order,
  customers = [],
  organizations = [],
  contractorCustomerId,
  agentOrganizationId,
  tradingAgentCustomerId,
  onChange,
  inputClassName = '',
  labelClassName = '',
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
    },
    { customersById, organizationsById },
  );

  const contractorItems = useMemo(
    () => (customers || []).filter((c) => c?.id && (c.role ?? 'contractor') === 'contractor'),
    [customers],
  );
  const agentOrgItems = useMemo(
    () => (organizations || []).filter((o) => o?.id && String(o.type || '').trim() === 'agent'),
    [organizations],
  );
  const tradingAgentItems = useMemo(
    () => (customers || []).filter((c) => c?.id && (c.role ?? 'contractor') === 'agent'),
    [customers],
  );

  const selectedContractor = customersById[nextContractorId] || null;
  const selectedOrg = organizationsById[nextAgentId] || null;
  const selectedTradingAgent = customersById[nextTradingAgentId] || null;

  const emit = (partial) => {
    onChange?.({
      contractorCustomerId: nextContractorId,
      agentOrganizationId: nextAgentId,
      tradingAgentCustomerId: nextTradingAgentId,
      ...partial,
    });
  };

  return (
    <div className="grid gap-3 sm:col-span-2">
      <MasterSuggestInput
        label="業者（元請）"
        name="order-party-contractor"
        value={selectedContractor ? customerLabel(selectedContractor) : parties.contractorName}
        onValueChange={(value) => {
          if (!String(value || '').trim()) {
            emit({ contractorCustomerId: '' });
          }
        }}
        onSelect={(item) =>
          emit({
            contractorCustomerId: String(item?.id || '').trim(),
          })
        }
        items={contractorItems}
        getItemKey={(c) => String(c.id)}
        getItemLabel={customerLabel}
        getSearchTexts={customerSuggestTexts}
        placeholder="業者マスタから選択"
        emptyHint="該当する業者がありません"
        inputClassName={inputClassName}
        labelClassName={labelClassName}
      />
      <MasterSuggestInput
        label="商社（請求先組織）"
        name="order-party-agent-org"
        value={selectedOrg ? orgLabel(selectedOrg) : nextAgentId ? parties.traderName : ''}
        onValueChange={(value) => {
          if (!String(value || '').trim()) {
            emit({ agentOrganizationId: '' });
          }
        }}
        onSelect={(item) =>
          emit({
            agentOrganizationId: String(item?.id || '').trim(),
          })
        }
        items={agentOrgItems}
        getItemKey={(o) => String(o.id)}
        getItemLabel={orgLabel}
        getSearchTexts={organizationSuggestTexts}
        placeholder="商社なし（直接請求）のときは空欄"
        emptyHint="該当する商社がありません"
        inputClassName={inputClassName}
        labelClassName={labelClassName}
      />
      <MasterSuggestInput
        label="商社担当者（任意）"
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
    </div>
  );
}
