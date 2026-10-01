// Minimal offline shell: cache the app files; never cache /api/.
const CACHE = "yld-shell-v2";
const SHELL = ["/", "/index.html", "/styles.css", "/app.js", "/config.js", "/manifest.json", "/icons/icon.svg",
  "/core/index.js", "/core/content.js", "/core/day.js", "/core/format.js", "/core/fortunes.js", "/core/history.js", "/core/outcome.js", "/core/rng.js", "/core/share.js", "/core/streak.js"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/") || e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request)));
});
