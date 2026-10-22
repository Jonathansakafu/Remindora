/* Remindora web push service worker: shows alerts, handles one-tap actions, and dismisses alerts resolved elsewhere. */
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  if (data.type === 'dismiss') {
    event.waitUntil(self.registration.getNotifications({ tag: data.tag }).then((list) => list.forEach((n) => n.close())));
    return;
  }
  const actions = data.data && data.data.reminderId ? [{ action: 'complete', title: 'Complete' }, { action: 'snooze', title: 'Snooze 10m' }] : [];
  event.waitUntil(
    self.registration.showNotification(data.title || 'Remindora', {
      body: data.body,
      tag: data.tag,
      renotify: true,
      requireInteraction: !!data.requireInteraction,
      silent: !!data.silent,
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: data.data || {},
      actions,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const d = n.data || {};
  n.close();
  if (event.action === 'complete' || event.action === 'snooze') {
    // Actions need an authenticated session: focus the app, which performs the action.
    const url = `/app/notifications?act=${event.action}&id=${d.notificationId}`;
    event.waitUntil(self.clients.openWindow(url));
    return;
  }
  const url = d.taskId ? `/app/task?id=${d.taskId}` : '/app/today';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((wins) => {
      const existing = wins.find((w) => 'focus' in w);
      if (existing) return existing.navigate(url).then((w) => w && w.focus());
      return self.clients.openWindow(url);
    }),
  );
});
