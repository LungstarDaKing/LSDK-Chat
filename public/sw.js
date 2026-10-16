/* LSDK Chat service worker. Its only job is system notifications (Web Push).
   It has NO fetch handler and caches nothing, so it can never serve an old copy of the app. */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

const IOS = /iPhone|iPad|iPod/.test(self.navigator.userAgent)

self.addEventListener('push', (event) => {
  let d = {}
  try { d = event.data ? event.data.json() : {} } catch { d = {} }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // the open app already plays its own ding for messages; skip the system alert then (iPhones require every push to show something)
    if (!IOS && d.kind === 'message' && wins.some((w) => w.visibilityState === 'visible' && w.focused)) return
    const call = d.kind === 'call' || d.kind === 'group_call'
    await self.registration.showNotification(d.title || 'LSDK Chat', {
      body: d.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: d.tag || 'lsdk',
      renotify: true,
      requireInteraction: call,
      vibrate: call ? [300, 150, 300, 150, 300, 150, 300] : [120],
      timestamp: d.ts || Date.now(),
      data: { hash: d.hash || '#/chat' },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const hash = (event.notification.data && event.notification.data.hash) || '#/chat'
  event.waitUntil((async () => {
    const scope = self.registration.scope
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const mine = wins.find((w) => w.url.startsWith(scope))
    if (mine) { await mine.focus(); mine.postMessage({ type: 'lsdk-open', hash }); return }
    await self.clients.openWindow(scope + hash)
  })())
})
