/* =====================================================
   SJr Music – app.js
   Fetches data from the SJr Music API and handles
   search / filter / card-display logic.
   ===================================================== */

const API_URL = 'https://sjr-music-api.onrender.com/music';

/* CORS proxies — only used as fallback if direct fetch fails */
const CORS_PROXIES = [
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
];

/* ── DOM references ─────────────────────────────── */
const searchTitleEl = document.getElementById('searchTitle');
const searchArtistEl = document.getElementById('searchArtist');
const searchAlbumEl = document.getElementById('searchAlbum');
const searchBtn = document.getElementById('searchBtn');
const clearBtn = document.getElementById('clearBtn');
const retryBtn = document.getElementById('retryBtn');

const loadingState = document.getElementById('loadingState');
const errorState = document.getElementById('errorState');
const emptyState = document.getElementById('emptyState');
const resultsWrapper = document.getElementById('resultsWrapper');
const resultsGrid = document.getElementById('resultsGrid');
const statusBar = document.getElementById('statusBar');
const statusText = document.getElementById('statusText');
const resultCount = document.getElementById('resultCount');

/* ── State ─────────────────────────────────────── */
let allSongs = [];

/* ── Initialise ─────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  fetchCatalogue();

  searchBtn.addEventListener('click', runSearch);
  clearBtn.addEventListener('click', clearSearch);
  retryBtn.addEventListener('click', fetchCatalogue);

  /* Search on Enter key in any input */
  [searchTitleEl, searchArtistEl, searchAlbumEl].forEach(input => {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  });

  /* Download – event delegation on the grid container */
  resultsGrid.addEventListener('click', e => {
    const btn = e.target.closest('.btn-download');
    if (btn && btn.dataset.url) {
      downloadSong(btn.dataset.url, btn.dataset.filename || 'song.mp3', btn);
    }
  });
});

