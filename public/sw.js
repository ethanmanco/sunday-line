// Sunday Line service worker (11.43): makes the site installable, shows push
// notifications, and (11.83) keeps the app and kept roads working with no signal.
//
// Online, pages and data always come from the network, so the site is current;
// the copies here are only used when the network doesn't answer.
//   sl-static   the app's own files (/_next/static, fonts, icons): named by
//               content, so a cached copy is never out of date
//   sl-pages    the last copy of the home page, the shell to open offline
//   sl-data     the road index files, for the map offline
//   sl-offline  what "Keep offline" saved for a road: its square, and the map,
//               terrain and label tiles along it (lib/offline.ts writes these)

const STATIC = "sl-static-v1";
const PAGES = "sl-pages-v1";
const DATA = "sl-data-v1";
const OFFLINE = "sl-offline-v1";
const KEEP = new Set([STATIC, PAGES, DATA, OFFLINE]);
// How long to wait for the network before using a saved copy (weak signal).
const WAIT_MS = 6000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("sl-") && !KEEP.has(k)) await caches.delete(k);
  await self.clients.claim();
})()));

function timed(promise) {
  return Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error("slow")), WAIT_MS))]);
}

// The network first; a saved copy if it fails or is too slow.
async function networkFirst(req, cacheName, save) {
  try {
    const res = await timed(fetch(req));
    if (save && res.ok) {
      const copy = res.clone();
      caches.open(cacheName).then((c) => c.put(req.url, copy)).catch(() => {});
    }
    return res;
  } catch (e) {
    const hit = await caches.match(req.url, { cacheName });
    if (hit) return hit;
    throw e;
  }
}

// A saved copy first (it never changes); the network otherwise.
async function cacheFirst(req, cacheName, save) {
  const hit = await caches.match(req.url, { cacheName });
  if (hit) return hit;
  const res = await fetch(req);
  if (save && res.ok) {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req.url, copy)).catch(() => {});
  }
  return res;
}

const TILE = /(tiles\.openfreemap\.org\/(planet\/|fonts\/)|\/streets\/|elevation-tiles-prod\/terrarium\/)/;
const CELL = /sunday-line-data\/cells\/-?\d+_-?\d+\.json$|\/data\/us\/cells\/-?\d+_-?\d+\.json$/;

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const here = url.origin === self.location.origin;

  if (req.mode === "navigate" && here) {
    // Pages: always the network; offline, the page if saved, else the home page (the app shell).
    event.respondWith((async () => {
      try {
        const res = await timed(fetch(req));
        if (res.ok && url.pathname === "/") {
          const copy = res.clone();
          caches.open(PAGES).then((c) => c.put("/", copy)).catch(() => {});
        }
        return res;
      } catch (e) {
        return (await caches.match(url.pathname, { cacheName: PAGES })) || (await caches.match("/", { cacheName: PAGES })) || Promise.reject(e);
      }
    })());
    return;
  }
  if (here && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/maplibre/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith(cacheFirst(req, STATIC, true));
    return;
  }
  if (here && /^\/data\/us\/(index|top|road-cells|moved)\.json$/.test(url.pathname)) {
    event.respondWith(networkFirst(req, DATA, url.pathname !== "/data/us/road-cells.json"));
    return;
  }
  if (/^https:\/\/tiles\.openfreemap\.org\/planet$/.test(url.href) || (here && url.pathname === "/streets")) {
    // The street map's tile list: current online, the kept copy offline.
    event.respondWith(networkFirst(req, OFFLINE, false));
    return;
  }
  if (CELL.test(url.href)) {
    // A kept road's square: current online, the kept copy offline.
    event.respondWith(networkFirst(req, OFFLINE, false));
    return;
  }
  if (TILE.test(url.href)) {
    // Map tiles and labels: a kept copy if there is one (they hardly change).
    event.respondWith(cacheFirst(req, OFFLINE, false));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  // The number on the installed app's icon (11.76), where the phone supports it.
  const badge = typeof data.badge === "number" && self.navigator.setAppBadge
    ? (data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {})
    : Promise.resolve();
  event.waitUntil(
    badge.then(() => self.registration.showNotification(data.title || "Sunday Line", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/notifications" },
    })),
  );
});

// Tapping a notification opens it in an open Sunday Line window, or a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notifications", self.location.origin);
  const target = url.origin === self.location.origin ? url.href : new URL("/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "navigate" in w) {
          return w.navigate(target).then((c) => (c || w).focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
