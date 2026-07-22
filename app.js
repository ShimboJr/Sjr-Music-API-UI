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

/* Active tag filters: fields not covered by the main search inputs */
let tagFilter = { category: '', genre: '', released: '' };

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

  /* Download + tag-chip – event delegation on the grid container */
  resultsGrid.addEventListener('click', e => {
    /* Download */
    const btn = e.target.closest('.btn-download');
    if (btn && btn.dataset.url) {
      downloadSong(btn.dataset.url, btn.dataset.filename || 'song.mp3', btn);
      return;
    }

    /* Clickable tag chip */
    const chip = e.target.closest('.tag-chip');
    if (chip) {
      filterByTag(chip.dataset.field, chip.dataset.value);
    }
  });

  /* Dismiss active tag from the tag bar */
  document.getElementById('activeTagBar').addEventListener('click', e => {
    const dismiss = e.target.closest('.active-tag-dismiss');
    if (dismiss) clearTagFilter(dismiss.dataset.field);
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
  const qTitle  = normalize(searchTitleEl.value);
  const qArtist = normalize(searchArtistEl.value);
  const qAlbum  = normalize(searchAlbumEl.value);
  const { category: qCategory, genre: qGenre, released: qReleased } = tagFilter;

  const hasInput = qTitle || qArtist || qAlbum || qCategory || qGenre || qReleased;
  if (!hasInput) {
    setStatus('Please enter at least one search term to get results.');
    showState('idle');
    return;
  }

  const filtered = allSongs.filter(song => {
    const titleMatch    = !qTitle    || normalize(song.title).includes(qTitle);
    const artistMatch   = !qArtist   || normalize(song.artist).includes(qArtist)
                                     || normalize(song.featuring || '').includes(qArtist);
    const albumMatch    = !qAlbum    || normalize(song.album    || '').includes(qAlbum);
    const categoryMatch = !qCategory || normalize(song.category || '') === qCategory;
    const genreMatch    = !qGenre    || normalize(song.genre    || '') === qGenre;
    const releasedMatch = !qReleased || normalize(song.released || '') === qReleased;
    return titleMatch && artistMatch && albumMatch && categoryMatch && genreMatch && releasedMatch;
  });

  /* Sort alphabetically by title */
  filtered.sort((a, b) => a.title.localeCompare(b.title));

  renderResults(filtered, { qTitle, qArtist, qAlbum, qCategory, qGenre, qReleased });

  /* Clear inputs after search so the fields are ready for a new query */
  searchTitleEl.value  = '';
  searchArtistEl.value = '';
  searchAlbumEl.value  = '';
}

/* ── Tag-chip filter ────────────────────────────── */
/**
 * Called when a clickable chip inside a song card is clicked.
 * @param {'artist'|'category'|'genre'|'album'|'released'} field
 * @param {string} value  Raw (unescaped) value from data-value
 */
function filterByTag(field, value) {
  /* Scroll the search bar into view for feedback */
  document.getElementById('search-section').scrollIntoView({ behavior: 'smooth', block: 'center' });

  if (field === 'artist') {
    /* Featuring artist → populate the Artist search input */
    searchArtistEl.value = value;
  } else if (field === 'album') {
    /* Album → populate the Album search input */
    searchAlbumEl.value = value;
  } else if (field === 'category' || field === 'genre' || field === 'released') {
    /* Tag-only fields → store in tagFilter state */
    tagFilter[field] = normalize(value);
    renderTagBar();
  }

  runSearch();
}

/* Clear a single tag filter field */
function clearTagFilter(field) {
  if (field in tagFilter) {
    tagFilter[field] = '';
    renderTagBar();
    /* Re-run search (or reset if nothing is left to filter on) */
    const qTitle  = normalize(searchTitleEl.value);
    const qArtist = normalize(searchArtistEl.value);
    const qAlbum  = normalize(searchAlbumEl.value);
    const anyLeft = qTitle || qArtist || qAlbum ||
                    tagFilter.category || tagFilter.genre || tagFilter.released;
    if (anyLeft) {
      runSearch();
    } else {
      showState('idle');
      setStatus(`Catalogue loaded — ${allSongs.length} songs available. Use the search above to find your music.`);
    }
  }
}

/* Render active tag pills above the results grid */
function renderTagBar() {
  const bar = document.getElementById('activeTagBar');
  const labels = { category: 'Category', genre: 'Genre', released: 'Released' };

  const chips = Object.entries(tagFilter)
    .filter(([, v]) => v !== '')
    .map(([field, val]) => `
      <span class="active-tag">
        <i class="bi bi-funnel-fill me-1" style="font-size:.7rem"></i>
        ${labels[field]}: <strong>${escHtml(val)}</strong>
        <button class="active-tag-dismiss" data-field="${field}" title="Remove filter" aria-label="Remove ${labels[field]} filter">
          <i class="bi bi-x"></i>
        </button>
      </span>`)
    .join('');

  bar.innerHTML = chips;
  bar.classList.toggle('d-none', chips === '');
}

/* ── Clear ─────────────────────────────────────── */
function clearSearch() {
  searchTitleEl.value  = '';
  searchArtistEl.value = '';
  searchAlbumEl.value  = '';
  tagFilter = { category: '', genre: '', released: '' };
  renderTagBar();
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

    /* Featuring: split on common delimiters and render individual clickable chips */
    const featuringChips = (song.featuring || '')
      .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
      .map(n => n.trim())
      .filter(Boolean)
      .map(name =>
        `<button class="tag-chip tag-chip--artist" data-field="artist" data-value="${escAttr(name)}" title="Filter by ${escAttr(name)}">${escHtml(name)}</button>`
      ).join('');

    /* Simple single-value chip builder for category / genre / album / released */
    const chip = (field, value, extraCls = '') => {
      if (!value || !value.trim()) return escHtml(value);
      return `<button class="tag-chip ${extraCls}" data-field="${field}" data-value="${escAttr(value)}" title="Filter by ${escAttr(value)}">${escHtml(value)}</button>`;
    };

    const rows = [
      { label: 'Artist',   valueHtml: `<span class="detail-value detail-artist">${escHtml(song.artist)}</span>`,                         raw: song.artist },
      { label: 'Featuring',valueHtml: featuringChips ? `<span class="detail-value tag-chips-wrap">${featuringChips}</span>` : '',        raw: song.featuring || '' },
      { label: 'Category', valueHtml: `<span class="detail-value detail-category">${chip('category', song.category || '', 'tag-chip--category')}</span>`, raw: song.category || '' },
      { label: 'Genre',    valueHtml: `<span class="detail-value">${chip('genre',    song.genre    || '', 'tag-chip--genre')}</span>`,    raw: song.genre    || '' },
      { label: 'Album',    valueHtml: `<span class="detail-value">${chip('album',    song.album    || '', 'tag-chip--album')}</span>`,    raw: song.album    || '' },
      { label: 'Released', valueHtml: `<span class="detail-value">${chip('released', song.released || '', 'tag-chip--released')}</span>`,raw: song.released || '' },
    ]
      .filter(r => r.raw.trim() !== '')
      .map(r => `
      <li class="detail-row">
        <span class="detail-label">${r.label}</span>
        ${r.valueHtml}
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
  if (query.qTitle)    labelParts.push(`title "${query.qTitle}"`);
  if (query.qArtist)   labelParts.push(`artist "${query.qArtist}"`);
  if (query.qAlbum)    labelParts.push(`album "${query.qAlbum}"`);
  if (query.qCategory) labelParts.push(`category "${query.qCategory}"`);
  if (query.qGenre)    labelParts.push(`genre "${query.qGenre}"`);
  if (query.qReleased) labelParts.push(`released "${query.qReleased}"`);

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
