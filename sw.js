// Rory's Talk Trail service worker.
// Network first, so the app is always the latest version when online; falls back to the
// cached copy when offline. CI replaces 1944406-test20 on every deploy so new versions take over.
const CACHE = 'speechapp-test-1944406-test20';
// Files whose name changes whenever their content does (the .wasm, Rory's voice clips) live here
// across versions, so they're only downloaded once; old ones are tidied up below.
const STATIC = 'speechapp-test-static';

// Every file of this build (CI fills this in), so the whole app works offline after one visit.
const PRECACHE = ["audio/letters.html", "audio/manifest.json", "bccfa839aa4b38489c76.wasm", "cecfb4a06ba9230ee2b2.wasm", "composeResources/com.zeronolidge.speechapp.res/font/andika_bold.ttf", "composeResources/com.zeronolidge.speechapp.res/font/noto_color_emoji.ttf", "composeResources/com.zeronolidge.speechapp.res/font/sniglet_extrabold.ttf", "composeResources/com.zeronolidge.speechapp.res/font/sniglet_regular.ttf", "icon-192.png", "icon-512.png", "icon-maskable-512.png", "index.html", "manifest.webmanifest", "talkandlearn.js", "talkandlearn.js.LICENSE.txt", "talkandlearn.js.map"];

const lasting = (path) => path.endsWith('.wasm') || /audio\/[0-9a-f-]+\.mp3$/.test(path);

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(Promise.all([caches.open(CACHE), caches.open(STATIC)]).then(([c, s]) =>
        Promise.all(['./'].concat(PRECACHE).map((f) =>
            // One file failing (e.g. a flaky connection) doesn't stop the rest being saved.
            // Long-lived files already saved by an earlier version aren't downloaded again.
            lasting(f) ? s.match(f).then((hit) => hit || s.add(f)).catch(() => {}) : c.add(f).catch(() => {})
        ))
    ));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k.startsWith('speechapp-test-') && k !== CACHE && k !== STATIC && k !== 'speechapp-test-vosk').map((k) => caches.delete(k))))
            // Keep only the .wasm files and voice clips this version uses.
            .then(() => Promise.all([
                fetch('./talkandlearn.js').then((r) => r.text()),
                fetch('./audio/manifest.json').then((r) => r.ok ? r.text() : '').catch(() => ''),
            ]).then(([js, clips]) => caches.open(STATIC).then((c) =>
                c.keys().then((reqs) => Promise.all(reqs.filter((r) => {
                    const name = new URL(r.url).pathname.split('/').pop();
                    return !(name.endsWith('.mp3') ? clips : js).includes(name);
                }).map((r) => c.delete(r))))
            )).catch(() => {}))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    const url = new URL(req.url);
    if (req.method !== 'GET' || url.origin !== self.location.origin) return;
    // Word listening's files (vosk/) look after their own storage (WebWords.kt): left alone here,
    // so the 40 MB model is never kept twice.
    if (url.pathname.includes('/vosk/')) return;
    // The big .wasm files and the voice clips have a new name whenever they change, so use the
    // saved copy straight away (only fetch new ones). Saves ~12 MB of app and ~35 MB of clips per launch.
    if (lasting(url.pathname)) {
        e.respondWith(
            caches.match(req).then((hit) => hit || fetch(req).then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(STATIC).then((c) => c.put(req, copy));
                }
                return res;
            }))
        );
        return;
    }
    e.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, copy));
                }
                return res;
            })
            .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
    );
});
