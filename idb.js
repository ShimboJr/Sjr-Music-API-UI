/* =====================================================
   SJrMusic – idb.js
   IndexedDB abstraction module.

   Provides a clean, Promise-based API for:
     • Song metadata cache (from the API)
     • Favourites persistence (mirrors localStorage)
     • Downloaded song metadata
     • Pending play events (offline → online sync)

   SECURITY: No backend credentials or Supabase keys
   are ever stored here. Only public music metadata
   and anonymous play event identifiers.

   Usage:
     await SJrIDB.open();
     await SJrIDB.putSong(songObj);
     const songs = await SJrIDB.getAllSongs();
     await SJrIDB.addPendingPlay(event);
     const pending = await SJrIDB.getPendingPlays();
   ===================================================== */

/* eslint-disable no-use-before-define */

const SJrIDB = (() => {

  const DB_NAME    = 'sjrmusic-db';
  const DB_VERSION = 1;

  /* ── Object store names ─────────────────────── */
  const STORE_SONGS    = 'songs';          /* Music catalogue metadata */
  const STORE_FAVS     = 'favourites';     /* Favourited songs */
  const STORE_DOWNLOADS = 'downloads';     /* Offline-available songs */
  const STORE_PENDING  = 'pendingPlays';   /* Unsynced play events */

  let _db = null; /* singleton connection */

  /* ── open() ─────────────────────────────────────
   * Opens (or upgrades) the IndexedDB database.
   * Safe to call multiple times — returns cached
   * connection on subsequent calls.
   * @returns {Promise<IDBDatabase>}
   ─────────────────────────────────────────────── */
  function open() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('[SJrIDB] IndexedDB not supported in this browser.'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        /* ── songs store ── key: song id (string) ── */
        if (!db.objectStoreNames.contains(STORE_SONGS)) {
          const store = db.createObjectStore(STORE_SONGS, { keyPath: 'id' });
          store.createIndex('title',    'title',    { unique: false });
          store.createIndex('artist',   'artist',   { unique: false });
          store.createIndex('category', 'category', { unique: false });
        }

        /* ── favourites store ── key: favKey (title|artist string) ── */
        if (!db.objectStoreNames.contains(STORE_FAVS)) {
          db.createObjectStore(STORE_FAVS, { keyPath: 'favKey' });
        }

        /* ── downloads store ── key: song id (string) ── */
        if (!db.objectStoreNames.contains(STORE_DOWNLOADS)) {
          const dl = db.createObjectStore(STORE_DOWNLOADS, { keyPath: 'id' });
          dl.createIndex('downloadedAt', 'downloadedAt', { unique: false });
        }

        /* ── pendingPlays store ── key: eventId (UUID) ── */
        if (!db.objectStoreNames.contains(STORE_PENDING)) {
          const pp = db.createObjectStore(STORE_PENDING, { keyPath: 'eventId' });
          pp.createIndex('createdAt', 'createdAt', { unique: false });
        }

        console.info('[SJrIDB] Database created / upgraded to v', DB_VERSION);
      };

      req.onsuccess = (e) => {
        _db = e.target.result;

        /* Handle version change from another tab */
        _db.onversionchange = () => {
          _db.close();
          _db = null;
          console.warn('[SJrIDB] Database version changed — connection closed. Reload the page.');
        };

        console.info('[SJrIDB] Opened database:', DB_NAME);
        resolve(_db);
      };

      req.onerror = (e) => {
        console.error('[SJrIDB] Failed to open database:', e.target.error);
        reject(e.target.error);
      };

      req.onblocked = () => {
        console.warn('[SJrIDB] Database upgrade blocked by another open tab.');
      };
    });
  }

  /* ── Generic transaction helpers ─────────────── */

  function tx(storeName, mode, action) {
    return open().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const req = action(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    }));
  }

  function txAll(storeName) {
    return open().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    }));
  }

  /* ── Utility: normalise song id ──────────────── */
  function normId(song) {
    const raw = song.id ?? song._id ?? null;
    return raw != null ? String(raw) : null;
  }

  function normSong(song) {
    /* Always store with a string 'id' as keyPath */
    const id = normId(song);
    if (!id) return null;
    return { ...song, id };
  }

  function favKey(song) {
    return `${(song.title  || '').trim().toLowerCase()}|${(song.artist || '').trim().toLowerCase()}`;
  }

  /* ═══════════════════════════════════════════════
     SONGS  (music catalogue cache)
     ═══════════════════════════════════════════════ */

  /**
   * Store a single song object (upsert).
   * @param {object} song Raw song from API
   */
  function putSong(song) {
    const s = normSong(song);
    if (!s) return Promise.resolve();
    return tx(STORE_SONGS, 'readwrite', store => store.put(s));
  }

  /**
   * Store an array of songs (bulk upsert).
   * @param {object[]} songs
   */
  function putSongs(songs) {
    return open().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_SONGS, 'readwrite');
      const store = transaction.objectStore(STORE_SONGS);
      let pending = 0;
      let errored = false;

      songs.forEach(song => {
        const s = normSong(song);
        if (!s) return;
        pending++;
        const req = store.put(s);
        req.onerror = () => { errored = true; };
      });

      transaction.oncomplete = () => resolve(pending);
      transaction.onerror    = () => reject(errored);
    }));
  }

  /**
   * Retrieve a single song by id.
   * @param {string|number} id
   * @returns {Promise<object|undefined>}
   */
  function getSong(id) {
    return tx(STORE_SONGS, 'readonly', store => store.get(String(id)));
  }

  /**
   * Retrieve all cached songs.
   * @returns {Promise<object[]>}
   */
  function getAllSongs() {
    return txAll(STORE_SONGS);
  }

  /**
   * Clear the entire songs cache (e.g. after a successful fresh fetch).
   */
  function clearSongs() {
    return tx(STORE_SONGS, 'readwrite', store => store.clear());
  }

  /* ═══════════════════════════════════════════════
     FAVOURITES
     ═══════════════════════════════════════════════ */

  /**
   * Add a song to favourites (upsert).
   * @param {object} song
   */
  function putFavourite(song) {
    return tx(STORE_FAVS, 'readwrite', store => store.put({ ...song, favKey: favKey(song) }));
  }

  /**
   * Remove a song from favourites.
   * @param {object} song
   */
  function removeFavourite(song) {
    return tx(STORE_FAVS, 'readwrite', store => store.delete(favKey(song)));
  }

  /**
   * Get all favourited songs.
   * @returns {Promise<object[]>}
   */
  function getFavourites() {
    return txAll(STORE_FAVS);
  }

  /**
   * Bulk-replace the favourites store from a songs array
   * (used to sync from localStorage on first open).
   * @param {object[]} songs
   */
  function setFavourites(songs) {
    return open().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_FAVS, 'readwrite');
      const store = transaction.objectStore(STORE_FAVS);
      store.clear();
      songs.forEach(song => store.put({ ...song, favKey: favKey(song) }));
      transaction.oncomplete = resolve;
      transaction.onerror    = () => reject(transaction.error);
    }));
  }

  /* ═══════════════════════════════════════════════
     DOWNLOADS  (offline-available songs)
     ═══════════════════════════════════════════════ */

  /**
   * Mark a song as downloaded / available offline.
   * Stores metadata only — NOT the audio binary.
   * Audio files should be stored in Cache Storage via the
   * service worker when an explicit "Save for Offline"
   * action is triggered.
   * @param {object} song
   */
  function markDownloaded(song) {
    const s = normSong(song);
    if (!s) return Promise.resolve();
    return tx(STORE_DOWNLOADS, 'readwrite', store => store.put({
      ...s,
      downloadedAt: new Date().toISOString(),
      availableOffline: true,
    }));
  }

  /**
   * Remove a song from the downloads store.
   * @param {string|number} id
   */
  function removeDownload(id) {
    return tx(STORE_DOWNLOADS, 'readwrite', store => store.delete(String(id)));
  }

  /**
   * Get all downloaded songs metadata.
   * @returns {Promise<object[]>}
   */
  function getDownloads() {
    return txAll(STORE_DOWNLOADS);
  }

  /**
   * Check if a song is marked as available offline.
   * @param {string|number} id
   * @returns {Promise<boolean>}
   */
  function isDownloaded(id) {
    return tx(STORE_DOWNLOADS, 'readonly', store => store.get(String(id)))
      .then(result => !!result);
  }

  /* ═══════════════════════════════════════════════
     PENDING PLAYS  (offline play-count queue)
     ═══════════════════════════════════════════════ */

  /**
   * Queue a play event that could not be sent (offline).
   *
   * Payload shape (mirrors what registerPlayCount sends):
   * {
   *   eventId:         string  — UUID per play session (dedup key)
   *   sessionId:       string  — stable page-load UUID
   *   songId:          string  — song identifier
   *   listenedSeconds: number  — seek-proof accumulated time
   *   duration:        number  — total song duration
   *   createdAt:       string  — ISO timestamp
   * }
   *
   * SECURITY: no credentials stored here.
   * @param {object} event
   */
  function addPendingPlay(event) {
    if (!event || !event.eventId) {
      console.warn('[SJrIDB] addPendingPlay: missing eventId — skipped');
      return Promise.resolve();
    }
    const record = {
      ...event,
      createdAt: event.createdAt || new Date().toISOString(),
    };
    return tx(STORE_PENDING, 'readwrite', store => store.put(record))
      .then(() => {
        console.info('[SJrIDB] Pending play queued — eventId:', event.eventId, '| songId:', event.songId);
      });
  }

  /**
   * Get all pending play events (ordered by createdAt ascending).
   * @returns {Promise<object[]>}
   */
  function getPendingPlays() {
    return txAll(STORE_PENDING).then(plays =>
      plays.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    );
  }

  /**
   * Remove a successfully-synced play event.
   * @param {string} eventId
   */
  function removePendingPlay(eventId) {
    return tx(STORE_PENDING, 'readwrite', store => store.delete(eventId))
      .then(() => {
        console.info('[SJrIDB] Pending play synced and removed — eventId:', eventId);
      });
  }

  /**
   * Get the number of pending play events (for diagnostic logging).
   * @returns {Promise<number>}
   */
  function getPendingPlayCount() {
    return open().then(db => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_PENDING, 'readonly');
      const store = transaction.objectStore(STORE_PENDING);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    }));
  }

  /* ── Public API ─────────────────────────────── */
  return {
    open,

    /* Songs */
    putSong,
    putSongs,
    getSong,
    getAllSongs,
    clearSongs,

    /* Favourites */
    putFavourite,
    removeFavourite,
    getFavourites,
    setFavourites,

    /* Downloads */
    markDownloaded,
    removeDownload,
    getDownloads,
    isDownloaded,

    /* Pending plays */
    addPendingPlay,
    getPendingPlays,
    removePendingPlay,
    getPendingPlayCount,
  };

})();
