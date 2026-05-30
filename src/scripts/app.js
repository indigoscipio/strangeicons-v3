/**
 * strangeicons v3 — client app
 * All filtering, rendering, copy, and download logic.
 * Runs entirely in-browser against the pre-built icons.json index.
 */

// ─── State ────────────────────────────────────────────────────────────────────

let allIcons = [];       // raw icons.json data
let activeFamily = null; // string
let activeStyle  = 'regular'; // string | 'all'
let searchQuery  = '';    // string
let activePanel  = null;  // { icon, style } | null

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const grid        = document.getElementById('icon-grid');
const emptyState  = document.getElementById('empty-state');
const iconCount   = document.getElementById('icon-count');
const resultCount = document.getElementById('result-count');
const searchInput = document.getElementById('search-input');
const detailPanel = document.getElementById('detail-panel');
const panelClose  = document.getElementById('panel-close');
const panelBackdrop = document.getElementById('panel-backdrop');
const panelPreview  = document.getElementById('panel-preview');
const panelName     = document.getElementById('panel-name');
const panelMeta     = document.getElementById('panel-meta');
const panelStyles   = document.getElementById('panel-styles');
const btnCopySvg    = document.getElementById('btn-copy-svg');
const btnCopyName   = document.getElementById('btn-copy-name');
const btnDownload   = document.getElementById('btn-download');

// ─── Boot ─────────────────────────────────────────────────────────────────────

async function init() {
  const res  = await fetch('/icons.json');
  allIcons   = await res.json();

  // Set initial family to first available
  const families = [...new Set(allIcons.map(i => i.family))];
  activeFamily   = families[0] ?? null;

  // Mark correct sidebar item active on load
  document.querySelectorAll('[data-filter="family"]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.value === activeFamily);
  });

  updateIconCount();
  render();
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function getFiltered() {
  return allIcons.filter(icon => {
    const familyMatch = !activeFamily || icon.family === activeFamily;
    const styleMatch  = activeStyle === 'all' || icon.styles.includes(activeStyle);
    const q           = searchQuery.trim().toLowerCase();
    const searchMatch = !q || icon.name.includes(q);
    return familyMatch && styleMatch && searchMatch;
  });
}

// ─── Render grid ──────────────────────────────────────────────────────────────

function render() {
  const filtered = getFiltered();

  grid.innerHTML      = '';
  emptyState.style.display = filtered.length === 0 ? 'flex' : 'none';
  grid.style.display       = filtered.length === 0 ? 'none'  : 'grid';

  resultCount.textContent = filtered.length > 0
    ? `${filtered.length} icons`
    : '';

  // Determine which style to show per icon
  const displayStyle = activeStyle !== 'all'
    ? activeStyle
    : null; // will pick first available

  for (const icon of filtered) {
    const style = displayStyle && icon.styles.includes(displayStyle)
      ? displayStyle
      : icon.styles[0];

    const card = document.createElement('button');
    card.className = 'icon-card';
    card.dataset.name   = icon.name;
    card.dataset.family = icon.family;
    card.dataset.style  = style;
    card.title = icon.name;

    // Load SVG inline
    const img = document.createElement('img');
    img.src = `/icons/${icon.family}/${style}/${icon.name}.svg`;
    img.alt    = icon.name;
    img.width  = 28;
    img.height = 28;
    img.style.cssText = 'width:28px;height:28px;object-fit:contain;';

    const label = document.createElement('span');
    label.className   = 'icon-card-name';
    label.textContent = icon.name.replace(/-/g, ' ');

    card.appendChild(img);
    card.appendChild(label);

    card.addEventListener('click', () => openPanel(icon, style));
    grid.appendChild(card);
  }
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

async function openPanel(icon, style) {
  activePanel = { icon, style };

  panelName.textContent = icon.name.replace(/-/g, ' ');
  panelMeta.textContent = `${icon.family} · ${style}`;

  // Preview
  panelPreview.innerHTML = '';
  const img = document.createElement('img');
  img.src = `/icons/${icon.family}/${style}/${icon.name}.svg`;
  img.alt = icon.name;
  img.style.cssText = 'width:44px;height:44px;object-fit:contain;';
  panelPreview.appendChild(img);

  // Style chips
  panelStyles.innerHTML = '';
  for (const s of icon.styles) {
    const chip = document.createElement('button');
    chip.className    = `style-chip ${s === style ? 'active' : ''}`;
    chip.textContent  = s;
    chip.addEventListener('click', () => openPanel(icon, s));
    panelStyles.appendChild(chip);
  }

  detailPanel.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closePanel() {
  detailPanel.style.display = 'none';
  document.body.style.overflow = '';
  activePanel = null;
}

// ─── Copy / Download ──────────────────────────────────────────────────────────

async function fetchSvgText(family, style, name) {
  const res = await fetch(`/icons/${family}/${style}/${name}.svg`);
  return res.text();
}

btnCopySvg.addEventListener('click', async () => {
  if (!activePanel) return;
  const { icon, style } = activePanel;
  const svg = await fetchSvgText(icon.family, style, icon.name);
  await navigator.clipboard.writeText(svg);
  flashButton(btnCopySvg, 'Copied!');
});

btnCopyName.addEventListener('click', async () => {
  if (!activePanel) return;
  await navigator.clipboard.writeText(activePanel.icon.name);
  flashButton(btnCopyName, 'Copied!');
});

btnDownload.addEventListener('click', async () => {
  if (!activePanel) return;
  const { icon, style } = activePanel;
  const svg  = await fetchSvgText(icon.family, style, icon.name);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${icon.name}-${style}.svg`;
  a.click();
  URL.revokeObjectURL(url);
});

function flashButton(btn, text) {
  const original = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = original; }, 1400);
}

// ─── Sidebar interactions ─────────────────────────────────────────────────────

document.querySelectorAll('[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    const { filter, value } = btn.dataset;

    if (filter === 'family') {
      activeFamily = value;
      document.querySelectorAll('[data-filter="family"]').forEach(b =>
        b.classList.toggle('active', b.dataset.value === value)
      );
    }

    if (filter === 'style') {
      activeStyle = value;
      document.querySelectorAll('[data-filter="style"]').forEach(b =>
        b.classList.toggle('active', b.dataset.value === value)
      );
    }

    render();
  });
});

// ─── Search ───────────────────────────────────────────────────────────────────

searchInput.addEventListener('input', e => {
  searchQuery = e.target.value;
  render();
});

// Keyboard shortcut: press / to focus search
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
  if (e.key === 'Escape') {
    if (activePanel) closePanel();
    else searchInput.blur();
  }
});

// ─── Panel close ──────────────────────────────────────────────────────────────

panelClose.addEventListener('click', closePanel);
panelBackdrop.addEventListener('click', closePanel);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function updateIconCount() {
  const families = [...new Set(allIcons.map(i => i.family))];
  iconCount.textContent = `${allIcons.length} icons · ${families.length} famil${families.length === 1 ? 'y' : 'ies'}`;
}

// ─── Start ────────────────────────────────────────────────────────────────────

init();