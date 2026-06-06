import OneSignal from 'react-onesignal';
import { ONESIGNAL_APP_ID, ONESIGNAL_SERVICE_WORKER_PATH } from '../constants/onesignal.js';

let oneSignalInitPromise = null;
let notificationClickListenerRegistered = false;

function appId() {
  return String(import.meta.env.VITE_ONESIGNAL_APP_ID || ONESIGNAL_APP_ID || '').trim();
}

/** OneSignal External ID 用（UUID / factory_id など。電話番号は使わない） */
export function normalizeOneSignalExternalId(value) {
  return String(value ?? '').trim();
}

function normalizeExternalId(value) {
  return normalizeOneSignalExternalId(value);
}

async function readBoundOneSignalExternalId() {
  try {
    const direct = OneSignal.User?.externalId;
    if (direct != null && String(direct).trim()) return String(direct).trim();
    if (typeof OneSignal.getExternalId === 'function') {
      const fetched = await OneSignal.getExternalId();
      if (fetched != null && String(fetched).trim()) return String(fetched).trim();
    }
  } catch {
    /* ignore */
  }
  return '';
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
  readOneSignalDebugValue('OneSignal External ID:', () =>
    OneSignal.getExternalId?.() ?? OneSignal.User?.externalId,
  );
}

export const PUSH_CHAT_REDIRECT_SESSION_KEY = 'redirect_to_chat';

/** OneSignal 許可プロンプト（slidedown）の日本語文言 */
const ONESIGNAL_SLIDEDOWN_TEXT = {
  actionMessage: '最新の出荷状況や受注通知を受け取るには、通知を許可してください。',
  acceptButton: '許可する',
  cancelButton: '今はしない',
  confirmMessage: '通知の設定が完了しました。',
  updateMessage: '通知カテゴリを更新しますか？',
  positiveUpdateButton: '保存',
  negativeUpdateButton: 'キャンセル',
};

/** 通知ベル（notifyButton）ダイアログの日本語文言（enable: false でも将来用に定義） */
const ONESIGNAL_NOTIFY_BUTTON_TEXT = {
  'dialog.blocked.message': 'ブラウザの設定で通知がブロックされています。設定から許可してください。',
  'dialog.blocked.title': '通知がブロックされています',
  'dialog.main.button.subscribe': '通知を受け取る',
  'dialog.main.button.unsubscribe': '通知を停止する',
  'dialog.main.title': 'プッシュ通知',
  'message.action.resubscribed': '通知の再登録が完了しました',
  'message.action.subscribed': '通知の登録が完了しました',
  'message.action.subscribing': '登録中…',
  'message.action.unsubscribed': '通知を停止しました',
  'message.prenotify': 'クリックして通知を有効にしてください',
  'tip.state.blocked': '通知がブロックされています',
  'tip.state.subscribed': '通知を受信中です',
  'tip.state.unsubscribed': '通知を受け取れます',
};

function buildOneSignalInitOptions(appIdValue) {
  return {
    appId: appIdValue,
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
            text: ONESIGNAL_SLIDEDOWN_TEXT,
          },
        ],
      },
    },
    notifyButton: {
      enable: false,
      text: ONESIGNAL_NOTIFY_BUTTON_TEXT,
    },
    welcomeNotification: {
      disable: true,
    },
  };
}

async function setOneSignalUserLanguageJa() {
  try {
    await OneSignal.User.setLanguage('ja');
  } catch (error) {
    console.warn('[OneSignal] ユーザー言語の設定に失敗しました', error);
  }
}

export async function initOneSignal() {
  const id = appId();
  if (!id) {
    console.warn('[OneSignal] VITE_ONESIGNAL_APP_ID が未設定です');
    return null;
  }
  if (!oneSignalInitPromise) {
    oneSignalInitPromise = (async () => {
      await OneSignal.init(buildOneSignalInitOptions(id));
      await setOneSignalUserLanguageJa();
      return OneSignal;
    })().catch((error) => {
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
  if (!normalizedId) {
    console.warn('[OneSignal] External ID が空のため login をスキップしました', {
      externalId: String(externalId ?? ''),
      role: String(tags?.role ?? ''),
    });
    return false;
  }
  try {
    await initOneSignal();
    await OneSignal.login(String(normalizedId));
    await setOneSignalUserLanguageJa();
    const boundId = await readBoundOneSignalExternalId();
    console.log('OneSignalに登録したID:', String(boundId || normalizedId));
    if (boundId && boundId !== normalizedId) {
      console.warn('[OneSignal] 登録IDと紐付けIDが一致しません', {
        expected: String(normalizedId),
        bound: boundId,
      });
    }
    logOneSignalDebug();
    if (tags && Object.keys(tags).length > 0) {
      OneSignal.User.addTags(
        Object.fromEntries(Object.entries(tags).map(([key, value]) => [key, String(value ?? '')])),
      );
    }
    try {
      await OneSignal.Slidedown.promptPush({ force: true, forceSlidedownOverNative: true });
    } catch {
      await OneSignal.Notifications.requestPermission();
    }
    return true;
  } catch (error) {
    console.warn('[OneSignal] ユーザー登録に失敗しました', String(normalizedId), error);
    return false;
  }
}

export async function logoutOneSignalUser() {
  try {
    await initOneSignal();
    console.log('OneSignalからID紐付けを解除します');
    await OneSignal.logout();
    console.log('OneSignalからID紐付けを解除しました');
    return true;
  } catch (error) {
    console.warn('[OneSignal] logout に失敗しました', error);
    return false;
  }
}

export function clearAppBadge() {
  if (typeof navigator === 'undefined' || typeof navigator.clearAppBadge !== 'function') return;
  navigator.clearAppBadge().catch((error) => {
    console.error('バッジの消去に失敗しました:', error);
  });
}

