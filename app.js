// BORDER HISTORY VIEWER — app.js

// ---- Global State ----
let currentYear = 1800;
let currentStyle = 'historical'; // 'historical' | 'woodblock' | 'japanese_scroll'
let currentProjection = 'mercator'; // 'mercator' | 'globe'
let currentTheme = 'dark'; // 'dark' | 'light'
let currentLanguage = 'local'; // 'local' | 'en' | 'es' | 'fr' | 'ar'

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
    theme: currentTheme,
    language: currentLanguage
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
      if (s.language) currentLanguage = s.language;
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

// ---- Helper to format raw date string to BC/AD format ----
function formatDateStringToEra(dateStr) {
  if (!dateStr) return '?';
  let isBC = false;
  let cleanStr = dateStr;
  if (dateStr.startsWith('-')) {
    isBC = true;
    cleanStr = dateStr.slice(1);
  }
  const parts = cleanStr.split('-');
  const yearInt = parseInt(parts[0]);
  if (isNaN(yearInt)) return dateStr;
  return isBC ? `${yearInt} BC` : `${yearInt} AD`;
}

// ---- Handle Date/Year Filtering ----
let isStyleLoaded = false;
let filterTimeout = null;

function applyDateFilter() {
  const statusEl = document.getElementById('status');
  if (!map || !isStyleLoaded) {
    if (statusEl) statusEl.textContent = 'Loading style...';
    return;
  }

  try {
    // Pass the year as a string (e.g. "1800" or "-2000") so the plugin parses it into a valid dateRange object
    map.filterByDate(String(currentYear));
    let eraText = currentYear < 0 ? `${Math.abs(currentYear)} BC` : `${currentYear} AD`;
    if (statusEl) statusEl.textContent = `Showing Year: ${eraText}`;
  } catch (err) {
    console.error('Filtering error:', err);
    if (statusEl) statusEl.textContent = 'Error filtering dates';
  }
}

function debouncedApplyDateFilter() {
  if (filterTimeout) clearTimeout(filterTimeout);
  filterTimeout = setTimeout(() => {
    applyDateFilter();
  }, 150);
}

// ---- Handle Map Label Languages ----
function updateMapLanguage() {
  if (!map || !isStyleLoaded) return;
  try {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    
    const langKey = currentLanguage === 'local' ? 'name' : `name:${currentLanguage}`;
    let updatedCount = 0;
    
    style.layers.forEach(layer => {
      if (layer.type === 'symbol' && layer.layout && layer.layout['text-field']) {
        const currentField = layer.layout['text-field'];
        let newField;
        
        if (typeof currentField === 'string') {
          // Handles legacy templates like "{name}" or "{name:en}" or "{name_en}"
          newField = currentLanguage === 'local' ? '{name}' : `{name_${currentLanguage}}`;
        } else {
          // Modern expressions - fallback from name:en -> name_en -> name
          newField = currentLanguage === 'local'
            ? ['get', 'name']
            : ['coalesce', ['get', `name:${currentLanguage}`], ['get', `name_${currentLanguage}`], ['get', 'name']];
        }
        map.setLayoutProperty(layer.id, 'text-field', newField);
        updatedCount++;
      }
    });
    console.log(`[Language] Updated ${updatedCount} symbol layers to ${currentLanguage} (key: ${langKey})`);
  } catch (err) {
    console.warn('Could not update map language layers:', err);
  }
}

function fixStyleSortKeys() {
  if (!map || !isStyleLoaded) return;
  try {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    
    style.layers.forEach(layer => {
      if (layer.layout && layer.layout['symbol-sort-key']) {
        const sortKey = layer.layout['symbol-sort-key'];
        // Fix standard OpenHistoricalMap style type bug where string area_km2 is used for numeric sorting key
        if (Array.isArray(sortKey) && sortKey[0] === 'get' && sortKey[1] === 'area_km2') {
          map.setLayoutProperty(layer.id, 'symbol-sort-key', ['to-number', ['get', 'area_km2'], 0]);
          console.log(`[Fix] Applied to-number patch to symbol-sort-key of layer: ${layer.id}`);
        }
      }
    });
  } catch (err) {
    console.warn('Could not fix style sort keys:', err);
  }
}

// Map lifecycle events
map.on('style.load', () => {
  isStyleLoaded = true;
  fixStyleSortKeys();
  updateProjection();
  applyDateFilter();
  updateMapLanguage();
});

