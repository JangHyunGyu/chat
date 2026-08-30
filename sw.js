// Chat Service Worker - PWA offline support
const CACHE = 'chat-v3';
const ASSETS = [
    '/',
    '/index.html',
    '/css/style.css?v=3',
    '/js/network.js?v=3',
    '/js/app.js?v=3',
    '/manifest.json?v=3',
    '/icons/icon.svg',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/icons/icon-maskable-512.png',
    '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    // Only cache same-origin GET requests; skip WebSocket and API calls
    if (e.request.method !== 'GET') return;
    const url = new URL(e.request.url);
    if (url.hostname !== self.location.hostname) return;

    // Network-first: 네트워크 우선, 실패 시 캐시 폴백
    // 모든 기기가 항상 최신 코드를 받도록 보장
    const networkResult = fetch(e.request).then(res => {
        let cacheWrite = Promise.resolve();
        if (res.ok) {
            const copy = res.clone();
            cacheWrite = caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return { response: res, cacheWrite };
    });

    e.waitUntil(
        networkResult
            .then(result => result.cacheWrite)
            .catch(() => {})
    );
    e.respondWith(
        networkResult
            .then(result => result.response)
            .catch(() => caches.match(e.request))
    );
});
