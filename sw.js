/* =====================================================
   SJrMusic – sw.js  (Service Worker)

   Cache name versioning:
     Increment CACHE_NAME when app shell assets change.
     The activate handler auto-purges all older caches.

   Strategies:
     App shell (HTML/CSS/JS)   → Cache First (pre-cached at install)
     CDN assets (Bootstrap)    → Cache First (pre-cached at install)
     Google Fonts CSS          → Stale While Revalidate
     Cover art images          → Cache First (on demand, size-limited)
     GET /music catalogue      → Network First → Cache fallback
     POST /music/:id/play      → NEVER cached — always network passthrough
     Audio stream URLs         → NEVER cached — passthrough (no SW interference)
     CORS proxy URLs           → NEVER cached — passthrough

   Security:
     • No backend credentials cached
     • No Supabase secret keys
     • POST requests always bypass cache
     • Audio/media streams bypass cache completely
   ===================================================== */

const CACHE_NAME       = 'sjrmusic-v1';
const API_CACHE_NAME   = 'sjrmusic-api-v1';
const IMAGE_CACHE_NAME = 'sjrmusic-img-v1';

/* ── App shell — pre-cached at install time ─── */
const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/idb.js',
  '/offline.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

/* ── CDN assets — pre-cached at install time ─── */
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
];

/* ── Maximum number of cover art images to keep ── */
const IMAGE_CACHE_MAX = 200;

/* ── Patterns that MUST always bypass the cache ─ */
const BYPASS_PATTERNS = [
  /* Audio/media streams — any URL ending in audio extensions */
  /\.(mp3|mp4|ogg|wav|flac|aac|m4a|webm)(\?.*)?$/i,
  /* Cloudinary video/audio uploads */
  /cloudinary\.com\/.*\/video\//i,
  /cloudinary\.com\/.*\/audio\//i,
  /* CORS proxies */
  /corsproxy\.io/i,
  /allorigins\.win/i,
  /* Play-count POST endpoint is handled separately, but belt-and-suspenders */
  /\/music\/[^/]+\/play/i,
];

/* ── API origin ── */
const API_ORIGIN = 'sjr-music-api-gold.vercel.app';

/* ─────────────────────────────────────────────────────
   INSTALL — pre-cache the application shell
   ───────────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  console.info('[SW] Installing — cache name:', CACHE_NAME);

  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      /* Cache app shell (must-have) */
      try {
        await cache.addAll(APP_SHELL);
        console.info('[SW] App shell cached successfully.');
      } catch (err) {
        console.error('[SW] App shell cache failed:', err);
        /* Non-fatal — proceed even if one shell asset fails */
      }

      /* Cache CDN assets (best-effort — don't block install if CDN is down) */
      for (const url of CDN_ASSETS) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn('[SW] CDN asset cache failed (non-fatal):', url, err.message);
        }
      }

      /* skipWaiting so the new SW takes control immediately */
      await self.skipWaiting();
      console.info('[SW] Install complete — skipWaiting done.');
    })()
  );
});

/* ─────────────────────────────────────────────────────
   ACTIVATE — delete old cache versions
   ───────────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  console.info('[SW] Activating…');

  event.waitUntil(
    (async () => {
      /* Delete any cache that doesn't match our current named caches */
      const validCaches = new Set([CACHE_NAME, API_CACHE_NAME, IMAGE_CACHE_NAME]);
      const existingKeys = await caches.keys();

      await Promise.all(
        existingKeys
          .filter(key => !validCaches.has(key))
          .map(key => {
            console.info('[SW] Deleting obsolete cache:', key);
            return caches.delete(key);
          })
      );

      /* Take control of all open clients immediately */
      await self.clients.claim();
      console.info('[SW] Activated — controlling all clients.');
    })()
  );
});

/* ─────────────────────────────────────────────────────
   FETCH — request interception & routing
   ───────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  /* ── Non-GET requests always go to the network ── */
  if (request.method !== 'GET') {
    /* POST /music/:id/play and all other non-GET requests pass through */
    return; /* browser default behaviour */
  }

  /* ── Bypass patterns — audio streams, proxies, etc. ── */
  if (BYPASS_PATTERNS.some(pattern => pattern.test(request.url))) {
    return; /* don't intercept */
  }

  /* ── Google Fonts CSS → Stale While Revalidate ── */
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(request, CACHE_NAME));
    return;
  }

  /* ── Google Fonts files → Cache First ── */
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  /* ── Bootstrap CDN / jsDelivr → Cache First ── */
  if (url.hostname === 'cdn.jsdelivr.net') {
    event.respondWith(cacheFirst(request, CACHE_NAME));
    return;
  }

  /* ── Music API (GET /music) → Network First → Cache fallback ── */
  if (url.hostname === API_ORIGIN) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  /* ── Song cover art (Cloudinary images, not audio) → Cache First ── */
  if (
    url.hostname.includes('cloudinary.com') &&
    !BYPASS_PATTERNS.some(p => p.test(request.url))
  ) {
    event.respondWith(cacheFirstImage(request));
    return;
  }

  /* ── App shell (same-origin HTML/CSS/JS) → Cache First ── */
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithOfflineFallback(request));
    return;
  }

  /* ── Everything else → Network only ── */
  /* (External resources we don't control) */
});

