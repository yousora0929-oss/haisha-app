/* Service Worker event listeners must be registered during initial evaluation. */
self.addEventListener('message', (event) => {
  event.waitUntil(
    (async () => {
      if (event.data && event.data.type === 'SKIP_WAITING') {
        await self.skipWaiting();
      }
    })(),
  );
});

const nativeSetTimeout = self.setTimeout.bind(self);

// OneSignal v16 currently defers one of its message listener registrations with
// setTimeout(..., 0). Chrome requires service worker event listener registration
// during initial script evaluation, so run only zero-delay timers synchronously
// while the SDK is being imported.
self.setTimeout = (handler, timeout, ...args) => {
  if (timeout === 0 && typeof handler === 'function') {
    handler(...args);
    return 0;
  }
  return nativeSetTimeout(handler, timeout, ...args);
};

try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} finally {
  self.setTimeout = nativeSetTimeout;
}

self.addEventListener('push', (event) => {
  if ('setAppBadge' in self.navigator) {
    event.waitUntil(
      self.navigator.setAppBadge(1).catch((err) => {
        console.error('Badge error:', err);
      }),
    );
  }
});
