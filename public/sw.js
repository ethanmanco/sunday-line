// Sunday Line service worker (11.43): makes the site installable and shows
// push notifications. It doesn't cache pages, so the site is always current.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

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
