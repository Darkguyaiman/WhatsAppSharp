const CACHE = 'wa-shell-v3';
const PUBLIC_ASSETS = ['/offline.html', '/css/app.css', '/js/lucide.min.js', '/js/signalr.min.js', '/images/chat-wallpaper.png', '/images/welcome-laptop.svg', '/images/icons/icon-192.png', '/images/icons/icon-512.png', '/images/icons/maskable-512.png'];
// Only public assets are cached. Chats, uploads, profiles, and auth responses stay private.
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PUBLIC_ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith('wa-shell-') && key !== CACHE).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
    } else if (PUBLIC_ASSETS.includes(url.pathname)) {
        event.respondWith(fetch(event.request).then(response => {
            if (response.ok) {
                const copy = response.clone();
                event.waitUntil(caches.open(CACHE).then(cache => cache.put(url.pathname, copy)));
            }
            return response;
        }).catch(() => caches.match(url.pathname)));
    }
});
self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('push', event => {
    event.waitUntil((async () => {
        let data;
        try { data = event.data?.json() || {}; } catch { data = {}; }
        const windows = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
        const alreadyReading = windows.some(client => client.focused && client.visibilityState !== 'hidden');
        // Every accepted push must show a notification, including on Safari.
        // Any focused app page is quiet, including a different chat or Settings.
        await self.registration.showNotification(data.title || 'New message', {
            body: data.body || 'Open the app to view your message.',
            icon: '/images/icons/icon-192.png', badge: '/images/icons/icon-192.png',
            tag: data.tag || 'new-message',
            silent: alreadyReading,
            data: { url: data.url || '/Chat', recipientId: data.recipientId }
        });
        if (typeof data.deliveryToken === 'string') {
            try { await fetch('/api/delivery',{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:data.deliveryToken})}); }
            catch (_) { /* Opening the app later syncs receipts if this request was offline. */ }
        }
    })());
});
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        let url = new URL(event.notification.data?.url || '/Chat', self.location.origin);
        if (url.origin !== self.location.origin || url.pathname !== '/Chat') url = new URL('/Chat', self.location.origin);
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find(client => new URL(client.url).pathname.startsWith('/Chat'));
        if (existing) { await existing.navigate(url.href); return existing.focus(); }
        return self.clients.openWindow(url.href);
    })());
});
