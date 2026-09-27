// Post-Kamera Service Worker: App-Dateien für schnellen Start zwischenspeichern.
// Online wird immer die neueste Fassung geladen (Netz zuerst), offline die gespeicherte.
const CACHE = "post-kamera-v1";
const DATEIEN = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(DATEIEN))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // Filen/GitHub nie zwischenspeichern
  e.respondWith(fetch(e.request).then((r) => { const kopie = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, kopie)); return r; }).catch(() => caches.match(e.request)));
});
