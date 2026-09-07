const ACCEPT_TOKEN_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidMixDesignAcceptToken(token) {
  return ACCEPT_TOKEN_RE.test(String(token || '').trim());
}

/** パス /mix-design/accept/:token から受注用トークンを取得 */
export function parseMixDesignAcceptTokenFromPath(pathname) {
  const path =
    pathname != null
      ? String(pathname)
      : typeof window !== 'undefined'
        ? String(window.location?.pathname || '')
        : '';
  const match = path.match(/\/mix-design\/accept\/([^/?#]+)/i);
  if (match?.[1]) {
    try {
      return decodeURIComponent(match[1]).trim();
    } catch {
      return String(match[1] || '').trim();
    }
  }
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('token');
    if (q) return String(q).trim();
  }
  return '';
}

export function resolvePublicAppOrigin(baseOrigin) {
  const envOrigin =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_APP_ORIGIN
      ? String(import.meta.env.VITE_PUBLIC_APP_ORIGIN).replace(/\/$/, '')
      : '';
  return (
    (baseOrigin && String(baseOrigin).replace(/\/$/, '')) ||
    envOrigin ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '')
  );
}

/** 工場受注確認ページ URL */
export function buildMixDesignAcceptUrl(acceptToken, baseOrigin) {
  const token = String(acceptToken || '').trim();
  if (!isValidMixDesignAcceptToken(token)) return '';
  const origin = resolvePublicAppOrigin(baseOrigin);
  if (!origin) return '';
  return `${origin}/mix-design/accept/${encodeURIComponent(token)}`;
}

export function factoryContactEmail(factory) {
  if (!factory || typeof factory !== 'object') return '';
  const raw = factory.raw && typeof factory.raw === 'object' ? factory.raw : {};
  const candidates = [
    factory.email,
    factory.contact_email,
    factory.mail,
    raw.email,
    raw.contact_email,
    raw.mail,
    raw.contactEmail,
  ];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text.includes('@')) return text;
  }
  return '';
}

export function formatMixDesignAcceptedAt(value) {
  if (value == null || value === '') return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

export function buildMixDesignFactoryMail({
  factoryName,
  projectName,
  contractorName,
  requesterName,
  requesterAffiliation,
  acceptUrl,
} = {}) {
  const site = String(projectName || '').trim() || '現場';
  const contractor = String(contractorName || '').trim() || '業者';
  const plant = String(factoryName || '').trim() || '工場';
  const name = String(requesterName || '').trim();
  const affiliation = String(requesterAffiliation || '').trim();
  const requester = [affiliation, name].filter(Boolean).join(' ') || '担当者';
  const url = String(acceptUrl || '').trim();

  const subject = `【配合計画書ご依頼】${site}（${contractor}）`;
  const body = [
    `${plant} 様`,
    '',
    `お世話になっております。${requester}です。`,
    '',
    `${site}の配合計画書作成をご依頼申し上げます。`,
    '添付のPDFをご確認のうえ、下記URLより受注のご連絡をお願いいたします。',
    '',
    '▼受注確認はこちら',
    url,
    '',
    'ご不明点がございましたらご連絡ください。',
    'よろしくお願いいたします。',
  ].join('\n');

  return { subject, body };
}

export function buildMixDesignMailto({ to, subject, body } = {}) {
  const email = String(to || '').trim();
  const addr = email.includes('@') ? encodeURIComponent(email) : '';
  const params = [];
  const sub = String(subject || '');
  const text = String(body || '');
  if (sub) params.push(`subject=${encodeURIComponent(sub)}`);
  if (text) params.push(`body=${encodeURIComponent(text)}`);
  const query = params.join('&');
  return query ? `mailto:${addr}?${query}` : `mailto:${addr}`;
}

export function mixDesignMailtoIsTooLong(mailto) {
  return String(mailto || '').length > 2000;
}

export function mapMixDesignFactoryLinks(factoryRows) {
  const list = Array.isArray(factoryRows) ? factoryRows : [];
  const seen = new Set();
  const links = [];
  for (const row of list) {
    const factoryId = String(row?.factoryId ?? row?.factory_id ?? '').trim();
    if (!factoryId || seen.has(factoryId)) continue;
    seen.add(factoryId);
    links.push({
      factoryId,
      acceptToken: String(row?.acceptToken ?? row?.accept_token ?? '').trim(),
      acceptedAt: row?.acceptedAt ?? row?.accepted_at ?? null,
    });
  }
  return links;
}

export function buildMixDesignEmailFactoryOptions(factoryLinks, factories = [], baseOrigin) {
  const byId = new Map();
  for (const factory of Array.isArray(factories) ? factories : []) {
    if (!factory?.id) continue;
    byId.set(String(factory.id), factory);
  }
  return mapMixDesignFactoryLinks(factoryLinks).map((link) => {
    const factory = byId.get(link.factoryId);
    return {
      factoryId: link.factoryId,
      factoryName: String(factory?.name || link.factoryId),
      email: factoryContactEmail(factory),
      acceptToken: link.acceptToken,
      acceptedAt: link.acceptedAt,
      acceptUrl: buildMixDesignAcceptUrl(link.acceptToken, baseOrigin),
    };
  });
}
