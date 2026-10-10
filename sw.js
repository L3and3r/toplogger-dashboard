// Service worker voor de online versie (GitHub Pages) — maakt het dashboard
// installeerbaar en bruikbaar zonder verbinding.
//
//   app-shell (pagina, Chart.js, manifest, iconen)  precache, daarna stale-while-revalidate
//   data/*.json (versleutelde dashboards)           network-first, offline de laatst bekende
//   afbeeldingen van andere domeinen (avatars)      cache-first, max. AVATAR_LIMIT stuks
//
// publish.py vervangt "tl-v1" hieronder door een hash van de shell-bestanden:
// elke publicatie met een gewijzigde pagina levert zo een nieuwe service worker
// op, en de pagina toont dan "Nieuwe versie beschikbaar".
const CACHE = "tl-bc45f395e6b1";
const SHELL_CACHE = CACHE + "-shell";
// Data en avatars los van de versie, zodat een update de offline data niet wist.
const DATA_CACHE = "tl-data";
const IMG_CACHE = "tl-img";
const AVATAR_LIMIT = 100;
// Header op een respons uit de cache, zodat de pagina "offline" kan tonen.
const OFFLINE_HEADER = "X-TL-Offline";

const SHELL = [
  "./",
  "vendor/chart.umd.min.js",
  "manifest.json",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
];

self.addEventListener("install", event => {
  // Los toevoegen: één ontbrekend bestand mag de installatie niet laten mislukken.
  event.waitUntil(caches.open(SHELL_CACHE).then(cache =>
    Promise.all(SHELL.map(url => cache.add(new Request(url, {cache: "reload"})).catch(() => {})))));
});

self.addEventListener("activate", event => {
  const keep = [SHELL_CACHE, DATA_CACHE, IMG_CACHE];
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (!keep.includes(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// De pagina vraagt hierom na een klik op "vernieuwen" in de update-melding.
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("Authorization")) return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.includes("/data/") && url.pathname.endsWith(".json")) {
      event.respondWith(networkFirst(req));
    } else if (req.mode === "navigate") {
      event.respondWith(staleWhileRevalidate(req, "./"));
    } else {
      event.respondWith(staleWhileRevalidate(req));
    }
  } else if (req.destination === "image") {
    event.respondWith(cacheFirstImage(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req, {ignoreSearch: true});
    if (!cached) throw e;
    const headers = new Headers(cached.headers);
    headers.set(OFFLINE_HEADER, "1");
    return new Response(cached.body, {status: cached.status, statusText: cached.statusText, headers});
  }
}

async function staleWhileRevalidate(req, fallbackUrl) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req, {ignoreSearch: true})
    || (fallbackUrl && await cache.match(fallbackUrl));
  const network = fetch(req).then(res => {
    if (res.ok) cache.put(fallbackUrl || req, res.clone());
    return res;
  });
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  return network;
}

async function cacheFirstImage(req) {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  // Avatars komen als no-cors (opaque, status 0) binnen; die mogen ook.
  if (res.ok || res.type === "opaque") {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (const key of keys.slice(0, Math.max(0, keys.length - AVATAR_LIMIT))) await cache.delete(key);
  }
  return res;
}
