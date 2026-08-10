/**
 * strange icons v3 — client app
 * Virtual scrolling, SVG sprites, fast filtering.
 */

import library from '../data/library.json';
import { createSearchIndex, searchIcons } from './search.js';

// ── Config ────────────────────────────────────────────────────────────────────
const CARD_HEIGHT     = 100;
const CARD_MIN_WIDTH  = 88;
const CARD_GAP        = 6;
const BUFFER_ROWS     = 3;
const SEARCH_DEBOUNCE = 120;

// ── State ─────────────────────────────────────────────────────────────────────
let allIcons      = [];
let searchIndex   = [];
let filtered      = [];
let activeFamily  = library.defaultFamily;
let activeStyle   = library.defaultStyle;
let searchQuery   = '';
let activePanel   = null;
let colCount      = 1;
let cardWidth     = CARD_MIN_WIDTH;
let renderedStart = -1;
let renderedEnd   = -1;
let scrollRAF     = null;
let resizeRAF     = null;
let searchTimer   = null;
let gridTopCache  = 0;
let isFiltering   = false;

const spriteCache = new Map();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const grid          = document.getElementById('icon-grid');
const gridWrap      = document.getElementById('grid-wrap');
const emptyState    = document.getElementById('empty-state');
const resultCount   = document.getElementById('result-count');
const searchInput   = document.getElementById('search-input');
const detailPanel   = document.getElementById('detail-panel');
const panelClose    = document.getElementById('panel-close');
const panelPreview  = document.getElementById('panel-preview');
const panelName     = document.getElementById('panel-name');
const panelMeta     = document.getElementById('panel-meta');
const panelStyles   = document.getElementById('panel-styles');
const btnCopySvg    = document.getElementById('btn-copy-svg');
const btnDownload   = document.getElementById('btn-download');
const menuToggle    = document.getElementById('menu-toggle');
const sidebar       = document.getElementById('sidebar');
let sidebarOverlay  = document.getElementById('sidebar-overlay');

