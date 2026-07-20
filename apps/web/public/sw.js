const CACHE_NAME = "family-app-pwa-v13";
const RESOURCE_CACHE_NAME = "family-app-resources-v1";
const RESOURCE_CACHE_PREFIX = "family-app-resources-";
const RESOURCE_CACHE_MAX_ENTRIES = 120;
const RESOURCE_CACHE_MAX_FILE_BYTES = 64 * 1024 * 1024;
const STATIC_PATHS = [
  "/family-logo-v2-192.png",
  "/family-logo-v2-512.png",
  "/family-logo-v2-maskable-512.png",
  "/family-logo-v2-apple-touch.png",
  "/family-logo-v2.png",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_PATHS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME && key !== RESOURCE_CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "family-cache-resources" && Array.isArray(event.data.urls)) {
    event.waitUntil(warmResourceCache(event.data.urls));
    return;
  }
  if (event.data?.type === "family-clear-resource-cache") {
    event.waitUntil(clearResourceCaches());
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isStoredResourceUrl(url)) {
    event.respondWith(resourceCacheFirst(request));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.pathname.startsWith("/resource-icons/") || url.pathname.startsWith("/stickers/") || STATIC_PATHS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(new Request(request, { cache: "no-store" })));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    return;
  }
  if (!payload || typeof payload.title !== "string" || typeof payload.id !== "string") {
    return;
  }
  const unreadCount = Number.isFinite(payload.unreadCount) ? Math.max(0, payload.unreadCount) : 0;
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(payload.title, {
        body: typeof payload.body === "string" ? payload.body : "",
        icon: "/family-logo-v2-192.png",
        badge: "/family-logo-v2-192.png",
        tag: `family-notification-${payload.id}`,
        renotify: false,
        data: { id: payload.id, deepLink: typeof payload.deepLink === "string" ? payload.deepLink : "/" }
      }),
      unreadCount > 0 && self.registration.setAppBadge ? self.registration.setAppBadge(unreadCount) : Promise.resolve(),
      clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) =>
        Promise.all(windows.map((client) => client.postMessage({ type: "family-notification-received", id: payload.id })))
      )
    ])
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink = event.notification.data && typeof event.notification.data.deepLink === "string" ? event.notification.data.deepLink : "/";
  const notificationId = event.notification.data && typeof event.notification.data.id === "string" ? event.notification.data.id : "";
  const targetUrl = new URL(deepLink, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const current = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (current) {
        current.postMessage({ type: "family-notification-open", id: notificationId, deepLink });
        return current.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (response.ok) {
    cache.put(request, response.clone());
  }
  return response;
}

async function resourceCacheFirst(request) {
  const cache = await caches.open(RESOURCE_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (canStoreResourceResponse(request, response)) {
    await cache.put(request, response.clone());
    await trimResourceCache(cache);
  }
  return response;
}

async function warmResourceCache(urls) {
  const uniqueUrls = [...new Set(urls.filter((value) => typeof value === "string"))].slice(0, RESOURCE_CACHE_MAX_ENTRIES);
  for (const value of uniqueUrls) {
    try {
      const url = new URL(value, self.location.origin);
      if (url.origin !== self.location.origin || !isStoredResourceUrl(url)) continue;
      await resourceCacheFirst(new Request(url.href, { credentials: "same-origin" }));
    } catch {
      // A failed background warm-up must not affect the visible resource list.
    }
  }
}

function isStoredResourceUrl(url) {
  return url.pathname === "/api/guest-uploads";
}

function canStoreResourceResponse(request, response) {
  if (!response.ok || response.status !== 200 || response.headers.has("content-range")) return false;
  const contentLength = Number(response.headers.get("content-length") || "0");
  if (contentLength > RESOURCE_CACHE_MAX_FILE_BYTES) return false;

  const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (contentType.startsWith("image/") || contentType.startsWith("text/")) return true;
  if ([
    "application/pdf",
    "application/msword",
    "application/rtf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ].includes(contentType)) return true;

  const url = new URL(request.url);
  const fileName = url.searchParams.get("file") || "";
  return /\.(?:csv|docx?|md|pdf|pptx?|rtf|txt|xlsx?)$/i.test(fileName);
}

async function trimResourceCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - RESOURCE_CACHE_MAX_ENTRIES;
  if (overflow > 0) {
    await Promise.all(keys.slice(0, overflow).map((key) => cache.delete(key)));
  }
}

async function clearResourceCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith(RESOURCE_CACHE_PREFIX)).map((key) => caches.delete(key)));
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(new Request(request, { cache: "no-store" }));
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
}