map.on('styledata', () => {
  isStyleLoaded = true;
  fixStyleSortKeys(); // Run dynamically to patch newly-loaded/modified style rules
  applyDateFilter();
  // Removed updateMapLanguage() from here to avoid recursive style update loops
});

// ---- Helper to build popup HTML ----
function makePopupHTML(name, eraRange, description, population, wikidata, wikipedia) {
  let popupHTML = `
    <div class="popup-details">
      <h3 style="display:flex; justify-content:space-between; align-items:baseline; gap:10px; margin-bottom: 8px;">
        <span>${name}</span>
        <span style="font-size:11px; font-weight:normal; color:var(--text-dim); white-space:nowrap;">${eraRange}</span>
      </h3>
  `;

  // Note: Short description removed per user request.

  if (population) {
    popupHTML += `
      <div style="font-size: 12px; margin-bottom: 4px;">
        <span style="color:var(--text-dim);">Population:</span>
        <span style="font-weight:500;">${Number(population).toLocaleString()}</span>
      </div>
    `;
  }

  if (wikidata || wikipedia) {
    popupHTML += `
      <div class="popup-footer-logos" style="margin-top: 8px; border-top: 1px solid var(--border); padding-top: 8px; display:flex; gap:14px; align-items:center;">
    `;
    if (wikidata) {
      popupHTML += `
        <a href="https://www.wikidata.org/wiki/${wikidata}" target="_blank" title="View on Wikidata" style="display: flex; align-items: center; opacity: 0.7; transition: opacity 0.2s;">
          <img src="https://upload.wikimedia.org/wikipedia/commons/f/ff/Wikidata-logo.svg" alt="Wikidata" style="height: 12px; width: auto; filter: var(--logo-filter);" />
        </a>
      `;
    }
    if (wikipedia) {
      const wpLangAndTitle = wikipedia.includes(':') ? wikipedia.split(':') : ['en', wikipedia];
      const wpUrl = `https://${wpLangAndTitle[0]}.wikipedia.org/wiki/${wpLangAndTitle[1]}`;
      popupHTML += `
        <a href="${wpUrl}" target="_blank" title="Read on Wikipedia" style="display: flex; align-items: center; opacity: 0.7; transition: opacity 0.2s;">
          <img src="https://upload.wikimedia.org/wikipedia/commons/5/5a/Wikipedia%27s_W.svg" alt="Wikipedia" style="height: 15px; width: auto; filter: var(--logo-filter);" />
        </a>
      `;
    }
    popupHTML += `</div>`;
  }

  popupHTML += `</div>`;
  return popupHTML;
}

