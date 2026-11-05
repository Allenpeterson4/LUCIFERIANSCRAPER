const cacheName = "mailharvest-shell-v1";
const shellFiles = ["/", "/manifest.webmanifest", "/pwa-icon.svg"];

globalThis.addEventListener("install", (event) => {
  event.waitUntil(globalThis.caches.open(cacheName).then((cache) => cache.addAll(shellFiles)));
  void globalThis.skipWaiting();
});

globalThis.addEventListener("activate", (event) => {
  event.waitUntil(
    globalThis.caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => globalThis.caches.delete(key))))
      .then(() => globalThis.clients.claim()),
  );
});

globalThis.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) void globalThis.caches.open(cacheName).then((cache) => cache.put("/", response.clone()));
        return response;
      })
      .catch(() => globalThis.caches.match("/")),
  );
});