import OneSignal from 'react-onesignal';

let oneSignalInitPromise = null;
let notificationClickListenerRegistered = false;

function appId() {
  return String(import.meta.env.VITE_ONESIGNAL_APP_ID || '').trim();
}

function restApiKey() {
  return String(import.meta.env.VITE_ONESIGNAL_REST_API_KEY || '').trim();
}

function normalizeExternalId(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function externalIdCandidates(value) {
  const base = normalizeExternalId(value);
  if (!base) return [];
  const ids = new Set([base]);
  const compactPhone = base.replace(/[‐-‒–—―ーｰ−\s]/g, '');
  if (compactPhone && compactPhone !== base) ids.add(compactPhone);
  return [...ids];
}

function readOneSignalDebugValue(label, getter) {
  try {
    const value = getter();
    if (value && typeof value.then === 'function') {
      value.then((id) => console.log(label, id)).catch((error) => console.warn(label, error));
    } else {
      console.log(label, value);
    }
  } catch (error) {
    console.warn(label, error);
  }
}

function logOneSignalDebug() {
  console.log('--- OneSignal Debug ---');
  readOneSignalDebugValue('Is Push Supported:', () => OneSignal.Notifications?.isPushSupported?.());
  readOneSignalDebugValue('Notification Permission:', () => OneSignal.Notifications?.permission);
  readOneSignalDebugValue('OneSignal Player ID:', () =>
    OneSignal.getUserId?.() ?? OneSignal.User?.PushSubscription?.id ?? OneSignal.User?.onesignalId,
  );
  readOneSignalDebugValue('OneSignal External ID (Phone):', () =>
    OneSignal.getExternalId?.() ?? OneSignal.User?.externalId,
  );
}

export const PUSH_CHAT_REDIRECT_SESSION_KEY = 'redirect_to_chat';

export async function initOneSignal() {
  const id = appId();
  if (!id) {
    console.warn('[OneSignal] VITE_ONESIGNAL_APP_ID が未設定です');
    return null;
  }
  if (!oneSignalInitPromise) {
    oneSignalInitPromise = OneSignal.init({
      appId: id,
      promptOptions: {
        slidedown: {
          prompts: [
            {
              type: 'push',
              autoPrompt: false,
              delay: { pageViews: 1, timeDelay: 0 },
              text: {
                actionMessage: '生コン発注システムから注文状況の通知を受け取りますか？',
                acceptButton: '許可',
                cancelButton: 'あとで',
              },
            },
          ],
        },
      },
      notifyButton: { enable: false },
    }).catch((error) => {
      oneSignalInitPromise = null;
      throw error;
    });
  }
  await oneSignalInitPromise;
  return OneSignal;
}

export async function setupNotificationClickRedirect() {
  try {
    await initOneSignal();
    if (notificationClickListenerRegistered) return true;
    OneSignal.Notifications?.addEventListener?.('click', (event) => {
      const data = event?.notification?.additionalData || event?.notification?.data || {};
      if (data && data.type === 'chat' && data.orderId) {
        try {
          sessionStorage.setItem(PUSH_CHAT_REDIRECT_SESSION_KEY, String(data.orderId));
        } catch {
          /* ignore */
        }
      }
    });
    notificationClickListenerRegistered = true;
    return true;
  } catch (error) {
    console.warn('[OneSignal] 通知クリックリスナーの登録に失敗しました', error);
    return false;
  }
}

export async function registerOneSignalUser(externalId, tags = {}) {
  const normalizedId = normalizeExternalId(externalId);
  if (!normalizedId) return false;
  try {
    await initOneSignal();
    await OneSignal.login(normalizedId);
    logOneSignalDebug();
    if (tags && Object.keys(tags).length > 0) {
      OneSignal.User.addTags(
        Object.fromEntries(Object.entries(tags).map(([key, value]) => [key, String(value)])),
      );
    }
    try {
      await OneSignal.Slidedown.promptPush({ force: true, forceSlidedownOverNative: true });
    } catch {
      await OneSignal.Notifications.requestPermission();
    }
    return true;
  } catch (error) {
    console.warn('[OneSignal] ユーザー登録に失敗しました', error);
    return false;
  }
}

async function postNotification(payload) {
  const id = appId();
  const key = restApiKey();
  if (!id || !key) {
    console.warn('[OneSignal] 通知送信用の環境変数が未設定です');
    return null;
  }
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${key}`,
    },
    body: JSON.stringify({
      app_id: id,
      headings: { ja: '生コン発注システム', en: 'Ready-mix Ordering System' },
      ...payload,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`OneSignal通知送信に失敗しました: ${res.status} ${text}`);
  }
  return res.json().catch(() => null);
}

const badgePayload = {
  ios_badgeType: 'SetTo',
  ios_badgeCount: 1,
  web_badge: 1,
};

function buildNotificationUrl(additionalData) {
  if (!additionalData || additionalData.type !== 'chat' || !additionalData.orderId) return '';
  if (typeof window === 'undefined' || !window.location?.origin) return '';
  const targetApp = additionalData.targetApp === 'factory' ? 'FactoryTabletPrototype.html' : 'DispatchOrderPrototype.html';
  const url = new URL(`/${targetApp}`, window.location.origin);
  url.searchParams.set('action', 'chat');
  url.searchParams.set('orderId', String(additionalData.orderId));
  return url.toString();
}

export function clearAppBadge() {
  if (typeof navigator === 'undefined' || typeof navigator.clearAppBadge !== 'function') return;
  navigator.clearAppBadge().catch((error) => {
    console.error('バッジの消去に失敗しました:', error);
  });
}

export async function sendPushNotification(targetExternalId, message, additionalData = null) {
  const externalIds = externalIdCandidates(targetExternalId);
  if (externalIds.length === 0 || !message) return null;
  try {
    console.log('[OneSignal] Push target external IDs:', externalIds);
    const notificationUrl = buildNotificationUrl(additionalData);
    return await postNotification({
      include_external_user_ids: externalIds,
      channel_for_external_user_ids: 'push',
      contents: { ja: String(message), en: String(message) },
      ...badgePayload,
      ...(notificationUrl ? { url: notificationUrl } : {}),
      ...(additionalData && typeof additionalData === 'object' ? { data: additionalData } : {}),
    });
  } catch (error) {
    console.warn('[OneSignal] 通知送信に失敗しました', error);
    return null;
  }
}

export async function sendPushNotificationToRole(role, message, additionalData = null) {
  const normalizedRole = String(role || '').trim();
  if (!normalizedRole || !message) return null;
  try {
    const notificationUrl = buildNotificationUrl(additionalData);
    return await postNotification({
      filters: [{ field: 'tag', key: 'role', relation: '=', value: normalizedRole }],
      contents: { ja: String(message), en: String(message) },
      ...badgePayload,
      ...(notificationUrl ? { url: notificationUrl } : {}),
      ...(additionalData && typeof additionalData === 'object' ? { data: additionalData } : {}),
    });
  } catch (error) {
    console.warn('[OneSignal] 通知送信に失敗しました', error);
    return null;
  }
}
