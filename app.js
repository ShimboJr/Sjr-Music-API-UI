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
const searchTitleEl  = document.getElementById('searchTitle');
const searchArtistEl = document.getElementById('searchArtist');
const searchAlbumEl  = document.getElementById('searchAlbum');
const searchBtn      = document.getElementById('searchBtn');
const clearBtn       = document.getElementById('clearBtn');
const retryBtn       = document.getElementById('retryBtn');

const loadingState   = document.getElementById('loadingState');
const errorState     = document.getElementById('errorState');
const emptyState     = document.getElementById('emptyState');
const resultsWrapper = document.getElementById('resultsWrapper');
const resultsGrid    = document.getElementById('resultsGrid');
const statusBar      = document.getElementById('statusBar');
const statusText     = document.getElementById('statusText');
const resultCount    = document.getElementById('resultCount');

/* ── Recently Released DOM refs ───────────────── */
const recentSection      = document.getElementById('recentSection');
const recentGrid         = document.getElementById('recentGrid');
const recentFilterInput  = document.getElementById('recentFilterInput');
const recentFilterClear  = document.getElementById('recentFilterClear');
const recentFilterWrap   = document.getElementById('recentFilterWrap');
const recentCountBar     = document.getElementById('recentCountBar');
const recentEmptyState   = document.getElementById('recentEmptyState');
const recentBody         = document.getElementById('recentBody');
const recentToggleBtn    = document.getElementById('recentToggleBtn');
const recentChevronIcon  = document.getElementById('recentChevronIcon');
const recentTeaser       = document.getElementById('recentTeaser');


/* ── State ─────────────────────────────────────── */
let allSongs    = [];
let recentSongs = []; /* last 20 entries from allSongs */

/* Active tag filters: fields not covered by the main search inputs */
let tagFilter = { category: '', genre: '', released: '' };

/**
 * Global registry of every live <audio> node across BOTH sections.
 * Using a Set so duplicate registrations are harmless.
 * Stale (removed-from-DOM) nodes are pruned before each new batch is added.
 */
