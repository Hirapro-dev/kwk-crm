/* ひらプロタスクの Service Worker(Web Push の受信と通知クリック)。CLAUDE.md §5.20 migration 116 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'ひらプロタスク', body: '', url: '/task', tag: undefined };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    if (event.data) data.body = event.data.text();
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/task';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // 行き先を変えられるのは、この Service Worker の範囲(/task)にあるタブだけ。
      // CRM 本体やメーラーのタブを選ぶと、前面に出るだけでタスクが開かない
      for (const c of clients) {
        let inScope = false;
        try {
          inScope = new URL(c.url).pathname.startsWith('/task');
        } catch (_) {
          inScope = false;
        }
        if (inScope && 'focus' in c && 'navigate' in c) {
          return c
            .navigate(url)
            .then((moved) => (moved || c).focus())
            .catch(() => self.clients.openWindow(url));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
