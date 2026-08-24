import { normalizeCompanyName } from './csvImport.js';

/** 物件の商社名表示（organizations 紐付け優先、なければテキスト） */
export function resolveProjectTradingCompanyName(project) {
  if (!project || typeof project !== 'object') return '';
  const orgId = project.trading_company_organization_id;
  const orgName = String(project.trading_company_organization_name ?? '').trim();
  if (orgId && orgName) return orgName;
  return String(project.trading_company_name ?? project.trading_company ?? '').trim();
}

export function findAgentOrganizationByName(agentOrganizations, name) {
  const q = normalizeCompanyName(name);
  if (!q) return null;
  return (
    (agentOrganizations || []).find(
      (o) => o && String(o.type || '') === 'agent' && normalizeCompanyName(o.name) === q,
    ) ?? null
  );
}

export function isUnregisteredTradingCompanyName(name, agentOrganizations, organizationId = null) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return false;
  if (organizationId) {
    const org = (agentOrganizations || []).find((o) => String(o.id) === String(organizationId));
    if (org && normalizeCompanyName(org.name) === normalizeCompanyName(trimmed)) return false;
  }
  return !findAgentOrganizationByName(agentOrganizations, trimmed);
}
