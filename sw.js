// Post-Kamera Service Worker
// App-Dateien: Netz zuerst (immer neueste Fassung), offline aus dem Speicher.
// Scanner-Bibliothek opencv.js (~10 MB): Speicher zuerst – wird nur einmal geladen.
const CACHE = "post-kamera-v2";
const OPENCV = "post-kamera-opencv-4.10";
const DATEIEN = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE && n !== OPENCV).map((n) => caches.delete(n))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Filen/GitHub nie zwischenspeichern
  if (url.pathname.endsWith("/opencv.js")) {
    e.respondWith(caches.open(OPENCV).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { const kopie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, kopie)); return r; }).catch(() => caches.match(e.request)));
});
