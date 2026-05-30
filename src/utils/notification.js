import OneSignal from 'react-onesignal';
import { ONESIGNAL_APP_ID, ONESIGNAL_SERVICE_WORKER_PATH } from '../constants/onesignal.js';

let oneSignalInitPromise = null;
let notificationClickListenerRegistered = false;

function appId() {
  return String(import.meta.env.VITE_ONESIGNAL_APP_ID || ONESIGNAL_APP_ID || '').trim();
}

function normalizeExternalId(value) {
  return String(value || '').replace(/\s+/g, '').trim();
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
      serviceWorkerPath: ONESIGNAL_SERVICE_WORKER_PATH,
      serviceWorkerParam: { scope: '/' },
      autoRegister: true,
      autoResubscribe: true,
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

export function clearAppBadge() {
  if (typeof navigator === 'undefined' || typeof navigator.clearAppBadge !== 'function') return;
  navigator.clearAppBadge().catch((error) => {
    console.error('バッジの消去に失敗しました:', error);
  });
}