// ---- Popup on click to inspect boundaries ----
map.on('click', (e) => {
  let features = [];
  try {
    const layers = map.getStyle().layers || [];
    // Query layers one by one, wrapping each in try-catch so that malformed layers don't break the entire query
    for (const layer of layers) {
      try {
        const layerFeatures = map.queryRenderedFeatures(e.point, { layers: [layer.id] });
        if (layerFeatures && layerFeatures.length > 0) {
          features.push(...layerFeatures);
        }
      } catch (layerErr) {
        // Quietly ignore layout/style type-mismatch evaluation crashes on individual layers
      }
    }
  } catch (err) {
    console.error('[Click] Layer list query failed:', err);
  }
  console.log('[Click] All features under cursor:', features.map(f => ({ id: f.id, layer: f.layer.id, properties: f.properties })));
  
  // Prioritize features that contain rich details like Wikidata or start dates
  let historicalFeature = features.find(f => f.properties && f.properties.wikidata);
  if (!historicalFeature) {
    historicalFeature = features.find(f => f.properties && f.properties.start_date);
  }
  if (!historicalFeature) {
    // If no date/wikidata tags exist, match any feature that has a name property
    historicalFeature = features.find(f => f.properties && f.properties.name);
  }

  if (historicalFeature) {
    console.log('[Click] Selected feature properties:', historicalFeature.properties);
    const props = historicalFeature.properties;
    
    // Determine translation key based on selected language
    let name = props.name || 'Unnamed Place';
    if (currentLanguage !== 'local') {
      const translation = props[`name:${currentLanguage}`] || props[`name_${currentLanguage}`];
      if (translation) {
        name = translation;
      }
    }
    
    // Format the date range safely
    let eraRange = '';
    if (props.start_date || props.end_date) {
      const startEra = formatDateStringToEra(props.start_date);
      const endEra = formatDateStringToEra(props.end_date);
      eraRange = `${startEra} - ${endEra}`;
    }
    // Helper to sanitize Wikidata ID values (extracts "Q12345" from URLs or spaces)
    function extractWikidataQID(str) {
      if (!str) return null;
      const match = String(str).trim().match(/(Q\d+)/);
      return match ? match[1] : null;
    }

    const qid = extractWikidataQID(props.wikidata);
    let wikidata = qid;
    let wikipedia = props.wikipedia || null;
    let description = props.description || props.note || null;
    let population = props.population || props.pop || props.population_tot || props.pop_tot || null;
    
    // Position popup at feature center if it's a point (e.g. label centroids), otherwise at cursor
    let popupLngLat = e.lngLat;
    if (historicalFeature.geometry && historicalFeature.geometry.type === 'Point') {
      popupLngLat = historicalFeature.geometry.coordinates;
    }

    // Render immediate popup with whatever is in the vector tiles
    const popup = new maplibregl.Popup({ anchor: 'bottom' })
      .setLngLat(popupLngLat)
      .setHTML(makePopupHTML(name, eraRange, description, population, wikidata, wikipedia))
      .addTo(map);

    // Helper to fetch Wikipedia summary
    function fetchWikipediaSummary(wpValue) {
      if (!wpValue) return;
      const wpLangAndTitle = wpValue.includes(':') ? wpValue.split(':') : ['en', wpValue];
      const lang = wpLangAndTitle[0];
      const title = wpLangAndTitle[1];
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/\s+/g, '_'))}?redirect=true`;
      console.log(`[Click] Fetching Wikipedia summary for ${title} from ${url}`);
      fetch(url)
        .then(response => response.ok ? response.json() : Promise.reject('Not OK'))
        .then(summary => {
          console.log('[Click] Wikipedia summary response:', summary);
          if (summary.extract && !description) {
            description = summary.extract;
            if (popup.isOpen()) {
              popup.setHTML(makePopupHTML(name, eraRange, description, population, wikidata, wikipedia));
            }
          }
        })
        .catch(err => console.warn('Failed to fetch Wikipedia summary:', err));
    }

    // Reusable function to fetch entity details by QID and update popup
    function fetchEntityDetails(targetQid) {
      if (!targetQid) return;
      
      // Update wikidata variable so it gets rendered in the footer
      wikidata = targetQid;

      const langParam = currentLanguage === 'local' ? 'en' : `${currentLanguage}|en`;
      const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${targetQid}&format=json&props=labels|descriptions|claims|sitelinks&languages=${langParam}&origin=*`;
      console.log(`[Click] Fetching Wikidata details for ${targetQid} from ${url}`);
      
      fetch(url)
        .then(response => response.json())
        .then(data => {
          if (data && data.entities && data.entities[targetQid]) {
            const entity = data.entities[targetQid];
            console.log('[Click] Wikidata entity response:', entity);
            
            // Translate the display name using Wikidata labels if not already translated
            if (currentLanguage !== 'local' && entity.labels) {
              if (entity.labels[currentLanguage]) {
                name = entity.labels[currentLanguage].value;
              } else if (entity.labels.en) {
                name = entity.labels.en.value;
              }
            }
            
            // Extract description if missing
            if (!description && entity.descriptions) {
              if (entity.descriptions[currentLanguage]) {
                description = entity.descriptions[currentLanguage].value;
              } else if (entity.descriptions.en) {
                description = entity.descriptions.en.value;
              }
            }
            
            // Extract population claim (P1082) if missing
            if (!population && entity.claims && entity.claims.P1082) {
              const pClaim = entity.claims.P1082[0];
              if (pClaim && pClaim.mainsnak && pClaim.mainsnak.datavalue) {
                const amountStr = pClaim.mainsnak.datavalue.value.amount;
                population = parseInt(amountStr.replace('+', ''));
              }
            }
            
            // Extract wikipedia link (sitelinks enwiki) if missing
            if (!wikipedia && entity.sitelinks && entity.sitelinks.enwiki) {
              wikipedia = `en:${entity.sitelinks.enwiki.title}`;
            }
            
            // Re-render popup content dynamically if still open
            if (popup.isOpen()) {
              popup.setHTML(makePopupHTML(name, eraRange, description, population, wikidata, wikipedia));
            }

            // Fallback: If Wikidata did not return a description, query Wikipedia summary
            if (!description && wikipedia) {
              fetchWikipediaSummary(wikipedia);
            }
          }
        })
        .catch(err => console.warn('Failed to fetch Wikidata details:', err));
    }

    // Main fetch orchestrator
    if (qid) {
      fetchEntityDetails(qid);
    } else {
      // If we don't have a Wikidata ID in the feature properties, search for it using the name
      const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&origin=*`;
      console.log(`[Click] No Wikidata ID in feature properties. Searching for: "${name}"`);
      fetch(searchUrl)
        .then(response => response.json())
        .then(searchData => {
          if (searchData && searchData.search && searchData.search.length > 0) {
            const foundQid = searchData.search[0].id;
            console.log(`[Click] Found QID: ${foundQid} for "${name}"`);
            fetchEntityDetails(foundQid);
          } else if (wikipedia) {
            // If search returned nothing but we had a wikipedia tag, try fetching Wikipedia summary
            fetchWikipediaSummary(wikipedia);
          }
        })
        .catch(err => {
          console.warn('Wikidata search failed:', err);
          if (wikipedia) {
            fetchWikipediaSummary(wikipedia);
          }
        });
    }
  } else {
    console.log('[Click] No valid historical features found under cursor.');
  }
});


// Hide popups when Escape is pressed
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const popups = document.querySelectorAll('.maplibregl-popup');
    popups.forEach(p => p.remove());
  }
});

// ---- UI Bindings ----

const slider = document.getElementById('timeline-slider');
const yearInput = document.getElementById('timeline-year-input');
const eraToggleBtn = document.getElementById('era-toggle-btn');

function updateYearUIOnly(year) {
  currentYear = parseInt(year);
  slider.value = currentYear;
  yearInput.value = Math.abs(currentYear);
  eraToggleBtn.textContent = currentYear < 0 ? 'BC' : 'AD';
  saveSettings();
}

function updateYearUI(year, immediate = false) {
  currentYear = parseInt(year);
  slider.value = currentYear;
  yearInput.value = Math.abs(currentYear);
  eraToggleBtn.textContent = currentYear < 0 ? 'BC' : 'AD';
  
  if (immediate) {
    if (filterTimeout) clearTimeout(filterTimeout);
    applyDateFilter();
  } else {
    debouncedApplyDateFilter();
  }
  
  saveSettings();
}

// Toggle BC/AD button click
eraToggleBtn.addEventListener('click', () => {
  const newYear = -currentYear;
  updateYearUI(newYear, true);
});

// Only update the input numbers while dragging, do not filter map
slider.addEventListener('input', (e) => {
  updateYearUIOnly(e.target.value);
});

// Filter the map when the drag click is actually released
slider.addEventListener('change', (e) => {
  updateYearUI(e.target.value, true);
});

// Scroll on the range bar or timeline container to shift years
document.querySelector('.timeline-slider-wrapper').addEventListener('wheel', (e) => {
  e.preventDefault();
  let step = e.deltaY < 0 ? 10 : -10; // Scroll up increases year, down decreases
  if (e.shiftKey) step = e.deltaY < 0 ? 1 : -1; // shift key for fine-tuning
  let newVal = currentYear + step;
  newVal = Math.max(-2000, Math.min(2026, newVal));
  updateYearUI(newVal, true);
}, { passive: false });

yearInput.addEventListener('change', (e) => {
  let val = Math.abs(parseInt(e.target.value));
  if (isNaN(val)) val = 1800;
  
  // Apply sign based on current toggle state
  const isBC = eraToggleBtn.textContent === 'BC';
  const signedVal = isBC ? -val : val;
  const clampedVal = Math.max(-2000, Math.min(2026, signedVal));
  updateYearUI(clampedVal, true);
});

// Click timeline ticks to jump to years
document.querySelectorAll('.timeline-ticks span').forEach(tick => {
  tick.addEventListener('click', () => {
    const year = parseInt(tick.getAttribute('data-year'));
    updateYearUI(year, true);
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

// Language Selector
const languageSelect = document.getElementById('language-select');
languageSelect.value = currentLanguage;
languageSelect.addEventListener('change', (e) => {
  currentLanguage = e.target.value;
  updateMapLanguage();
  saveSettings();
});

// Initialize UI state
updateYearUI(currentYear);
