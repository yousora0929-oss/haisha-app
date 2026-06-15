/** @typedef {{ orderId: string, type?: string, targetApp: 'customer' | 'factory', view: 'chat' | 'order' }} PushRedirectPayload */

export const PUSH_REDIRECT_SESSION_KEY = 'push_redirect';
/** @deprecated 互換用。新規は PUSH_REDIRECT_SESSION_KEY */
export const PUSH_CHAT_REDIRECT_SESSION_KEY = 'redirect_to_chat';

export const PUSH_APP_PATHS = {
  customer: '/DispatchOrderPrototype.html',
  factory: '/FactoryTabletPrototype.html',
};

/**
 * @param {string} type
 * @param {Record<string, unknown>} [data]
 * @returns {'customer' | 'factory' | null}
 */
export function inferTargetAppFromNotification(type, data = {}) {
  const explicit = String(data.targetApp || '').trim();
  if (explicit === 'customer' || explicit === 'factory') return explicit;
  switch (String(type || '').trim()) {
    case 'chat':
      return null;
    case 'order_status':
      return 'customer';
    case 'new_order':
    case 'customer_map_shared':
      return 'factory';
    default:
      return null;
  }
}

/**
 * @param {string} type
 * @returns {'chat' | 'order'}
 */
export function inferViewFromNotificationType(type) {
  return String(type || '').trim() === 'chat' ? 'chat' : 'order';
}

/**
 * @param {Record<string, unknown>} data
 * @returns {PushRedirectPayload | null}
 */
export function buildPushRedirectPayload(data) {
  const orderId = String(data?.orderId ?? data?.order_id ?? '').trim();
  if (!orderId) return null;
  const type = String(data?.type || '').trim();
  const targetApp = inferTargetAppFromNotification(type, data);
  if (!targetApp) return null;
  return {
    orderId,
    type,
    targetApp,
    view: inferViewFromNotificationType(type),
  };
}

/**
 * @param {PushRedirectPayload} payload
 */
export function savePushRedirect(payload) {
  if (!payload?.orderId) return;
  try {
    sessionStorage.setItem(PUSH_REDIRECT_SESSION_KEY, JSON.stringify(payload));
    if (payload.view === 'chat') {
      sessionStorage.setItem(PUSH_CHAT_REDIRECT_SESSION_KEY, payload.orderId);
    }
  } catch {
    /* ignore */
  }
}

/**
 * @returns {PushRedirectPayload | null}
 */
export function readPushRedirectFromSession() {
  try {
    const raw = sessionStorage.getItem(PUSH_REDIRECT_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.orderId && parsed?.targetApp) return parsed;
    }
  } catch {
    /* ignore */
  }
  try {
    const orderId = String(sessionStorage.getItem(PUSH_CHAT_REDIRECT_SESSION_KEY) || '').trim();
    if (orderId) {
      return { orderId, type: 'chat', targetApp: 'customer', view: 'chat' };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function clearPushRedirect() {
  try {
    sessionStorage.removeItem(PUSH_REDIRECT_SESSION_KEY);
    sessionStorage.removeItem(PUSH_CHAT_REDIRECT_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {string} [search]
 * @returns {PushRedirectPayload | null}
 */
export function readPushRedirectFromUrl(search = typeof window !== 'undefined' ? window.location.search : '') {
  const params = new URLSearchParams(search || '');
  const orderId = String(params.get('orderId') || '').trim();
  if (!orderId) return null;

  const action = params.get('action');
  const viewParam = params.get('view');
  const view = viewParam === 'chat' || action === 'chat' ? 'chat' : viewParam === 'order' ? 'order' : null;
  const type = String(params.get('type') || (view === 'chat' ? 'chat' : 'order_status')).trim();
  const targetAppRaw = String(params.get('app') || params.get('targetApp') || '').trim();
  const targetApp =
    targetAppRaw === 'customer' || targetAppRaw === 'factory'
      ? targetAppRaw
      : inferTargetAppFromNotification(type, { targetApp: targetAppRaw });

  if (!targetApp) return null;

  return {
    orderId,
    type,
    targetApp,
    view: view || inferViewFromNotificationType(type),
  };
}

/**
 * @param {PushRedirectPayload} payload
 * @param {string} [origin]
 */
export function buildPushRedirectUrl(payload, origin = typeof window !== 'undefined' ? window.location.origin : '') {
  const path = PUSH_APP_PATHS[payload.targetApp];
  if (!path || !payload.orderId) return '';
  const params = new URLSearchParams({
    orderId: payload.orderId,
    view: payload.view || 'order',
    type: payload.type || '',
    app: payload.targetApp,
  });
  return `${String(origin || '').replace(/\/$/, '')}${path}?${params.toString()}`;
}

export function stripPushRedirectFromUrl() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search || '');
  const hasRedirect = Boolean(params.get('orderId') || params.get('action') === 'chat');
  if (!hasRedirect) return;
  ['orderId', 'view', 'type', 'action', 'app', 'targetApp'].forEach((key) => params.delete(key));
  const qs = params.toString();
  const clean = `${window.location.pathname}${window.location.hash || ''}${qs ? `?${qs}` : ''}`;
  window.history.replaceState({}, '', clean);
}

/**
 * @param {PushRedirectPayload} payload
 */
export function navigateToPushRedirect(payload) {
  if (!payload?.orderId || !payload.targetApp) return;
  savePushRedirect(payload);
  const url = buildPushRedirectUrl(payload);
  if (!url) return;

  const currentPath = window.location.pathname || '';
  const targetPath = PUSH_APP_PATHS[payload.targetApp];
  const onTargetApp =
    currentPath === targetPath ||
    currentPath.endsWith(targetPath) ||
    currentPath.endsWith(targetPath.replace(/^\//, ''));

  if (onTargetApp) {
    window.dispatchEvent(new CustomEvent('concretelink:push-redirect', { detail: { ...payload } }));
    return;
  }
  window.location.assign(url);
}

/**
 * @param {'customer' | 'factory'} appRole
 * @returns {PushRedirectPayload | null}
 */
export function consumePushRedirectForApp(appRole) {
  const fromUrl = readPushRedirectFromUrl();
  if (fromUrl?.orderId) {
    const payload = { ...fromUrl, targetApp: fromUrl.targetApp || appRole };
    if (payload.targetApp !== appRole) {
      navigateToPushRedirect(payload);
      return null;
    }
    savePushRedirect(payload);
    stripPushRedirectFromUrl();
    return payload;
  }

  const fromSession = readPushRedirectFromSession();
  if (!fromSession?.orderId) return null;
  if (fromSession.targetApp !== appRole) {
    navigateToPushRedirect(fromSession);
    return null;
  }
  return fromSession;
}

/**
 * @param {'customer' | 'factory'} appRole
 * @param {(payload: PushRedirectPayload) => void} onRedirect
 */
export function setupPushRedirectListener(appRole, onRedirect) {
  const handler = (event) => {
    const payload = event?.detail;
    if (!payload?.orderId || payload.targetApp !== appRole) return;
    onRedirect(payload);
  };
  window.addEventListener('concretelink:push-redirect', handler);
  return () => window.removeEventListener('concretelink:push-redirect', handler);
}

/**
 * @param {Record<string, unknown>} data
 */
export function handleNotificationClickData(data) {
  const payload = buildPushRedirectPayload(data);
  if (!payload) return;
  navigateToPushRedirect(payload);
}