/* ── Fetch from API (direct first, CORS-proxy fallback) ──── */
async function fetchCatalogue() {
  showState('loading');

  let data = null;
  let lastErr;

  /* 1️⃣  Try the API directly — works now that CORS is enabled on the backend */
  try {
    const res = await fetch(API_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    console.info('Fetched catalogue directly from API.');
  } catch (err) {
    lastErr = err;
    console.warn('Direct fetch failed, trying CORS proxies…', err);
  }

  /* 2️⃣  Fallback: try each CORS proxy in turn */
  if (!data) {
    for (const buildProxy of CORS_PROXIES) {
      try {
        const proxyUrl = buildProxy(API_URL);
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const json = await res.json();

        /* allorigins wraps the payload in { contents: "...", status: {} } */
        data = typeof json.contents === 'string' ? JSON.parse(json.contents) : json;
        console.info('Fetched catalogue via proxy:', proxyUrl);
        break;
      } catch (err) {
        lastErr = err;
        console.warn('Proxy attempt failed, trying next…', err);
      }
    }
  }

  if (!data) {
    console.error('Direct fetch and all proxies failed:', lastErr);
    showState('error');
    return;
  }

  /* Keep only records that have a title (skip placeholder rows) */
  allSongs = (Array.isArray(data) ? data : []).filter(
    s => s.title && s.title.trim() !== ''
  );

  showState('idle');
  setStatus(`Catalogue loaded — ${allSongs.length} songs available. Use the search above to find your music.`);
}

/* ── Search / Filter ───────────────────────────── */
function runSearch() {
  const qTitle = normalize(searchTitleEl.value);
  const qArtist = normalize(searchArtistEl.value);
  const qAlbum = normalize(searchAlbumEl.value);

  if (!qTitle && !qArtist && !qAlbum) {
    setStatus('Please enter at least one search term to get results.');
    showState('idle');
    return;
  }

  const filtered = allSongs.filter(song => {
    const titleMatch = !qTitle || normalize(song.title).includes(qTitle);
    const artistMatch = !qArtist || normalize(song.artist).includes(qArtist);
    const albumMatch = !qAlbum || normalize(song.album || '').includes(qAlbum);
    return titleMatch && artistMatch && albumMatch;
  });

  /* Sort alphabetically by title */
  filtered.sort((a, b) => a.title.localeCompare(b.title));

  renderResults(filtered, { qTitle, qArtist, qAlbum });
}

/* ── Clear ─────────────────────────────────────── */
function clearSearch() {
  searchTitleEl.value = '';
  searchArtistEl.value = '';
  searchAlbumEl.value = '';
  showState('idle');
  setStatus(`Catalogue loaded — ${allSongs.length} songs available. Use the search above to find your music.`);
}

/* ── Render (card grid with innerHTML +=) ────────── */
function renderResults(songs, query = {}) {
  if (songs.length === 0) {
    showState('empty');
    return;
  }

  /* Reset grid */
  resultsGrid.innerHTML = '';

  songs.forEach((song, idx) => {

    /* ── Song art ── */
    const isImageUrl = src =>
      src && src.trim() !== '' &&
      !(src.includes('/video/upload/') && !src.match(/\.(jpg|jpeg|png|webp|gif)$/i));

    const artHTML = isImageUrl(song.songArt)
      ? `<img
           src="${escAttr(song.songArt)}"
           alt="${escAttr(song.title)} cover art"
           class="card-art"
           loading="lazy"
           onerror="this.outerHTML='<div class=card-art-fallback><i class=\\'bi bi-music-note-beamed\\'></i></div>'"
         />`
      : `<div class="card-art-fallback"><i class="bi bi-music-note-beamed"></i></div>`;

    /* ── Detail rows — only render a row if value exists ── */
    const rows = [
      { label: 'Artist', value: escHtml(song.artist), cls: 'detail-artist' },
      { label: 'Featuring', value: escHtml(song.featuring || ''), cls: '' },
      { label: 'Category', value: escHtml(song.category || ''), cls: 'detail-category' },
      { label: 'Genre', value: escHtml(song.genre || ''), cls: '' },
      { label: 'Album', value: escHtml(song.album || ''), cls: '' },
      { label: 'Released', value: escHtml(song.released || ''), cls: '' },
    ]
      .filter(r => r.value.trim() !== '')
      .map(r => `
      <li class="detail-row">
        <span class="detail-label">${r.label}</span>
        <span class="detail-value ${r.cls}">${r.value}</span>
      </li>`)
      .join('');

    /* ── Audio preview ── */
    const audioHTML = isValidAudioUrl(song.songUrl)
      ? `<audio class="card-audio" controls preload="none">
           <source src="${escAttr(song.songUrl)}" type="audio/mpeg" />
         </audio>`
      : `<p class="no-preview"><i class="bi bi-slash-circle me-1"></i>Preview unavailable</p>`;

    /* ── Download button ── */
    const dlFilename = song.title + ' - ' + song.artist + '.mp3';
    const downloadHTML = isValidAudioUrl(song.songUrl)
      ? `<button
           class="btn-download"
           data-url="${escAttr(song.songUrl)}"
           data-filename="${escAttr(dlFilename)}">
           <i class="bi bi-download me-2"></i>Download ${escHtml(song.artist)} – ${escHtml(song.title)}
         </button>`
      : '';

    /* ── Card HTML ── */
    resultsGrid.innerHTML += `
      <div class="song-card" style="animation-delay:${Math.min(idx * 0.05, 0.5)}s">
        <div class="card-num">${idx + 1}</div>
        <div class="card-art-wrap">
          ${artHTML}
        </div>
        <div class="card-body">
          <h2 class="card-heading">
            <i class="bi bi-download me-2 card-heading-icon"></i>${escHtml(song.artist)} – ${escHtml(song.title)}
          </h2>
          <ul class="detail-list">
            ${rows}
          </ul>
          <div class="card-player">
            ${audioHTML}
          </div>
          ${downloadHTML}
        </div>
      </div>`;
  });

  showState('results');

  const labelParts = [];
  if (query.qTitle) labelParts.push(`title "${searchTitleEl.value}"`);
  if (query.qArtist) labelParts.push(`artist "${searchArtistEl.value}"`);
  if (query.qAlbum) labelParts.push(`album "${searchAlbumEl.value}"`);

  setStatus(
    `Showing results for ${labelParts.join(', ')} — sorted A–Z`,
    songs.length
  );
}

/* ── UI state manager ───────────────────────────── */
function showState(state) {
  loadingState.classList.add('d-none');
  errorState.classList.add('d-none');
  emptyState.classList.add('d-none');
  resultsWrapper.classList.add('d-none');

  if (state === 'loading') loadingState.classList.remove('d-none');
  if (state === 'error') errorState.classList.remove('d-none');
  if (state === 'empty') emptyState.classList.remove('d-none');
  if (state === 'results') resultsWrapper.classList.remove('d-none');
}

function setStatus(msg, count = null) {
  statusBar.classList.remove('d-none');
  statusText.textContent = msg;
  if (count !== null) {
    resultCount.textContent = `${count} result${count !== 1 ? 's' : ''}`;
    resultCount.style.display = 'inline-block';
  } else {
    resultCount.style.display = 'none';
  }
}

/* ── Helpers ─────────────────────────────────────── */
function normalize(str = '') {
  return str.trim().toLowerCase();
}

function escHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str = '') {
  return String(str).replace(/"/g, '&quot;');
}

function isValidAudioUrl(url = '') {
  if (!url || url.trim() === '') return false;
  return url.trim().startsWith('http');
}

/* ── Blob-based download (cross-origin safe) ─────── */
async function downloadSong(url, filename, btn) {
  const original = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split me-2"></i>Downloading…';

    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    btn.innerHTML = '<i class="bi bi-check-circle-fill me-2"></i>Done ✓';
    btn.style.color = '#22c55e';
    btn.style.borderColor = '#22c55e';
    btn.style.background = 'rgba(34,197,94,.1)';
  } catch (err) {
    console.error('Download failed:', err);
    btn.innerHTML = '<i class="bi bi-x-circle me-2"></i>Failed';
    btn.style.color = '#ef4444';
    btn.style.borderColor = '#ef4444';
  } finally {
    setTimeout(() => {
      btn.innerHTML = original;
      btn.disabled = false;
      btn.style.color = '';
      btn.style.borderColor = '';
      btn.style.background = '';
    }, 2500);
  }
}
