// BORDER HISTORY VIEWER — app.js

// ---- Global State ----
let currentYear = 1800;
let currentStyle = 'historical'; // 'historical' | 'woodblock' | 'japanese_scroll'
let currentProjection = 'mercator'; // 'mercator' | 'globe'
let currentTheme = 'dark'; // 'dark' | 'light'

const STYLE_URLS = {
  historical: 'https://unpkg.com/@openhistoricalmap/map-styles@latest/dist/historical/historical.json',
  woodblock: 'https://unpkg.com/@openhistoricalmap/map-styles@latest/dist/woodblock/woodblock.json',
  japanese_scroll: 'https://unpkg.com/@openhistoricalmap/map-styles@latest/dist/japanese_scroll/japanese_scroll.json'
};

// ---- Settings Persistence ----
function saveSettings() {
  const settings = {
    year: currentYear,
    style: currentStyle,
    projection: currentProjection,
    theme: currentTheme
  };
  localStorage.setItem('border_history_settings', JSON.stringify(settings));
}

function loadSettings() {
  const saved = localStorage.getItem('border_history_settings');
  if (saved) {
    try {
      const s = JSON.parse(saved);
      if (s.year !== undefined) currentYear = parseInt(s.year);
      if (s.style) currentStyle = s.style;
      if (s.projection) currentProjection = s.projection;
      if (s.theme) currentTheme = s.theme;
    } catch (e) {
      console.warn('Failed to load settings', e);
    }
  }
}
loadSettings();

// Apply initial theme to body
document.body.classList.toggle('light-mode', currentTheme === 'light');

// ---- Helper to format year to YYYY-MM-DD for OHM plugin ----
function formatDateString(year) {
  const absYear = Math.abs(year);
  const padded = String(absYear).padStart(4, '0');
  const sign = year < 0 ? '-' : '';
  // Return YYYY-01-01 format
  return `${sign}${padded}-01-01`;
}

// ---- Initialize MapLibre GL ----
const map = new maplibregl.Map({
  container: 'map',
  style: STYLE_URLS[currentStyle],
  center: [12.4964, 41.9028], // Center on Rome, Italy
  zoom: 3.5,
  maxZoom: 16,
  antialias: true,
  projection: currentProjection
});

// Update the map projection
function updateProjection() {
  if (map) {
    map.setProjection({ type: currentProjection });
  }
}

// ---- Handle Date/Year Filtering ----
let isStyleLoaded = false;
function applyDateFilter() {
  const statusEl = document.getElementById('status');
  if (!map || !isStyleLoaded) {
    if (statusEl) statusEl.textContent = 'Loading style...';
    return;
  }

  const dateStr = formatDateString(currentYear);
  try {
    // Call the maplibre-gl-dates plugin extension method
    map.filterByDate(dateStr);
    
    // Display era string
    let eraText = currentYear < 0 ? `${Math.abs(currentYear)} BCE` : `${currentYear} CE`;
    if (statusEl) statusEl.textContent = `Showing Year: ${eraText}`;
  } catch (err) {
    console.error('Filtering error:', err);
    if (statusEl) statusEl.textContent = 'Error filtering dates';
  }
}

// Map lifecycle events
map.on('style.load', () => {
  isStyleLoaded = true;
  updateProjection();
  applyDateFilter();
});

map.on('styledata', () => {
  isStyleLoaded = true;
  applyDateFilter();
});

// ---- Popup on click to inspect boundaries ----
map.on('click', (e) => {
  // Query features in the viewport
  const features = map.queryRenderedFeatures(e.point);
  
  // Find the first feature that has OHM metadata
  const historicalFeature = features.find(f => {
    const props = f.properties || {};
    return props.name || props.start_date || props.end_date || props.wikidata;
  });

  if (historicalFeature) {
    const props = historicalFeature.properties;
    const name = props.name || 'Unnamed Boundary';
    const startDate = props.start_date || 'Unknown';
    const endDate = props.end_date || 'Present';
    const wikidata = props.wikidata || null;
    
    let popupHTML = `
      <div class="popup-details">
        <h3>${name}</h3>
        <div class="popup-row">
          <span class="popup-label">Starts:</span>
          <span class="popup-val">${startDate}</span>
        </div>
        <div class="popup-row">
          <span class="popup-label">Ends:</span>
          <span class="popup-val">${endDate}</span>
        </div>
    `;

    if (wikidata) {
      popupHTML += `
        <div class="popup-row" style="margin-top: 6px; border-top: 1px solid var(--border); padding-top: 6px;">
          <span class="popup-label">Wikidata:</span>
          <span class="popup-val">
            <a href="https://www.wikidata.org/wiki/${wikidata}" target="_blank" style="color: var(--accent); text-decoration: none;">
              ${wikidata} ↗
            </a>
          </span>
        </div>
      `;
    }

    popupHTML += `</div>`;

    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(popupHTML)
      .addTo(map);
  }
});

// ---- UI Bindings ----

// Slider Elements
const slider = document.getElementById('timeline-slider');
const yearInput = document.getElementById('year-input');

function updateYearUI(year) {
  currentYear = parseInt(year);
  slider.value = currentYear;
  yearInput.value = currentYear;
  applyDateFilter();
  saveSettings();
}

slider.addEventListener('input', (e) => {
  updateYearUI(e.target.value);
});

yearInput.addEventListener('change', (e) => {
  let val = parseInt(e.target.value);
  if (isNaN(val)) val = 1800;
  val = Math.max(-2000, Math.min(2026, val));
  updateYearUI(val);
});

// Click timeline ticks to jump to years
document.querySelectorAll('.timeline-ticks span').forEach(tick => {
  tick.addEventListener('click', () => {
    const year = parseInt(tick.getAttribute('data-year'));
    updateYearUI(year);
  });
});

// Settings menu toggling
window.toggleSettings = function (event) {
  event.stopPropagation();
  document.getElementById('settings-menu').classList.toggle('show');
};

document.addEventListener('click', () => {
  document.getElementById('settings-menu').classList.remove('show');
});

document.getElementById('settings-menu').addEventListener('click', (e) => {
  e.stopPropagation();
});

// Theme Selector
const themeSelect = document.getElementById('theme-select');
themeSelect.value = currentTheme;
themeSelect.addEventListener('change', (e) => {
  currentTheme = e.target.value;
  document.body.classList.toggle('light-mode', currentTheme === 'light');
  saveSettings();
});

// Projection Selector
const projectionSelect = document.getElementById('projection-select');
projectionSelect.value = currentProjection;
projectionSelect.addEventListener('change', (e) => {
  currentProjection = e.target.value;
  updateProjection();
  saveSettings();
});

// Style Selector
const styleSelect = document.getElementById('style-select');
styleSelect.value = currentStyle;
styleSelect.addEventListener('change', (e) => {
  currentStyle = e.target.value;
  isStyleLoaded = false;
  map.setStyle(STYLE_URLS[currentStyle]);
  saveSettings();
});

// Initialize UI state
updateYearUI(currentYear);
