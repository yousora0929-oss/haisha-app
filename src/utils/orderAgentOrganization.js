/**
 * orders.agent_organization_id と order_data の商社表示名を同期するパッチを組み立てる。
 * 「商社なし」のときは id=null・表示名は空文字（フォールバック補完しない）。
 *
 * @param {string|null|undefined} agentOrganizationId
 * @param {Array<{id?: string, name?: string}>|{id?: string, name?: string}|null|undefined} organizationsOrSelected
 *   組織一覧、または選択済み組織オブジェクト（name 解決用）
 * @returns {{
 *   agent_organization_id: string|null,
 *   trading_company_name: string,
 *   projectTradingCompanyName: string,
 *   traderName: string,
 * }}
 */
export function buildAgentOrganizationSyncPatch(agentOrganizationId, organizationsOrSelected = []) {
  const id = agentOrganizationId != null ? String(agentOrganizationId).trim() : '';
  if (!id) {
    return {
      agent_organization_id: null,
      trading_company_name: '',
      projectTradingCompanyName: '',
      traderName: '',
    };
  }

  let name = '';
  if (
    organizationsOrSelected &&
    typeof organizationsOrSelected === 'object' &&
    !Array.isArray(organizationsOrSelected)
  ) {
    name = String(organizationsOrSelected.name || '').trim();
  } else {
    const list = Array.isArray(organizationsOrSelected) ? organizationsOrSelected : [];
    const hit = list.find((o) => o && String(o.id) === id);
    name = String(hit?.name || '').trim();
  }

  return {
    agent_organization_id: id,
    trading_company_name: name,
    projectTradingCompanyName: name,
    traderName: name,
  };
}
