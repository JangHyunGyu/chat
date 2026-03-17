// Chat Service Worker - PWA offline support
const CACHE = 'chat-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/network.js',
    '/js/app.js',
    '/manifest.json',
    '/icons/icon.svg',
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
    e.respondWith(
        fetch(e.request).then(res => {
            if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then(c => c.put(e.request, copy));
            }
            return res;
        }).catch(() => caches.match(e.request))
    );
});
