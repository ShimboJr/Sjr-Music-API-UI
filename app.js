/* =====================================================
   SJr Music – app.js
   Fetches data from the SJr Music API and handles
   search / filter / card-display logic.
   ===================================================== */

const API_URL = 'https://sjr-music-api-gold.vercel.app/music';

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

/* ── Recently Released DOM refs ───────────────── */
const recentSection = document.getElementById('recentSection');
const recentGrid = document.getElementById('recentGrid');
const recentFilterInput = document.getElementById('recentFilterInput');
const recentFilterClear = document.getElementById('recentFilterClear');
const recentFilterWrap = document.getElementById('recentFilterWrap');
const recentCountBar = document.getElementById('recentCountBar');
const recentEmptyState = document.getElementById('recentEmptyState');
const recentBody = document.getElementById('recentBody');
const recentToggleBtn = document.getElementById('recentToggleBtn');
const recentChevronIcon = document.getElementById('recentChevronIcon');
const recentTeaser = document.getElementById('recentTeaser');


/* ── State ─────────────────────────────────────── */
let allSongs = [];
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
      normalize(song.title).includes(q) ||
      normalize(song.artist).includes(q) ||
      normalize(song.album || '').includes(q) ||
      normalize(song.featuring || '').includes(q) ||
      normalize(song.genre || '').includes(q) ||
      normalize(song.category || '').includes(q)
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
      { label: 'Artist', valueHtml: `<span class="detail-value detail-artist">${escHtml(song.artist)}</span>`, raw: song.artist },
      { label: 'Featuring', valueHtml: featuringChips ? `<span class="detail-value tag-chips-wrap">${featuringChips}</span>` : '', raw: song.featuring || '' },
      { label: 'Category', valueHtml: `<span class="detail-value detail-category">${chip('category', song.category || '', 'tag-chip--category')}</span>`, raw: song.category || '' },
      { label: 'Genre', valueHtml: `<span class="detail-value">${chip('genre', song.genre || '', 'tag-chip--genre')}</span>`, raw: song.genre || '' },
      { label: 'Album', valueHtml: `<span class="detail-value">${chip('album', song.album || '', 'tag-chip--album')}</span>`, raw: song.album || '' },
      { label: 'Released', valueHtml: `<span class="detail-value">${chip('released', song.released || '', 'tag-chip--released')}</span>`, raw: song.released || '' },
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

    const dlFilename = song.title + ' - ' + song.artist + (song.featuring && song.featuring.trim() ? ' ft. ' + song.featuring : '') + '.mp3';
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
  const qTitle = normalize(searchTitleEl.value);
  const qArtist = normalize(searchArtistEl.value);
  const qAlbum = normalize(searchAlbumEl.value);
  const { category: qCategory, genre: qGenre, released: qReleased } = tagFilter;

  const hasInput = qTitle || qArtist || qAlbum || qCategory || qGenre || qReleased;
  if (!hasInput) {
    setStatus('Please enter at least one search term to get results.');
    showState('idle');
    return;
  }

  const filtered = allSongs.filter(song => {
    const titleMatch = !qTitle || normalize(song.title).includes(qTitle);
    const artistMatch = !qArtist || normalize(song.artist).includes(qArtist)
      || normalize(song.featuring || '').includes(qArtist);
    const albumMatch = !qAlbum || normalize(song.album || '').includes(qAlbum);
    const categoryMatch = !qCategory || normalize(song.category || '') === qCategory;
    const genreMatch = !qGenre || normalize(song.genre || '') === qGenre;
    const releasedMatch = !qReleased || normalize(song.released || '') === qReleased;
    return titleMatch && artistMatch && albumMatch && categoryMatch && genreMatch && releasedMatch;
  });

  /* Sort alphabetically by title */
  filtered.sort((a, b) => a.title.localeCompare(b.title));

  renderResults(filtered, { qTitle, qArtist, qAlbum, qCategory, qGenre, qReleased });

  /* Clear inputs after search so the fields are ready for a new query */
  searchTitleEl.value = '';
  searchArtistEl.value = '';
  searchAlbumEl.value = '';

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
    const qTitle = normalize(searchTitleEl.value);
    const qArtist = normalize(searchArtistEl.value);
    const qAlbum = normalize(searchAlbumEl.value);
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
  searchTitleEl.value = '';
  searchArtistEl.value = '';
  searchAlbumEl.value = '';
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
      { label: 'Artist', valueHtml: `<span class="detail-value detail-artist">${escHtml(song.artist)}</span>`, raw: song.artist },
      { label: 'Featuring', valueHtml: featuringChips ? `<span class="detail-value tag-chips-wrap">${featuringChips}</span>` : '', raw: song.featuring || '' },
      { label: 'Category', valueHtml: `<span class="detail-value detail-category">${chip('category', song.category || '', 'tag-chip--category')}</span>`, raw: song.category || '' },
      { label: 'Genre', valueHtml: `<span class="detail-value">${chip('genre', song.genre || '', 'tag-chip--genre')}</span>`, raw: song.genre || '' },
      { label: 'Album', valueHtml: `<span class="detail-value">${chip('album', song.album || '', 'tag-chip--album')}</span>`, raw: song.album || '' },
      { label: 'Released', valueHtml: `<span class="detail-value">${chip('released', song.released || '', 'tag-chip--released')}</span>`, raw: song.released || '' },
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
    const dlFilename = song.title + ' - ' + song.artist + (song.featuring && song.featuring.trim() ? ' ft. ' + song.featuring : '') + '.mp3';
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
  if (query.qTitle) labelParts.push(`title "${query.qTitle}"`);
  if (query.qArtist) labelParts.push(`artist "${query.qArtist}"`);
  if (query.qAlbum) labelParts.push(`album "${query.qAlbum}"`);
  if (query.qCategory) labelParts.push(`category "${query.qCategory}"`);
  if (query.qGenre) labelParts.push(`genre "${query.qGenre}"`);
  if (query.qReleased) labelParts.push(`released "${query.qReleased}"`);

  setStatus(
    `Showing results for ${labelParts.join(', ')} — sorted A–Z`,
    songs.length
  );
}