/* ─────────────────────────────────────────────────────
   STRATEGY: Cache First
   Returns cached response if available, else fetches
   and stores the response.
   ───────────────────────────────────────────────────── */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      /* Clone before consuming — fetch responses are single-use */
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    console.warn('[SW] cacheFirst fetch failed:', request.url, err.message);
    throw err;
  }
}

/* ─────────────────────────────────────────────────────
   STRATEGY: Cache First with Offline Fallback
   For same-origin app shell pages.
   If both cache and network fail, serve offline.html.
   ───────────────────────────────────────────────────── */
async function cacheFirstWithOfflineFallback(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    /* Network failed and not in cache — serve offline fallback */
    const offlinePage = await cache.match('/offline.html');
    if (offlinePage) return offlinePage;

    /* Ultimate fallback — minimal offline response */
    return new Response(
      '<html><body><h1>Offline</h1><p>Please check your connection and try again.</p></body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

/* ─────────────────────────────────────────────────────
   STRATEGY: Stale While Revalidate
   Serves cached version immediately while fetching an
   update in the background.
   ───────────────────────────────────────────────────── */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  /* Kick off the network fetch in the background */
  const fetchPromise = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(err => {
    console.warn('[SW] SWR background fetch failed:', request.url, err.message);
  });

  /* Return cached immediately, or wait for network if no cache */
  return cached || fetchPromise;
}

/* ─────────────────────────────────────────────────────
   STRATEGY: Network First → Cache fallback (API)
   Used for GET /music catalogue requests.
   Tries network first to get fresh data; falls back to
   cached data when offline.
   Stores successful responses in the API cache.
   ───────────────────────────────────────────────────── */
async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE_NAME);

  try {
    const response = await fetch(request.clone(), { cache: 'no-store' });

    if (response.ok) {
      /* Store a fresh copy for offline fallback */
      cache.put(request, response.clone());
      return response;
    }

    /* Server returned an error status — try cache */
    throw new Error(`API returned ${response.status}`);

  } catch (err) {
    console.warn('[SW] API network fetch failed, trying cache:', err.message);

    const cached = await cache.match(request);
    if (cached) {
      console.info('[SW] Serving API response from cache (offline fallback).');
      return cached;
    }

    /* No cache and no network — return a structured offline error */
    return new Response(
      JSON.stringify({ offline: true, error: 'Network unavailable and no cached data.' }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

/* ─────────────────────────────────────────────────────
   STRATEGY: Cache First (Images) with LRU eviction
   Caches cover art images up to IMAGE_CACHE_MAX entries.
   Older entries are pruned when the limit is reached.
   ───────────────────────────────────────────────────── */
async function cacheFirstImage(request) {
  const cache = await caches.open(IMAGE_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (!response.ok) return response;

    /* Prune oldest entries if over limit before adding new one */
    const keys = await cache.keys();
    if (keys.length >= IMAGE_CACHE_MAX) {
      /* Delete the oldest IMAGE_CACHE_MAX / 4 entries */
      const deleteCount = Math.ceil(IMAGE_CACHE_MAX / 4);
      await Promise.all(keys.slice(0, deleteCount).map(k => cache.delete(k)));
      console.info(`[SW] Image cache pruned — removed ${deleteCount} oldest entries.`);
    }

    cache.put(request, response.clone());
    return response;
  } catch (err) {
    console.warn('[SW] Image fetch failed:', request.url, err.message);
    /* Return a transparent 1×1 pixel PNG as placeholder */
    return new Response(
      new Uint8Array([
        137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,
        0,0,0,1,8,6,0,0,0,31,21,196,137,0,0,0,11,73,68,65,84,
        8,215,99,96,96,96,96,0,0,0,5,0,1,90,197,74,89,0,0,0,0,73,
        69,78,68,174,66,96,130
      ]),
      { headers: { 'Content-Type': 'image/png' } }
    );
  }
}

/* ─────────────────────────────────────────────────────
   MESSAGE HANDLER
   Allows the main app to communicate with the SW.
   Currently supports:
     • { type: 'SKIP_WAITING' }  — force update
     • { type: 'GET_VERSION' }   — returns cache name
   ───────────────────────────────────────────────────── */
self.addEventListener('message', (event) => {
  if (!event.data) return;

  switch (event.data.type) {
    case 'SKIP_WAITING':
      console.info('[SW] SKIP_WAITING received — activating immediately.');
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      event.source?.postMessage({
        type: 'SW_VERSION',
        cacheName: CACHE_NAME,
        apiCacheName: API_CACHE_NAME,
      });
      break;

    default:
      /* Unknown message — ignore */
  }
});