const globalAudioRegistry = new Set();


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

  /* ── Recent section: toggle on header click / keyboard ── */
  recentToggleBtn.addEventListener('click', e => {
    /* Don't toggle when the user clicks inside the filter input or clear btn */
    if (e.target.closest('.recent-filter-wrap')) return;
    toggleRecentSection();
  });
  recentToggleBtn.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!e.target.closest('.recent-filter-wrap')) toggleRecentSection();
    }
  });

  /* ── Recent section: live filter ── */
  recentFilterInput.addEventListener('input', () => {
    const q = normalize(recentFilterInput.value);
    recentFilterClear.classList.toggle('d-none', q === '');
    buildRecentGrid(filterRecentSongs(q));
  });

  recentFilterClear.addEventListener('click', e => {
    e.stopPropagation(); /* prevent header toggle */
    recentFilterInput.value = '';
    recentFilterClear.classList.add('d-none');
    buildRecentGrid(recentSongs);
    recentFilterInput.focus();
  });

  /* Tag-chip delegation for the recent grid */
  recentGrid.addEventListener('click', e => {
    const btn = e.target.closest('.btn-download');
    if (btn && btn.dataset.url) {
      downloadSong(btn.dataset.url, btn.dataset.filename || 'song.mp3', btn);
      return;
    }
    const chip = e.target.closest('.tag-chip');
    if (chip) {
      filterByTag(chip.dataset.field, chip.dataset.value);
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

  /* Populate the Recently Released section */
  renderRecentSection();
}


/* ── Recently Released Section ─────────────────── */
/**
 * Grabs the last 20 songs from allSongs (newest last assumed),
 * stores them in recentSongs, then renders the grid.
 */
function renderRecentSection() {
  recentSongs = allSongs.slice(-20).reverse(); /* newest first */
  recentFilterInput.value = '';
  recentFilterClear.classList.add('d-none');
  buildRecentGrid(recentSongs);
  recentSection.classList.remove('d-none');
  expandRecentSection(false); /* show expanded, no animation on first load */
}

/* ── Collapse / Expand helpers ───────────────────── */

/**
 * Collapses the recent section body with a smooth slide-up animation.
 * Hides the filter input and shows the teaser summary pill.
 * @param {boolean} [animate=true]
 */
function collapseRecentSection(animate = true) {
  if (recentSection.classList.contains('recent-collapsed')) return; /* already collapsed */

  const body = recentBody;

  if (animate) {
    /* Lock current height so the transition has a start point */
    body.style.height = body.scrollHeight + 'px';
    /* Force reflow */
    body.offsetHeight; // eslint-disable-line no-unused-expressions
    body.style.height = '0';
  } else {
    body.style.height = '0';
  }

  recentSection.classList.add('recent-collapsed');
  recentToggleBtn.setAttribute('aria-expanded', 'false');
  recentChevronIcon.classList.replace('bi-chevron-up', 'bi-chevron-down');

  /* Show teaser, hide filter */
  recentFilterWrap.classList.add('d-none');
  recentTeaser.textContent = `${recentSongs.length} songs — click to expand`;
  recentTeaser.classList.remove('d-none');
}

/**
 * Expands the recent section body with a smooth slide-down animation.
 * Restores the filter input.
 * @param {boolean} [animate=true]
 */
function expandRecentSection(animate = true) {
  if (!recentSection.classList.contains('recent-collapsed') && animate) return; /* already open */

  const body = recentBody;

  recentSection.classList.remove('recent-collapsed');
  recentToggleBtn.setAttribute('aria-expanded', 'true');
  recentChevronIcon.classList.replace('bi-chevron-down', 'bi-chevron-up');

  /* Hide teaser, restore filter */
  recentTeaser.classList.add('d-none');
  recentFilterWrap.classList.remove('d-none');

  if (animate) {
    /* Measure natural height */
    body.style.height = body.scrollHeight + 'px';
    body.addEventListener('transitionend', function onEnd() {
      body.style.height = ''; /* let CSS auto-size after animation */
      body.removeEventListener('transitionend', onEnd);
    }, { once: true });
  } else {
    body.style.height = '';
  }
}

/** Toggles between collapsed and expanded. */
function toggleRecentSection() {
  if (recentSection.classList.contains('recent-collapsed')) {
    expandRecentSection();
  } else {
    collapseRecentSection();
  }
}

/**
 * Filters recentSongs by a query string across title, artist,
 * album, featuring, genre, and category fields.
 * @param {string} q  Already-normalized query
 * @returns {object[]} Matching song objects
 */
function filterRecentSongs(q) {
  if (!q) return recentSongs;
  return recentSongs.filter(song => {
    return (
      normalize(song.title).includes(q)      ||
      normalize(song.artist).includes(q)     ||
      normalize(song.album     || '').includes(q) ||
      normalize(song.featuring || '').includes(q) ||
      normalize(song.genre     || '').includes(q) ||
      normalize(song.category  || '').includes(q)
    );
  });
}

/**
 * Renders a list of songs into the recentGrid and updates the count bar.
 * Reuses the same card-building logic as renderResults().
 * @param {object[]} songs
 */
function buildRecentGrid(songs) {
  recentGrid.innerHTML = '';
  recentEmptyState.classList.add('d-none');

  if (songs.length === 0) {
    recentEmptyState.classList.remove('d-none');
    recentCountBar.innerHTML = '';
    return;
  }

  /* Count bar */
  const q = normalize(recentFilterInput.value);
  recentCountBar.innerHTML = q
    ? `<i class="bi bi-funnel-fill me-1"></i> <strong>${songs.length}</strong> of ${recentSongs.length} recent songs match <em>"${escHtml(q)}"</em>`
    : `<i class="bi bi-clock-history me-1"></i> Showing the <strong>${songs.length}</strong> most recently added songs`;

  const audioNodes = [];

  songs.forEach((song, idx) => {
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

    const featuringChips = (song.featuring || '')
      .split(/,|&|\bfeat\.?\b|\bft\.?\b/i)
      .map(n => n.trim())
      .filter(Boolean)
      .map(name =>
        `<button class="tag-chip tag-chip--artist" data-field="artist" data-value="${escAttr(name)}" title="Filter by ${escAttr(name)}">${escHtml(name)}</button>`
      ).join('');

    const chip = (field, value, extraCls = '') => {
      if (!value || !value.trim()) return escHtml(value);
      return `<button class="tag-chip ${extraCls}" data-field="${field}" data-value="${escAttr(value)}" title="Filter by ${escAttr(value)}">${escHtml(value)}</button>`;
    };

    const rows = [
      { label: 'Artist',    valueHtml: `<span class="detail-value detail-artist">${escHtml(song.artist)}</span>`,                                           raw: song.artist },
      { label: 'Featuring', valueHtml: featuringChips ? `<span class="detail-value tag-chips-wrap">${featuringChips}</span>` : '',                            raw: song.featuring || '' },
      { label: 'Category',  valueHtml: `<span class="detail-value detail-category">${chip('category', song.category || '', 'tag-chip--category')}</span>`,   raw: song.category || '' },
      { label: 'Genre',     valueHtml: `<span class="detail-value">${chip('genre',    song.genre    || '', 'tag-chip--genre')}</span>`,                      raw: song.genre    || '' },
      { label: 'Album',     valueHtml: `<span class="detail-value">${chip('album',    song.album    || '', 'tag-chip--album')}</span>`,                      raw: song.album    || '' },
      { label: 'Released',  valueHtml: `<span class="detail-value">${chip('released', song.released || '', 'tag-chip--released')}</span>`,                  raw: song.released || '' },
    ]
      .filter(r => r.raw.trim() !== '')
      .map(r => `
      <li class="detail-row">
        <span class="detail-label">${r.label}</span>
        ${r.valueHtml}
      </li>`)
      .join('');

    const hasAudio = isValidAudioUrl(song.songUrl);
    const audioHTML = hasAudio
      ? `<audio class="card-audio" controls preload="none" data-card-index="recent-${idx}">
           <source src="${escAttr(song.songUrl)}" type="audio/mpeg" />
         </audio>`
      : `<p class="no-preview"><i class="bi bi-slash-circle me-1"></i>Preview unavailable</p>`;

    const dlFilename = song.title + ' - ' + song.artist + '.mp3';
    const downloadHTML = hasAudio
      ? `<button
           class="btn-download"
           data-url="${escAttr(song.songUrl)}"
           data-filename="${escAttr(dlFilename)}">
           <i class="bi bi-download me-2"></i>Download ${escHtml(song.artist)} – ${escHtml(song.title)}
         </button>`
      : '';

    /* NEW badge on every recent card */
    const newBadge = `<span class="recent-new-badge"><i class="bi bi-lightning-charge-fill me-1"></i>NEW</span>`;

    const cardEl = document.createElement('div');
    cardEl.className = 'song-card';
    cardEl.style.animationDelay = `${Math.min(idx * 0.04, 0.5)}s`;
    cardEl.dataset.cardIndex = `recent-${idx}`;
    cardEl.innerHTML = `
      <div class="card-num" data-num="${idx + 1}">${idx + 1}</div>
      ${newBadge}
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
      </div>`;

    recentGrid.appendChild(cardEl);

    const audioEl = cardEl.querySelector('audio.card-audio');
    audioNodes.push(audioEl);
  });

  wireAudioAutoplay(audioNodes);
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

  /* Collapse the recently released section to give results more focus */
  collapseRecentSection();
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

  /* Re-expand the recently released section */
  expandRecentSection();
}

/* ── Render (card grid) ──────────────────────────── */
function renderResults(songs, query = {}) {
  if (songs.length === 0) {
    showState('empty');
    return;
  }

  /* Reset grid */
  resultsGrid.innerHTML = '';

  /* Collect audio elements as we build cards so we can wire autoplay */
  const audioNodes = [];

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
    const hasAudio = isValidAudioUrl(song.songUrl);
    const audioHTML = hasAudio
      ? `<audio class="card-audio" controls preload="none" data-card-index="${idx}">
           <source src="${escAttr(song.songUrl)}" type="audio/mpeg" />
         </audio>`
      : `<p class="no-preview"><i class="bi bi-slash-circle me-1"></i>Preview unavailable</p>`;

    /* ── Download button ── */
    const dlFilename = song.title + ' - ' + song.artist + '.mp3';
    const downloadHTML = hasAudio
      ? `<button
           class="btn-download"
           data-url="${escAttr(song.songUrl)}"
           data-filename="${escAttr(dlFilename)}">
           <i class="bi bi-download me-2"></i>Download ${escHtml(song.artist)} – ${escHtml(song.title)}
         </button>`
      : '';

    /* ── Build card as a real DOM element so we can grab the audio node ── */
    const cardEl = document.createElement('div');
    cardEl.className = 'song-card';
    cardEl.style.animationDelay = `${Math.min(idx * 0.05, 0.5)}s`;
    cardEl.dataset.cardIndex = idx;
    cardEl.innerHTML = `
      <div class="card-num" data-num="${idx + 1}">${idx + 1}</div>
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
      </div>`;

    resultsGrid.appendChild(cardEl);

    /* Grab the live <audio> node (null if song has no preview) */
    const audioEl = cardEl.querySelector('audio.card-audio');
    audioNodes.push(audioEl); /* keeps index alignment with songs[] */
  });

  /* ── Wire autoplay + single-playback enforcement ── */
  wireAudioAutoplay(audioNodes);

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

/* ── Autoplay wiring ──────────────────────────────── */
/**
 * Registers a batch of <audio> nodes from one section into the global
 * registry and attaches event listeners so that:
 *  • 'play'  — pauses EVERY other audio in BOTH sections (global registry),
 *              then highlights the active card in whichever grid it belongs to
 *  • 'pause' / 'ended' — removes the now-playing highlight from that card
 *  • 'ended' — advances to the next playable audio within the same section batch
 *
 * @param {(HTMLAudioElement|null)[]} audioNodes  Ordered array for one section
 *        (null entries for songs without a preview URL)
 */
function wireAudioAutoplay(audioNodes) {

  /* Prune any nodes that are no longer attached to the document */
  for (const node of globalAudioRegistry) {
    if (!document.contains(node)) globalAudioRegistry.delete(node);
  }

  /* Register each new node */
  audioNodes.forEach(a => { if (a) globalAudioRegistry.add(a); });

  /* Resolves the grid container that owns a given card index string */
  function ownerGrid(cardIndex) {
    /* Recent cards use "recent-N" indices; search results use plain numbers */
    return String(cardIndex).startsWith('recent-') ? recentGrid : resultsGrid;
  }

  function setNowPlaying(cardIndex) {
    /* Clear highlight on EVERY card across both grids */
    [resultsGrid, recentGrid].forEach(grid => {
      grid.querySelectorAll('.song-card').forEach(card => {
        card.classList.remove('now-playing');
        const badge = card.querySelector('.card-num');
        if (badge) badge.innerHTML = badge.dataset.num; /* restore track number */
      });
    });

    if (cardIndex === null) return;

    /* Highlight the active card inside its own grid */
    const grid = ownerGrid(cardIndex);
    const card = grid.querySelector(`.song-card[data-card-index="${cardIndex}"]`);
    if (!card) return;
    card.classList.add('now-playing');
    const badge = card.querySelector('.card-num');
    if (badge) badge.innerHTML = `
      <span class="now-playing-badge">
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
        <span class="eq-bar"></span>
      </span>`;
  }

  audioNodes.forEach((audio, idx) => {
    if (!audio) return; /* no preview for this song */

    const cardIndex = audio.dataset.cardIndex;

    /* ── GLOBAL single-playback: pause every audio across both sections ── */
    audio.addEventListener('play', () => {
      for (const other of globalAudioRegistry) {
        if (other !== audio && !other.paused) other.pause();
      }
      setNowPlaying(cardIndex);
    });

    /* Remove highlight when paused manually */
    audio.addEventListener('pause', () => {
      /* Small delay so 'ended' (which fires pause first) can override */
      setTimeout(() => {
        if (audio.ended || audio.paused) setNowPlaying(null);
      }, 50);
    });

    /* Auto-advance within the same section batch */
    audio.addEventListener('ended', () => {
      for (let next = idx + 1; next < audioNodes.length; next++) {
        const nextAudio = audioNodes[next];
        if (!nextAudio) continue;

        /* Scroll the next card into view — use the correct owner grid */
        const nextCardIndex = nextAudio.dataset.cardIndex;
        const nextGrid = ownerGrid(nextCardIndex);
        const nextCard = nextGrid.querySelector(`.song-card[data-card-index="${nextCardIndex}"]`);
        if (nextCard) nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' });

        /* Load and play */
        nextAudio.load();
        nextAudio.play().catch(err => console.warn('Autoplay blocked by browser:', err));
        return;
      }

      /* No next song — clear highlight */
      setNowPlaying(null);
    });
  });
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