/* ── Autoplay wiring ──────────────────────────────── */

/**
 * How many seconds before the end of the current track the crossfade window opens.
 * Matches Spotify's default crossfade behaviour.
 */
const CROSSFADE_DURATION = 5; /* seconds */

/**
 * Module-level sentinel that tracks an in-progress crossfade so the global
 * single-playback enforcer knows NOT to pause the fading-out track when the
 * incoming track fires its 'play' event.
 *
 *  { from: HTMLAudioElement, to: HTMLAudioElement }  — crossfade in progress
 *  null                                              — no crossfade active
 */
let activeCrossfadePair = null;

/**
 * Registers a batch of <audio> nodes from one section into the global
 * registry and wires three behaviours:
 *
 *  1. Global single-playback  — 'play' pauses every other track, EXCEPT the
 *     fading-out half of an active crossfade (activeCrossfadePair.from).
 *
 *  2. Deferred next-track preload — after the current track fires 'canplaythrough'
 *     (the browser confirms it has enough data to play through without stalling)
 *     the next track's <audio> is switched to preload="auto" and buffered silently.
 *     This prevents starving the current track's own buffer.
 *
 *  3. Spotify-style crossfade — a 'timeupdate' watcher triggers once with
 *     ≤ CROSSFADE_DURATION seconds remaining.  The current track KEEPS PLAYING
 *     and fades to silence while the next track (already buffered) starts at
 *     volume 0 and fades up to full — both ramps running in parallel via
 *     requestAnimationFrame with an ease-in-out curve.
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

  /* ── Shared helpers ──────────────────────────────── */

  function ownerGrid(cardIndex) {
    return String(cardIndex).startsWith('recent-') ? recentGrid : resultsGrid;
  }

  function setNowPlaying(cardIndex) {
    [resultsGrid, recentGrid].forEach(grid => {
      grid.querySelectorAll('.song-card').forEach(card => {
        card.classList.remove('now-playing');
        const badge = card.querySelector('.card-num');
        if (badge) badge.innerHTML = badge.dataset.num;
      });
    });

    if (cardIndex === null) return;

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

  /**
   * Animate volume from `from` → `to` over `durationMs` milliseconds using an
   * ease-in-out curve identical to Spotify's crossfade envelope.
   * The audio element continues playing — only its volume changes.
   */
  function rampVolume(audioEl, from, to, durationMs) {
    if (!audioEl) return;
    if (durationMs <= 0) { audioEl.volume = Math.max(0, Math.min(1, to)); return; }

    const startTime = performance.now();
    audioEl.volume = Math.max(0, Math.min(1, from));

    function step(now) {
      const progress = Math.min((now - startTime) / durationMs, 1);
      /* Cubic ease-in-out — gentle start, gentle finish */
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      audioEl.volume = Math.max(0, Math.min(1, from + (to - from) * eased));
      if (progress < 1) requestAnimationFrame(step);
      else audioEl.volume = Math.max(0, Math.min(1, to));
    }
    requestAnimationFrame(step);
  }

  function scrollToCard(audio) {
    if (!audio) return;
    const ci = audio.dataset.cardIndex;
    const card = ownerGrid(ci).querySelector(`.song-card[data-card-index="${ci}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ── Per-node wiring ─────────────────────────────── */

  audioNodes.forEach((audio, idx) => {
    if (!audio) return;

    const cardIndex = audio.dataset.cardIndex;
    let crossfadeTriggered = false;  /* guards against double-firing */
    let preloadScheduled = false;    /* guards against scheduling preload twice */

    /* ────────────────────────────────────────────────
       'play' event
       • Enforces global single-playback (pauses all others).
         Exception: if a crossfade is active and the other track is the
         fading-out half (activeCrossfadePair.from), it must NOT be paused —
         it still needs to play out its final seconds while fading to silence.
       • Resets per-play state.
       • Schedules deferred preload of the next track.
    ──────────────────────────────────────────────── */
    audio.addEventListener('play', () => {
      for (const other of globalAudioRegistry) {
        if (other === audio) continue;
        if (other.paused) continue;

        /* Keep fading-out track alive during a crossfade */
        if (activeCrossfadePair &&
          activeCrossfadePair.from === other &&
          activeCrossfadePair.to === audio) continue;

        other.pause();
      }

      setNowPlaying(cardIndex);

      /* Fresh-play resets */
      crossfadeTriggered = false;
      preloadScheduled = false;
      audio.volume = 1;

      /* ── Deferred preload: wait until this track has enough data ──
         'canplaythrough' fires when the browser estimates it can play
         to the end of the file without stopping to buffer.  Only then
         do we start buffering the next track, so we don't fight for
         bandwidth with the currently streaming audio.                 */
      scheduleNextPreload(audio, idx, audioNodes, () => {
        preloadScheduled = true;
      });
    });

    /* ────────────────────────────────────────────────
       'pause' event
       Clear the now-playing indicator, but NOT if this audio is the
       fading-out half of an active crossfade — it gets paused naturally
       by the browser when it reaches the end of the file.
    ──────────────────────────────────────────────── */
    audio.addEventListener('pause', () => {
      /* Capture the pair reference immediately — it may be cleared by 'ended'
         before the setTimeout callback runs. */
      const pairAtPause = activeCrossfadePair;
      setTimeout(() => {
        /* Don't steal the highlight from the incoming track mid-crossfade */
        if (pairAtPause && pairAtPause.from === audio) return;

        /* Don't clear if another track is already playing (e.g. next song
           started playing before this pause event resolved) */
        for (const other of globalAudioRegistry) {
          if (other !== audio && !other.paused) return;
        }

        if (audio.ended || audio.paused) setNowPlaying(null);
      }, 50);
    });

    /* ────────────────────────────────────────────────
       'timeupdate' event — Spotify-style crossfade
       Fires many times per second; we only act once per play-through.

       When ≤ CROSSFADE_DURATION seconds remain:
         • Mark activeCrossfadePair so the 'play' enforcer on the next
           track won't kill this track.
         • Start the next track at volume 0.
         • Ramp this track 1→0 and next track 0→1 simultaneously.
         • This track KEEPS PLAYING — it fades to silence and the browser
           fires 'ended' naturally when it reaches the end of the file.
    ──────────────────────────────────────────────── */
    audio.addEventListener('timeupdate', () => {
      if (crossfadeTriggered) return;
      if (!audio.duration || !isFinite(audio.duration)) return;

      const remaining = audio.duration - audio.currentTime;
      if (remaining > CROSSFADE_DURATION) return;

      /* Find next playable track */
      let nextAudio = null;
      for (let n = idx + 1; n < audioNodes.length; n++) {
        if (audioNodes[n]) { nextAudio = audioNodes[n]; break; }
      }
      if (!nextAudio) return; /* last track — let it finish naturally */

      crossfadeTriggered = true;

      const fadeDurationMs = remaining * 1000;

      /* Register the pair BEFORE calling nextAudio.play() */
      activeCrossfadePair = { from: audio, to: nextAudio };

      scrollToCard(nextAudio);

      /* Start next track silently — it's already buffered */
      nextAudio.volume = 0;
      nextAudio.currentTime = 0;
      nextAudio.play().catch(err => console.warn('[Crossfade] Autoplay blocked:', err));

      /* Parallel volume ramps — current fades out, next fades in */
      rampVolume(audio, 1, 0, fadeDurationMs);
      rampVolume(nextAudio, 0, 1, fadeDurationMs);

      console.info(`[Crossfade] Overlapping ${remaining.toFixed(1)}s window started.`);
    });

    /* ────────────────────────────────────────────────
       'ended' event
       • Clears activeCrossfadePair when the fading-out track finishes.
       • Fallback auto-advance if crossfade never fired (short clip / seek
         to end / browser didn't know duration until it was too late).
    ──────────────────────────────────────────────── */
    audio.addEventListener('ended', () => {
      /* Release the crossfade lock so normal enforcement resumes */
      if (activeCrossfadePair && activeCrossfadePair.from === audio) {
        activeCrossfadePair = null;
      }

      if (crossfadeTriggered) return; /* crossfade handled the transition */

      /* Fallback: advance normally */
      for (let n = idx + 1; n < audioNodes.length; n++) {
        const next = audioNodes[n];
        if (!next) continue;

        scrollToCard(next);
        setNowPlaying(next.dataset.cardIndex); /* set highlight BEFORE play fires */
        next.volume = 1;
        next.load();
        next.play().catch(err => console.warn('[Fallback] Autoplay blocked:', err));
        return;
      }

      setNowPlaying(null);
    });
  });
}

/* ── Deferred next-track preload helper ─────────────── */
/**
 * Waits until `currentAudio` fires 'canplaythrough' — the browser's signal
 * that it has buffered enough of the current track to play without stalling —
 * then silently pre-buffers the next track by switching it to preload="auto".
 *
 * This prevents the preload from competing for bandwidth with the track that
 * is actively streaming and buffering.
 *
 * @param {HTMLAudioElement}         currentAudio  The track currently playing
 * @param {number}                   idx           Its index in audioNodes
 * @param {(HTMLAudioElement|null)[]} audioNodes   The full section batch
 * @param {() => void}               onScheduled  Callback when preload starts
 */
function scheduleNextPreload(currentAudio, idx, audioNodes, onScheduled) {
  /* Find the next audio node */
  let nextAudio = null;
  for (let n = idx + 1; n < audioNodes.length; n++) {
    if (audioNodes[n]) { nextAudio = audioNodes[n]; break; }
  }
  if (!nextAudio) return; /* nothing to preload */
  if (nextAudio.preload === 'auto') return; /* already scheduled */

  function startPreload() {
    if (nextAudio.preload === 'auto') return; /* guard against double-call */
    nextAudio.preload = 'auto';
    nextAudio.load();
    onScheduled?.();
    console.info(
      '[Preload] Buffering next track (deferred after canplaythrough):',
      nextAudio.querySelector('source')?.src || '—'
    );
  }

  /* If already fully buffered or past the readiness threshold, go immediately */
  if (currentAudio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
    startPreload();
    return;
  }

  /* Otherwise wait for the 'canplaythrough' event */
  currentAudio.addEventListener('canplaythrough', startPreload, { once: true });
}

/* ── UI state manager ───────────────────────────── */
function showState(state) {
  loadingState.classList.add('d-none');
  errorState.classList.add('d-none');
  emptyState.classList.add('d-none');
  resultsWrapper.classList.add('d-none');

  if (state === 'loading') loadingState.classList.remove('d-none');
  if (state === 'error')   errorState.classList.remove('d-none');
  if (state === 'empty')   emptyState.classList.remove('d-none');
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

/* ── Download ─────────────────────────────────────── */


/**
 * Streams the audio file chunk-by-chunk via the Fetch API, updating the
 * button with live download progress.  Once all bytes are received a blob
 * URL is created and an invisible anchor click triggers the browser's native
 * Save-As dialog — the correct cross-origin-safe approach, because Chrome 65+
 * ignores the `download` attribute on cross-origin <a> tags.
 *
 * Progress display:
 *   • When the server sends Content-Length → shows "34%" style progress.
 *   • When Content-Length is absent       → shows "1.2 MB" received so far.
 *
 * @param {string}      url       Remote audio URL
 * @param {string}      filename  Desired local filename
 * @param {HTMLElement} btn       Download button (its label is updated live)
 */

async function downloadSong(url, filename, btn) {
  const original = btn.innerHTML;
  btn.disabled  = true;
  btn.innerHTML = '<i class="bi bi-arrow-down-circle me-2"></i>0%';

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    /* Read total size from the response headers (may not always be present) */
    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    const reader   = response.body.getReader();
    const chunks   = [];
    let   received = 0;

    /* Stream body and update button label in real time */
    while (true) { // eslint-disable-line no-constant-condition
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      received += value.length;

      if (total > 0) {
        const pct = Math.min(Math.round((received / total) * 100), 99);
        btn.innerHTML = `<i class="bi bi-arrow-down-circle me-2"></i>${pct}%`;
      } else {
        const mb = (received / (1024 * 1024)).toFixed(1);
        btn.innerHTML = `<i class="bi bi-arrow-down-circle me-2"></i>${mb} MB`;
      }
    }

    /* All bytes received — assemble into a blob and trigger Save-As */
    const blob    = new Blob(chunks, { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);

    const anchor = document.createElement('a');
    anchor.href          = blobUrl;
    anchor.download      = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    /* Release the object URL after the browser has had time to use it */
    setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);

    btn.innerHTML         = '<i class="bi bi-check-circle-fill me-2"></i>Done ✓';
    btn.style.color       = '#22c55e';
    btn.style.borderColor = '#22c55e';
    btn.style.background  = 'rgba(34,197,94,.1)';

  } catch (err) {
    console.error('Download failed:', err);
    btn.innerHTML         = '<i class="bi bi-x-circle me-2"></i>Failed';
    btn.style.color       = '#ef4444';
    btn.style.borderColor = '#ef4444';

  } finally {
    setTimeout(() => {
      btn.innerHTML         = original;
      btn.disabled          = false;
      btn.style.color       = '';
      btn.style.borderColor = '';
      btn.style.background  = '';
    }, 2500);
  }
}


/* =====================================================
   FAVOURITES MODULE
   Self-contained; reads/writes localStorage.
   Injects heart buttons after every card-build cycle.
   ===================================================== */

(function initFavourites() {

  const LS_KEY = 'sjrmusic_favourites';

  /* ── LocalStorage helpers ────────────────────── */

  /** Returns the saved favourites array (array of song objects). */
  function loadFavs() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY)) || [];
    } catch {
      return [];
    }
  }

  /** Persists the favourites array. */
  function saveFavs(favs) {
    localStorage.setItem(LS_KEY, JSON.stringify(favs));
  }

  /**
   * Derives a stable string key for a song.
   * Uses title + artist (lowercased, trimmed) — robust enough for this dataset.
   */
  function songKey(song) {
    return `${(song.title || '').trim().toLowerCase()}|${(song.artist || '').trim().toLowerCase()}`;
  }

  /** Returns true if the song is currently favourited. */
  function isFav(song) {
    return loadFavs().some(f => songKey(f) === songKey(song));
  }

  /** Adds or removes a song from favourites; returns the new state (true = added). */
  function toggleFav(song) {
    const favs = loadFavs();
    const key  = songKey(song);
    const idx  = favs.findIndex(f => songKey(f) === key);
    if (idx === -1) {
      favs.push(song);
      saveFavs(favs);
      return true;  /* added */
    } else {
      favs.splice(idx, 1);
      saveFavs(favs);
      return false; /* removed */
    }
  }

  /* ── Count badge on the header button ───────── */

  const favCountEl = document.getElementById('favCount');

  function refreshCountBadge() {
    const count = loadFavs().length;
    if (count > 0) {
      favCountEl.textContent = count > 99 ? '99+' : count;
      favCountEl.classList.remove('d-none');
    } else {
      favCountEl.classList.add('d-none');
    }
  }

  /* ── Heart button injection ──────────────────── */

  /**
   * Injects a heart toggle button into a song card element.
   * Called after each card is appended to a grid.
   * @param {HTMLElement} cardEl  The .song-card element
   * @param {object}      song    The raw song data object
   */
  function injectHeart(cardEl, song) {
    /* Don't double-inject */
    if (cardEl.querySelector('.btn-fav-heart')) return;

    const btn = document.createElement('button');
    btn.className  = 'btn-fav-heart';
    btn.title      = 'Add to favourites';
    btn.setAttribute('aria-label', 'Toggle favourite');
    btn.innerHTML  = '<i class="bi bi-heart-fill"></i>';

    /* Reflect current saved state */
    if (isFav(song)) {
      btn.classList.add('is-fav');
      btn.title = 'Remove from favourites';
    }

    btn.addEventListener('click', e => {
      e.stopPropagation(); /* don't bubble to card or grids */

      const added = toggleFav(song);

      if (added) {
        btn.classList.add('is-fav', 'heart-pop');
        btn.title = 'Remove from favourites';
        btn.addEventListener('animationend', () => btn.classList.remove('heart-pop'), { once: true });
      } else {
        btn.classList.remove('is-fav');
        btn.title = 'Add to favourites';
      }

      /* Keep every copy of this song's heart in sync across both grids */
      syncAllHearts(song, added);

      /* Notify the favourites view and badge to refresh */
      document.dispatchEvent(new CustomEvent('favchange'));
    });

    cardEl.appendChild(btn);
  }

  /**
   * After toggling, sync the heart state on any duplicate cards for the same
   * song that may appear in the other grid (e.g., a recent card + a search card).
   */
  function syncAllHearts(song, isFavNow) {
    [resultsGrid, recentGrid].forEach(grid => {
      grid.querySelectorAll('.btn-fav-heart').forEach(btn => {
        const card = btn.closest('.song-card');
        if (!card) return;
        if (card.dataset.favKey === songKey(song)) {
          btn.classList.toggle('is-fav', isFavNow);
          btn.title = isFavNow ? 'Remove from favourites' : 'Add to favourites';
        }
      });
    });
  }

  /* ── Observe grid mutations to inject hearts ── */
  /*
   * We use a MutationObserver on each results grid so that whenever new
   * .song-card elements are added (by renderResults or buildRecentGrid),
   * we automatically inject the heart button.  This avoids ANY modification
   * of the existing card-building functions.
   */

  function observeGrid(grid, getSong) {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mut => {
        mut.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return;
          const cards = node.classList.contains('song-card')
            ? [node]
            : [...node.querySelectorAll('.song-card')];
          cards.forEach(card => {
            const song = getSong(card);
            if (!song) return;
            /* Store the key on the card so syncAllHearts can match later */
            card.dataset.favKey = songKey(song);
            injectHeart(card, song);
          });
        });
      });
    });
    observer.observe(grid, { childList: true });
    return observer;
  }

  /*
   * To get the song object for a card we match via the card heading text
   * against the allSongs / recentSongs arrays.  This is reliable because
   * the heading is rendered as "Artist – Title" and both values come from the
   * same raw data.
   */
  function findSongForCard(card, pool) {
    /* Use data-fav-key if already set (happens on re-render) */
    if (card.dataset.favKey) {
      return pool.find(s => songKey(s) === card.dataset.favKey) || null;
    }
    const heading = card.querySelector('.card-heading');
    if (!heading) return null;
    /* Strip icons from the heading text */
    const text = heading.textContent.trim();
    return pool.find(s => {
      const expected = `${s.artist} – ${s.title}`;
      return text.includes(expected);
    }) || null;
  }

  observeGrid(resultsGrid, card => findSongForCard(card, allSongs));
  observeGrid(recentGrid,  card => findSongForCard(card, recentSongs));

  /* ── Inline favourites view (renders into the main resultsGrid) ── */

  const favouritesBtn = document.getElementById('favouritesBtn');

  /** True while the results area is displaying the favourites view. */
  let isFavView = false;

  /**
   * Renders all favourited songs into the main resultsGrid, reusing the
   * existing resultsWrapper / showState / setStatus infrastructure.
   */
  function showFavouritesInline() {
    isFavView = true;
    const favs = loadFavs();

    /* Collapse the Recently Released section for focus, same as a search */
    collapseRecentSection();

    if (favs.length === 0) {
      showState('empty');
      /* Swap the empty-state copy to be favourites-specific */
      document.querySelector('#emptyState h4').textContent    = 'No favourites yet';
      document.querySelector('#emptyState .text-muted').textContent =
        'Tap the \u2665 icon on any song card to save it here.';
      document.querySelector('#emptyState .empty-icon').className =
        'bi bi-heart empty-icon';
      /* Status bar with proper heart icon via innerHTML */
      setStatus('\u2665 Your Favourites');
      statusText.innerHTML = '<i class="bi bi-heart-fill me-1" style="color:#ef4444;font-size:.9em"></i> Your Favourites';
      emptyState.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    /* Reset grid */
    resultsGrid.innerHTML = '';

    const audioNodes = [];

    favs.forEach((song, idx) => {

      /* ── Art ── */
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

      /* ── Featuring chips ── */
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
        { label: 'Artist',    valueHtml: `<span class="detail-value detail-artist">${escHtml(song.artist)}</span>`, raw: song.artist },
        { label: 'Featuring', valueHtml: featuringChips ? `<span class="detail-value tag-chips-wrap">${featuringChips}</span>` : '', raw: song.featuring || '' },
        { label: 'Category',  valueHtml: `<span class="detail-value detail-category">${chip('category', song.category || '', 'tag-chip--category')}</span>`, raw: song.category || '' },
        { label: 'Genre',     valueHtml: `<span class="detail-value">${chip('genre', song.genre || '', 'tag-chip--genre')}</span>`, raw: song.genre || '' },
        { label: 'Album',     valueHtml: `<span class="detail-value">${chip('album', song.album || '', 'tag-chip--album')}</span>`, raw: song.album || '' },
        { label: 'Released',  valueHtml: `<span class="detail-value">${chip('released', song.released || '', 'tag-chip--released')}</span>`, raw: song.released || '' },
      ]
        .filter(r => r.raw.trim() !== '')
        .map(r => `
        <li class="detail-row">
          <span class="detail-label">${r.label}</span>
          ${r.valueHtml}
        </li>`).join('');

      /* ── Audio preview ── */
      const hasAudio = isValidAudioUrl(song.songUrl);
      const audioHTML = hasAudio
        ? `<audio class="card-audio" controls preload="none" data-card-index="fav-${idx}">
             <source src="${escAttr(song.songUrl)}" type="audio/mpeg" />
           </audio>`
        : `<p class="no-preview"><i class="bi bi-slash-circle me-1"></i>Preview unavailable</p>`;

      /* ── Download button ── */
      const dlFilename = song.title + ' - ' + song.artist +
        (song.featuring && song.featuring.trim() ? ' ft. ' + song.featuring : '') + '.mp3';
      const downloadHTML = hasAudio
        ? `<button
             class="btn-download"
             data-url="${escAttr(song.songUrl)}"
             data-filename="${escAttr(dlFilename)}">
             <i class="bi bi-download me-2"></i>Download ${escHtml(song.artist)} – ${escHtml(song.title)}
           </button>`
        : '';

      const cardEl = document.createElement('div');
      cardEl.className = 'song-card';
      cardEl.style.animationDelay = `${Math.min(idx * 0.05, 0.5)}s`;
      cardEl.dataset.cardIndex = `fav-${idx}`;
      cardEl.dataset.favKey    = songKey(song);
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

      const audioEl = cardEl.querySelector('audio.card-audio');
      audioNodes.push(audioEl);
    });

    wireAudioAutoplay(audioNodes);
    showState('results');

    /* setStatus uses textContent so we set the count normally then
       override statusText with innerHTML to render the heart icon */
    setStatus('\u2665 Your Favourites', favs.length);
    statusText.innerHTML = '<i class="bi bi-heart-fill me-1" style="color:#ef4444;font-size:.9em"></i> Your Favourites';

    /* Scroll smoothly to the results so they are in view, not hidden
       below the (collapsed) Recently Released section */
    resultsWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Button click: toggle fav view on/off ── */
  favouritesBtn.addEventListener('click', () => {
    if (isFavView) {
      /* Second click exits the favourites view — same as Clear */
      isFavView = false;
      clearSearch();
    } else {
      showFavouritesInline();
    }
  });

  /* ── When a heart is toggled while in fav view, live-refresh the grid ── */
  /*
   * We patch into the heart-toggle handler by listening for the custom
   * "favchange" event that we dispatch after every toggle (see updated
   * injectHeart below).  This keeps the inline view in sync without
   * modifying any existing code paths.
   */
  document.addEventListener('favchange', () => {
    refreshCountBadge();
    if (isFavView) showFavouritesInline();
  });

  /* ── Exit fav view whenever a real search, clear, or shuffle fires ── */
  searchBtn.addEventListener('click',    () => { isFavView = false; }, true);
  clearBtn.addEventListener('click',     () => { isFavView = false; }, true);
  retryBtn.addEventListener('click',     () => { isFavView = false; }, true);

  /* Shuffle buttons — must reset isFavView so a heart-toggle during shuffled
     playback does NOT reload the favourites view over the shuffled songs. */
  document.getElementById('shuffleBtn').addEventListener('click',
    () => { isFavView = false; }, true);
  /* Also covers the per-category dropdown items */
  document.getElementById('shuffleDropdown')
    .querySelectorAll('.shuffle-dropdown-item')
    .forEach(item => item.addEventListener('click', () => { isFavView = false; }, true));

  /* ── Initialise badge on page load ─────────── */
  refreshCountBadge();

})();


/* =====================================================
   SHUFFLE MODULE  (v2 — split-button with category filter)
   Self-contained IIFE. Reads allSongs (never mutates it).

   API category values (confirmed from live API inspection):
     Nigerian Music → song.category === 'Nigeria Music'
     Foreign Music  → song.category === 'Foreign Music'

   Algorithm: Partial Fisher-Yates — O(SHUFFLE_COUNT) regardless
   of catalogue size.  No duplicates within one shuffle session.
   ===================================================== */

(function initShuffle() {

  const SHUFFLE_COUNT = 50; /* max songs per shuffle */

  /* ── DOM refs ──────────────────────────────── */
  const shuffleBtn            = document.getElementById('shuffleBtn');
  const dropdownToggle        = document.getElementById('shuffleDropdownToggle');
  const dropdownEl            = document.getElementById('shuffleDropdown');
  const shuffleSplitWrap      = document.getElementById('shuffleSplitWrap');
  const dropdownItems         = dropdownEl.querySelectorAll('.shuffle-dropdown-item');
  const chevronIcon           = dropdownToggle.querySelector('.shuffle-chevron-icon');

  /* ── State ─────────────────────────────────── */
  /* Active mode: 'all' | 'nigerian' | 'foreign' */
  let activeMode = 'all';
  let dropdownOpen = false;

  /* ── Fisher-Yates partial shuffle ──────────── */
  /**
   * Returns `count` unique, randomly-ordered items from `pool`.
   * Never mutates the source array.
   * @param {object[]} pool   Source array
   * @param {number}   count  Items to pick
   * @returns {object[]}
   */
  function pickRandom(pool, count) {
    const copy = pool.slice();          /* shallow copy — never touch allSongs */
    const n    = copy.length;
    const take = Math.min(count, n);    /* graceful: return all if fewer than count */

    for (let i = 0; i < take; i++) {
      const j    = i + Math.floor(Math.random() * (n - i));
      const tmp  = copy[i];
      copy[i]    = copy[j];
      copy[j]    = tmp;
    }

    return copy.slice(0, take);
  }

  /* ── Category pool builder ──────────────────── */
  /**
   * Returns the correct subset of allSongs for the given mode.
   * Uses the exact `category` field values from the live API.
   *
   * Confirmed values (2026-08-09 inspection):
   *   Nigerian → 'Nigeria Music'   (363 songs)
   *   Foreign  → 'Foreign Music'   (119 songs)
   *
   * @param {'all'|'nigerian'|'foreign'} mode
   * @returns {object[]}
   */
  function getPool(mode) {
    if (mode === 'nigerian') {
      return allSongs.filter(s =>
        s.category && s.category.trim() === 'Nigeria Music'
      );
    }
    if (mode === 'foreign') {
      return allSongs.filter(s =>
        s.category && s.category.trim() === 'Foreign Music'
      );
    }
    /* 'all' → entire catalogue */
    return allSongs;
  }

  /* ── Status message builder ─────────────────── */
  function buildStatusHtml(mode, count) {
    if (mode === 'nigerian') {
      return `<i class="bi bi-shuffle me-1" style="color:#f59e0b;font-size:.9em"></i> ` +
             `🇳🇬 Nigerian Shuffle — <strong>${count}</strong> random Nigerian song${count !== 1 ? 's' : ''} selected.`;
    }
    if (mode === 'foreign') {
      return `<i class="bi bi-shuffle me-1" style="color:#818cf8;font-size:.9em"></i> ` +
             `🌎 International Shuffle — <strong>${count}</strong> random foreign song${count !== 1 ? 's' : ''} selected.`;
    }
    /* 'all' */
    return `<i class="bi bi-shuffle me-1" style="color:#2dd4bf;font-size:.9em"></i> ` +
           `🔀 Shuffle Mix — <strong>${count}</strong> random song${count !== 1 ? 's' : ''} from your catalogue.`;
  }

  /* ── Core execute-shuffle ───────────────────── */
  function executeShuffle(mode) {
    /* Guard: catalogue must be loaded */
    if (!allSongs || allSongs.length === 0) {
      setStatus('Catalogue is still loading — please wait a moment and try again.');
      return;
    }

    /* Animate the shuffle icon */
    shuffleBtn.classList.add('shuffling');
    shuffleBtn.addEventListener('animationend', () => {
      shuffleBtn.classList.remove('shuffling');
    }, { once: true });

    const pool   = getPool(mode);
    const picked = pickRandom(pool, SHUFFLE_COUNT);

    if (picked.length === 0) {
      setStatus(`No songs found for the selected category. Try a different shuffle option.`);
      return;
    }

    /* Collapse recently-released section for focus */
    collapseRecentSection();

    /* Render using existing infrastructure — hearts / download / audio all wire up */
    renderResults(picked, {});

    /* Override the generic status text with our shuffle-specific message */
    statusText.innerHTML = buildStatusHtml(mode, picked.length);

    /* Scroll results into view */
    resultsWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Active-mode indicator ──────────────────── */
  function setActiveMode(mode) {
    activeMode = mode;

    dropdownItems.forEach(item => {
      const isActive = item.dataset.shuffleMode === mode;
      item.classList.toggle('shuffle-item-active', isActive);
      item.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
  }

  /* ── Dropdown open / close ──────────────────── */
  function openDropdown() {
    dropdownOpen = true;
    dropdownEl.classList.add('shuffle-dropdown-open');
    dropdownToggle.setAttribute('aria-expanded', 'true');
    chevronIcon.style.transform = 'rotate(180deg)';

    /* Focus first item for keyboard navigation */
    const first = dropdownEl.querySelector('.shuffle-dropdown-item');
    if (first) first.focus();
  }

  function closeDropdown() {
    dropdownOpen = false;
    dropdownEl.classList.remove('shuffle-dropdown-open');
    dropdownToggle.setAttribute('aria-expanded', 'false');
    chevronIcon.style.transform = '';
  }

  function toggleDropdown() {
    if (dropdownOpen) {
      closeDropdown();
    } else {
      openDropdown();
    }
  }

  /* ── Event: main shuffle button ─────────────── */
  shuffleBtn.addEventListener('click', () => {
    closeDropdown();
    executeShuffle(activeMode);   /* uses current (or default 'all') mode */
  });

  /* ── Event: dropdown toggle (▼) ─────────────── */
  dropdownToggle.addEventListener('click', e => {
    e.stopPropagation();
    toggleDropdown();
  });

  /* ── Event: dropdown items ───────────────────── */
  dropdownItems.forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      const mode = item.dataset.shuffleMode;
      setActiveMode(mode);
      closeDropdown();
      executeShuffle(mode);
    });
  });

  /* ── Keyboard: dropdown arrow-key navigation ─── */
  dropdownEl.addEventListener('keydown', e => {
    const items = [...dropdownEl.querySelectorAll('.shuffle-dropdown-item')];
    const cur   = document.activeElement;
    const idx   = items.indexOf(cur);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < items.length - 1) items[idx + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) items[idx - 1].focus();
      else { closeDropdown(); dropdownToggle.focus(); }
    } else if (e.key === 'Escape') {
      closeDropdown();
      dropdownToggle.focus();
    } else if (e.key === 'Tab') {
      closeDropdown();
    }
  });

  /* ── Close on outside click ─────────────────── */
  document.addEventListener('click', e => {
    if (dropdownOpen && !shuffleSplitWrap.contains(e.target)) {
      closeDropdown();
    }
  });

  /* ── Close on Escape anywhere ───────────────── */
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dropdownOpen) {
      closeDropdown();
      dropdownToggle.focus();
    }
  });

  /* ── Close dropdown when user runs a real search or clears ─ */
  document.getElementById('searchBtn').addEventListener('click', closeDropdown, true);
  document.getElementById('clearBtn').addEventListener('click', closeDropdown, true);

  /* ── Initialise active-mode ARIA attributes ─── */
  setActiveMode('all');

})();