if (!sidebarOverlay) {
  sidebarOverlay = document.createElement('div');
  sidebarOverlay.id = 'sidebar-overlay';
  Object.assign(sidebarOverlay.style, {
    position: 'fixed', inset: '0',
    background: 'rgba(0,0,0,0.18)',
    backdropFilter: 'blur(2px)',
    opacity: '0', pointerEvents: 'none',
    transition: 'opacity 0.22s cubic-bezier(0.4,0,0.2,1)',
    zIndex: '8',
  });
  document.body.appendChild(sidebarOverlay);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function setSidebarOpen(open) {
  if (!sidebar) return;
  sidebar.classList.toggle('open', open);
  if (sidebarOverlay) {
    sidebarOverlay.style.opacity = open ? '1' : '0';
    sidebarOverlay.style.pointerEvents = open ? 'auto' : 'none';
  }
}

function getGridInnerWidth() {
  if (!gridWrap) return window.innerWidth;
  const styles = getComputedStyle(gridWrap);
  return Math.max(0, gridWrap.clientWidth
    - (parseFloat(styles.paddingLeft) || 0)
    - (parseFloat(styles.paddingRight) || 0));
}

function recalcColumns() {
  const innerWidth = getGridInnerWidth();
  colCount = Math.max(1, Math.floor((innerWidth + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
  cardWidth = Math.floor((innerWidth - (colCount - 1) * CARD_GAP) / colCount);
  if (!Number.isFinite(cardWidth) || cardWidth < CARD_MIN_WIDTH) {
    cardWidth = CARD_MIN_WIDTH;
  }
}

function recalcGridTop() {
  if (!gridWrap) { gridTopCache = 0; return; }
  const styles = getComputedStyle(gridWrap);
  gridTopCache = gridWrap.offsetTop + (parseFloat(styles.paddingTop) || 0);
}

function getRowCount()    { return Math.ceil(filtered.length / colCount); }
function getTotalHeight() { return getRowCount() * CARD_HEIGHT; }

function iconNameLabel(name) { return String(name).replace(/-/g, ' '); }

function spriteUrl(key) {
  return `/sprites/${key}.svg?v=${encodeURIComponent(library.assetReleaseVersion)}`;
}

function flashButton(btn, text) {
  if (btn._flashTimer) {
    clearTimeout(btn._flashTimer);
  } else {
    btn.dataset._orig = btn.textContent;
  }
  btn.textContent = text;
  btn._flashTimer = setTimeout(() => {
    btn.textContent = btn.dataset._orig;
    btn._flashTimer = null;
    delete btn.dataset._orig;
  }, 1200);
}

// Get SVG text from DOM or cache
function getSvgText(family, style, name) {
  const el = document.getElementById(`${family}/${style}/${name}`)
    || spriteCache.get(`${family}-${style}`)?.find(s => s.id === `${family}/${style}/${name}`);
  if (!el) return null;
  const vb = el.getAttribute('viewBox') || '0 0 24 24';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${el.innerHTML}</svg>`;
}

// Swap all sprite symbols — keeps DOM lean (only current family/style)
function replaceSymbols(symbols) {
  const sheet = document.getElementById('sprite-sheet');
  sheet.querySelectorAll('symbol').forEach(s => s.remove());
  sheet.append(...symbols);
}

// Load a sprite into the sprite-sheet container (caches parsed symbols)
async function loadSprite(family, style) {
  const key = `${family}-${style}`;
  let symbols;
  if (spriteCache.has(key)) {
    symbols = spriteCache.get(key);
  } else {
    const res = await fetch(spriteUrl(key));
    if (!res.ok) throw new Error(`Failed to load sprite: ${key}`);
    const text = await res.text();
    const temp = document.createElement('div');
    temp.innerHTML = text;
    symbols = Array.from(temp.querySelectorAll('symbol'));
    spriteCache.set(key, symbols);
  }
  replaceSymbols(symbols);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  const res = await fetch('/icons.json');
  if (!res.ok) throw new Error('icons.json could not be loaded');
  allIcons = await res.json();
  searchIndex = createSearchIndex(allIcons);

  const families = [...new Set(allIcons.map(i => i.family))].sort();
  activeFamily = families.includes(library.defaultFamily)
    ? library.defaultFamily
    : families[0] ?? null;

  // Seed cache with inlined sprite symbols
  const inlinedSymbols = Array.from(document.querySelectorAll('#sprite-sheet > symbol'));
  if (inlinedSymbols.length > 0) {
    spriteCache.set(`${activeFamily}-${activeStyle}`, inlinedSymbols);
  }

  document.querySelectorAll('[data-filter="family"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === activeFamily);
  });
  document.querySelectorAll('[data-filter="style"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === activeStyle);
  });

  recalcGridTop();
  refilter(true);
  setupListeners();
  setupVirtualScroll();
}

// ── Filtering ─────────────────────────────────────────────────────────────────
async function refilter(scrollToTop = false) {
  if (isFiltering) return;
  closePanel();
  isFiltering = true;

  filtered = searchIcons(searchIndex, {
    family: activeFamily,
    style: activeStyle,
    query: searchQuery,
  });

  resultCount.textContent = filtered.length > 0 ? `${filtered.length} icons` : '';

  const isEmpty = filtered.length === 0;
  emptyState.style.display = isEmpty ? 'flex' : 'none';
  grid.style.display = isEmpty ? 'none' : 'block';

  if (!isEmpty) {
    const spriteStyle = activeStyle !== 'all' ? activeStyle : filtered[0].styles[0];
    const spriteKey = `${activeFamily}-${spriteStyle}`;
    const needsFetch = !spriteCache.has(spriteKey);
    if (needsFetch) grid.style.opacity = '0.3';
    try {
      await loadSprite(activeFamily, spriteStyle);
    } catch (err) {
      console.error(err);
    }
    grid.style.opacity = '';
  }

  if (scrollToTop) window.scrollTo(0, 0);
  renderedStart = -1;
  renderedEnd   = -1;
  if (!isEmpty) renderVisible();

  isFiltering = false;
}

// ── Virtual scroll ────────────────────────────────────────────────────────────
function setupVirtualScroll() {
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
}

function onScroll() {
  if (scrollRAF) return;
  scrollRAF = requestAnimationFrame(() => { scrollRAF = null; renderVisible(); });
}

function onResize() {
  if (resizeRAF) cancelAnimationFrame(resizeRAF);
  resizeRAF = requestAnimationFrame(() => {
    recalcGridTop();
    recalcColumns();
    renderedStart = -1;
    renderedEnd   = -1;
    renderVisible();
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderVisible() {
  if (filtered.length === 0) return;

  recalcColumns();

  const totalHeight = getTotalHeight();
  grid.style.minHeight = `${totalHeight}px`;
  grid.style.position  = 'relative';

  const scrollTop  = window.scrollY;
  const vpHeight   = window.innerHeight;
  const relScroll  = Math.max(0, scrollTop - gridTopCache);

  const firstRow    = Math.max(0, Math.floor(relScroll / CARD_HEIGHT) - BUFFER_ROWS);
  const visibleRows = Math.ceil(vpHeight / CARD_HEIGHT) + BUFFER_ROWS * 2;
  const lastRow     = Math.min(getRowCount() - 1, firstRow + visibleRows);

  const startIdx = firstRow * colCount;
  const endIdx   = Math.min(filtered.length - 1, (lastRow + 1) * colCount - 1);

  if (startIdx === renderedStart && endIdx === renderedEnd) return;

  const displayStyle = activeStyle !== 'all' ? activeStyle : null;

  // Map of currently rendered cards
  const existing = new Map();
  for (const child of grid.children) {
    existing.set(Number(child.dataset.index), child);
  }

  // Remove cards that scrolled out of range
  const wanted = new Set();
  for (let i = startIdx; i <= endIdx; i++) wanted.add(i);
  for (const [idx, el] of existing) {
    if (!wanted.has(idx)) el.remove();
  }

  const frag = document.createDocumentFragment();

  for (let i = startIdx; i <= endIdx; i++) {
    const icon = filtered[i];
    if (!icon) continue;

    const style = displayStyle && icon.styles.includes(displayStyle)
      ? displayStyle : icon.styles[0];
    const row = Math.floor(i / colCount);
    const col = i % colCount;
    const top    = `${row * CARD_HEIGHT}px`;
    const left   = `${col * (cardWidth + CARD_GAP)}px`;
    const width  = `${cardWidth}px`;
    const height = `${CARD_HEIGHT - CARD_GAP}px`;
    const symbolId = `${icon.family}/${style}/${icon.name}`;

    if (existing.has(i)) {
      const card = existing.get(i);
      card.style.top    = top;
      card.style.left   = left;
      card.style.width  = width;
      card.style.height = height;
      card.dataset.style = style;
      card.title     = icon.name;
      const use = card.querySelector('use');
      if (use && use.getAttribute('href') !== `#${symbolId}`) {
        use.setAttribute('href', `#${symbolId}`);
      }
      const nameLabel = card.querySelector('.icon-card-name');
      if (nameLabel) nameLabel.textContent = iconNameLabel(icon.name);
    } else {
      const card = document.createElement('button');
      card.type      = 'button';
      card.className = 'icon-card';
      card.dataset.index  = String(i);
      card.dataset.family = icon.family;
      card.dataset.style  = style;
      card.dataset.name   = icon.name;
      card.title     = icon.name;
      card.style.cssText =
        `position:absolute;top:${top};left:${left};width:${width};height:${height};`;

      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width',  '28');
      svg.setAttribute('height', '28');
      svg.style.cssText = 'width:28px;height:28px;flex-shrink:0;';
      const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
      use.setAttribute('href', `#${symbolId}`);
      svg.appendChild(use);

      const lbl = document.createElement('span');
      lbl.className   = 'icon-card-name';
      lbl.textContent = iconNameLabel(icon.name);

      card.appendChild(svg);
      card.appendChild(lbl);
      frag.appendChild(card);
    }
  }

  grid.appendChild(frag);
  renderedStart = startIdx;
  renderedEnd   = endIdx;
}

// ── Detail panel ──────────────────────────────────────────────────────────────
async function openPanel(icon, style) {
  activePanel = { icon, style };

  panelName.textContent = iconNameLabel(icon.name);
  panelMeta.textContent = `${icon.family} · ${style}`;

  // Ensure sprite is cached without swapping
  const key = `${icon.family}-${style}`;
  if (!spriteCache.has(key)) {
    const res = await fetch(spriteUrl(key));
    if (!res.ok) throw new Error(`Failed to load sprite: ${key}`);
    const text = await res.text();
    const temp = document.createElement('div');
    temp.innerHTML = text;
    spriteCache.set(key, Array.from(temp.querySelectorAll('symbol')));
  }

  panelPreview.replaceChildren();
  const cached = spriteCache.get(key);
  const el = cached.find(s => s.id === `${icon.family}/${style}/${icon.name}`);
  if (el) {
    const vb = el.getAttribute('viewBox') || '0 0 24 24';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', vb);
    svg.setAttribute('width', '44');
    svg.setAttribute('height', '44');
    svg.innerHTML = el.innerHTML;
    panelPreview.appendChild(svg);
  }

  panelStyles.replaceChildren();
  for (const s of icon.styles) {
    const chip = document.createElement('button');
    chip.type        = 'button';
    chip.className   = `style-chip${s === style ? ' active' : ''}`;
    chip.textContent = s;
    chip.addEventListener('click', () => { openPanel(icon, s).catch(console.error); });
    panelStyles.appendChild(chip);
  }

  detailPanel.style.display = 'flex';
}

function closePanel() {
  detailPanel.style.display = 'none';
  activePanel = null;
  document.querySelectorAll('.icon-card.selected').forEach(c => c.classList.remove('selected'));
}

// ── Copy / download ───────────────────────────────────────────────────────────
btnCopySvg?.addEventListener('click', async () => {
  if (!activePanel) return;
  const { icon, style } = activePanel;
  const svg = getSvgText(icon.family, style, icon.name);
  if (!svg) { flashButton(btnCopySvg, 'Missing'); return; }
  try {
    await navigator.clipboard.writeText(svg);
    flashButton(btnCopySvg, 'Copied!');
  } catch {
    flashButton(btnCopySvg, 'Failed');
  }
});

btnDownload?.addEventListener('click', async () => {
  if (!activePanel) return;
  const { icon, style } = activePanel;
  const svg = getSvgText(icon.family, style, icon.name);
  if (!svg) { flashButton(btnDownload, 'Missing'); return; }
  try {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href     = url;
    a.download = `${icon.name}-${style}.svg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    flashButton(btnDownload, 'Done');
  } catch {
    flashButton(btnDownload, 'Failed');
  }
});

// ── Listeners ─────────────────────────────────────────────────────────────────
function setupListeners() {
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.icon-card');
    if (!card) return;
    const idx  = Number(card.dataset.index);
    const icon = filtered[idx];
    if (!icon) return;
    const style = card.dataset.style || activeStyle;
    document.querySelectorAll('.icon-card.selected').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    openPanel(icon, style).catch(console.error);
  });

  document.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const { filter, value } = btn.dataset;
      if (filter === 'family') {
        activeFamily = value;
        document.querySelectorAll('[data-filter="family"]').forEach(b => {
          b.classList.toggle('active', b.dataset.value === value);
        });
      }
      if (filter === 'style') {
        activeStyle = value;
        document.querySelectorAll('[data-filter="style"]').forEach(b => {
          b.classList.toggle('active', b.dataset.value === value);
        });
      }
      refilter(true).catch(console.error);
      if (window.innerWidth < 768) setSidebarOpen(false);
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      const value = e.target.value;
      searchTimer = setTimeout(() => {
        searchQuery = value;
        refilter(true).catch(console.error);
      }, SEARCH_DEBOUNCE);
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
    if (e.key === 'Escape') {
      if (activePanel) { closePanel(); }
      else { searchInput?.blur(); setSidebarOpen(false); }
    }
  });

  panelClose?.addEventListener('click', closePanel);

  menuToggle?.addEventListener('click', () => {
    setSidebarOpen(!sidebar?.classList.contains('open'));
  });
  sidebarOverlay?.addEventListener('click', () => setSidebarOpen(false));

  window.addEventListener('resize', () => {
    if (window.innerWidth >= 768) setSidebarOpen(false);
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────
init().catch((err) => {
  console.error(err);
  emptyState.style.display = 'flex';
  emptyState.innerHTML = `
    <span class="empty-icon">⚠</span>
    <p>Failed to load icons</p>
    <span>Please check icons.json and refresh</span>`;
  grid.style.display = 'none';
});
