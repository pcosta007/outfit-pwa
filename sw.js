

// Minimal, robust service worker for Outfit Planner PWA
// v1 — bump CACHE names when you ship changes

const APP_CACHE = "outfit-pwa-app-v1";           // App shell (HTML/manifest)
const RUNTIME_CACHE = "outfit-pwa-runtime-v1";    // Runtime assets (images, etc.)

// Files to precache so the app opens offline
const APP_SHELL = [
  "./",                  // root (may map to index.html depending on host)
  "./index.html",
  "./manifest.webmanifest"
  // TIP: Do NOT list large media here. They will be cached on-demand at runtime.
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  // Activate immediately after install
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Clean up old caches
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== APP_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );

    // Enable Navigation Preload when available (speeds up nav fetch)
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (_) {}
    }
  })());

  // Take control of open clients immediately
  self.clients.claim();
});

// Utility: Cache-first for same-origin GET requests
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  } catch (_) {}
  return response;
}

// Utility: Stale-while-revalidate for images
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const netFetch = fetch(request).then((resp) => {
    cache.put(request, resp.clone()).catch(() => {});
    return resp;
  }).catch(() => undefined);
  return cached || netFetch || new Response("", { status: 504 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Handle navigation requests (address bar / link clicks)
  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        // Prefer network (fresh content), fall back to precache, then cached index
        const preload = await event.preloadResponse;
        if (preload) return preload;
        const net = await fetch(request);
        return net;
      } catch (_) {
        // Offline fallback: cached app shell (index.html)
        const cached = await caches.match("./index.html");
        return cached || new Response("Offline", { status: 503, statusText: "Offline" });
      }
    })());
    return;
  }

  // Image assets: use stale-while-revalidate for snappy UX
  if (request.destination === "image" || url.pathname.startsWith("/media/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Default: cache-first for same-origin static files (CSS/JS/fonts/etc.)
  event.respondWith(cacheFirst(request));
});

// Allow the page to trigger an update cycle
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});