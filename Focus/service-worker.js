self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch (error) {
        console.error('Received an invalid Focus push notification:', error);
    }

    const title = typeof payload.title === 'string' ? payload.title : 'Focus';
    const options = {
        body: typeof payload.body === 'string' ? payload.body : 'You have a new Focus notification.',
        icon: '/icon.svg',
        badge: '/icon.svg',
        tag: typeof payload.tag === 'string' ? payload.tag : 'focus-notification',
        data: { url: typeof payload.url === 'string' ? payload.url : '/index.html' }
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = new URL(event.notification.data?.url || '/index.html', self.location.origin).href;
    event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        const existing = clients.find(client => client.url === targetUrl);
        if (existing) return existing.focus();
        return self.clients.openWindow(targetUrl);
    }));
});
