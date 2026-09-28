// BORDER HISTORY VIEWER — app.js

// ---- Global State ----
let currentYear = 1800;
let currentMonth = 1; // 1-12 (Jan-Dec)
let currentDay = 1; // 1-31
let currentStyle = 'historical'; // 'historical' | 'woodblock' | 'japanese_scroll'
let currentProjection = 'mercator'; // 'mercator' | 'globe'
let currentTheme = 'dark'; // 'dark' | 'light'
let currentLanguage = 'local'; // 'local' | 'en' | 'es' | 'fr' | 'ar'
const boundaryCache = new Map(); // relationId/wayId -> geojson boundary data cache
let currentFlagImageId = null; // Currently registered flag image pattern ID on the map
let activePolygonCoords = null; // List of active polygon rings for drawing the flag background overlay
let activeFlagImage = null; // HTMLImageElement of the active flag image to be drawn

const STYLE_URLS = {
  historical: 'https://unpkg.com/@openhistoricalmap/map-styles@latest/dist/historical/historical.json',
  woodblock: 'https://unpkg.com/@openhistoricalmap/map-styles@latest/dist/woodblock/woodblock.json',
  japanese_scroll: 'https://unpkg.com/@openhistoricalmap/map-styles@latest/dist/japanese_scroll/japanese_scroll.json'
};

// ---- Settings Persistence ----
function saveSettings() {
  const settings = {
    year: currentYear,
    month: currentMonth,
    day: currentDay,
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
      if (s.month !== undefined) currentMonth = parseInt(s.month);
      if (s.day !== undefined) currentDay = parseInt(s.day);
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

// ---- Helper to format current year/month/day to YYYY-MM-DD for OHM plugin ----
function getFormattedDateString() {
  const absYear = Math.abs(currentYear);
  const paddedYear = String(absYear).padStart(4, '0');
  const signedYear = currentYear < 0 ? `-${paddedYear}` : paddedYear;
  const paddedMonth = String(currentMonth).padStart(2, '0');
  const paddedDay = String(currentDay).padStart(2, '0');
  return `${signedYear}-${paddedMonth}-${paddedDay}`;
}

// ---- Initialize MapLibre GL ----
const map = new maplibregl.Map({
  container: 'map',
  style: STYLE_URLS[currentStyle],
  center: [12.4964, 41.9028], // Center on Rome, Italy
  zoom: 3.5,
  maxZoom: 16,
  antialias: true,
  projection: currentProjection,
  renderWorldCopies: false
});

// Reset tilt and rotation on double right-click
let lastRightClickTime = 0;
map.getCanvas().addEventListener('contextmenu', (e) => {
  const now = Date.now();
  if (now - lastRightClickTime < 300) {
    e.preventDefault(); // Stop default browser context menu from displaying
    map.easeTo({
      bearing: 0,
      pitch: 0,
      duration: 800
    });
  }
  lastRightClickTime = now;
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

  let monthStr = '';
  if (parts.length > 1) {
    const monthInt = parseInt(parts[1]);
    if (!isNaN(monthInt) && monthInt >= 1 && monthInt <= 12) {
      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      monthStr = MONTHS[monthInt - 1] + ' ';
    }
  }

  return isBC ? `${monthStr}${yearInt} BC` : `${monthStr}${yearInt} AD`;
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
    const dateStr = getFormattedDateString();
    map.filterByDate(dateStr);
    
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthName = MONTHS[currentMonth - 1];
    let eraText = currentYear < 0 ? `${monthName} ${Math.abs(currentYear)} BC` : `${monthName} ${currentYear} AD`;
    if (statusEl) statusEl.textContent = `Showing Date: ${eraText}`;
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

function addHighlightLayers() {
  if (!map || !isStyleLoaded) return;

  // Initialize highlight vector layers if they don't exist
  if (!map.getSource('clicked-highlight-source')) {
    try {
      map.addSource('clicked-highlight-source', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.addLayer({
        id: 'clicked-highlight-fill',
        type: 'fill',
        source: 'clicked-highlight-source',
        paint: {
          'fill-color': '#000000',
          'fill-opacity': 0.1
        },
        filter: ['==', '$type', 'Polygon']
      });

      map.addLayer({
        id: 'clicked-highlight-line',
        type: 'line',
        source: 'clicked-highlight-source',
        paint: {
          'line-color': '#000000',
          'line-width': 3,
          'line-opacity': 0.9
        },
        filter: ['in', '$type', 'LineString', 'Polygon']
      });

      map.addLayer({
        id: 'clicked-highlight-circle',
        type: 'circle',
        source: 'clicked-highlight-source',
        paint: {
          'circle-color': '#000000',
          'circle-radius': 12,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#000000',
          'circle-opacity': 0.1,
          'circle-stroke-opacity': 0.85
        },
        filter: ['==', '$type', 'Point']
      });
    } catch (err) {
      console.warn('Failed to add highlight vector layers:', err);
    }
  }

  // Initialize flag raster layers if they don't exist
  if (!map.getSource('flag-image-source')) {
    try {
      map.addSource('flag-image-source', {
        type: 'image',
        url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', // 1x1 transparent gif
        coordinates: [
          [-1, 1],
          [1, 1],
          [1, -1],
          [-1, -1]
        ]
      });

      map.addLayer({
        id: 'clicked-flag-layer',
        type: 'raster',
        source: 'flag-image-source',
        paint: {
          'raster-opacity': 0.45
        }
      }, 'clicked-highlight-line');
    } catch (err) {
      console.warn('Failed to add flag layers:', err);
    }
  }
}

// Map lifecycle events
map.on('style.load', () => {
  isStyleLoaded = true;
  fixStyleSortKeys();
  addHighlightLayers();
  updateProjection();
  applyDateFilter();
  updateMapLanguage();
  fetchSignificantEvents();
});

map.on('styledata', () => {
  isStyleLoaded = true;
  fixStyleSortKeys(); // Run dynamically to patch newly-loaded/modified style rules
  addHighlightLayers();
  applyDateFilter();
  // Removed updateMapLanguage() from here to avoid recursive style update loops
});

// Render the flag inside the polygon boundaries using MapLibre Image source (rendered natively in WebGL)
function drawFlagOverlay() {
  // Find the permanent flag image source
  const source = map ? map.getSource('flag-image-source') : null;
  if (!source) return;

  if (!activePolygonCoords || !activeFlagImage) {
    // Hide the flag layer by resetting to a transparent 1x1 image at Null Island
    source.updateImage({
      url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
      coordinates: [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1]
      ]
    });
    return;
  }

  // 1. Calculate geographical bounding box (west, east, south, north) of the country
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  activePolygonCoords.forEach(polygon => {
    polygon.forEach(ring => {
      ring.forEach(pt => {
        const lon = pt[0];
        const lat = pt[1];
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      });
    });
  });

  if (west === Infinity || east <= west || north <= south) return;

  // 2. Define Web Mercator projection helper
  // Web Mercator Y formula: ln(tan(pi/4 + lat_rad/2))
  function latToMercatorY(lat) {
    const latClamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
    const rad = latClamped * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }

  const mercatorNorth = latToMercatorY(north);
  const mercatorSouth = latToMercatorY(south);
  const mercatorRange = mercatorNorth - mercatorSouth;
  const boxW = east - west;

  // Compute the geographic bounding box's aspect ratio in Web Mercator
  // Lon width in radians = boxW * (PI / 180). Mercator Y range is already in radians.
  const geoMercatorWidthRad = (boxW * Math.PI) / 180;
  const geoMercatorAspect = geoMercatorWidthRad / (mercatorRange || 1);

  // High-resolution canvas matching the geographic bbox aspect ratio (not the flag's)
  const canvasW = 2048;
  const canvasH = Math.max(100, Math.round(canvasW / (geoMercatorAspect || 1)));

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Clear previous drawing
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 3. Define mapping from geographical coords [lon, lat] to canvas pixels (x, y)
  function getCanvasCoords(pt) {
    const x = ((pt[0] - west) / boxW) * canvas.width;
    const ptMercY = latToMercatorY(pt[1]);
    const y = (1.0 - (ptMercY - mercatorSouth) / (mercatorRange || 1)) * canvas.height;
    return { x, y };
  }

  // 4. Begin clipping path of all rings in canvas coordinate space
  ctx.beginPath();
  let hasValidCoords = false;
  activePolygonCoords.forEach(polygon => {
    polygon.forEach(ring => {
      if (ring.length === 0) return;
      const startPt = getCanvasCoords(ring[0]);
      ctx.moveTo(startPt.x, startPt.y);
      for (let i = 1; i < ring.length; i++) {
        const pt = getCanvasCoords(ring[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      hasValidCoords = true;
    });
  });

  if (!hasValidCoords) return;

  ctx.clip();

  // 5. Draw the flag preserving its native aspect ratio (centered cover) without distortion
  const imgW = activeFlagImage.width || 1000;
  const imgH = activeFlagImage.height || 600;
  const flagAspect = imgW / imgH;
  const canvasAspect = canvas.width / canvas.height;

  let drawW, drawH, drawX, drawY;
  if (flagAspect > canvasAspect) {
    // Flag is wider: match height, crop/center width
    drawH = canvas.height;
    drawW = drawH * flagAspect;
    drawX = (canvas.width - drawW) / 2;
    drawY = 0;
  } else {
    // Flag is taller: match width, crop/center height
    drawW = canvas.width;
    drawH = drawW / flagAspect;
    drawX = 0;
    drawY = (canvas.height - drawH) / 2;
  }

  ctx.drawImage(activeFlagImage, drawX, drawY, drawW, drawH);

  // 6. Update the image source dynamically with the data URL and matching coordinates
  try {
    const dataUrl = canvas.toDataURL('image/png');
    source.updateImage({
      url: dataUrl,
      coordinates: [
        [west, north], // Top-Left
        [east, north], // Top-Right
        [east, south], // Bottom-Right
        [west, south]  // Bottom-Left
      ]
    });
  } catch (err) {
    console.warn('Failed to update flag image source:', err);
  }
}



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

// Helper to fetch the direct upload.wikimedia.org URL for a flag file to bypass CORS redirect blocks
function fetchFlagDirectUrl(flagFilename, callback) {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(flagFilename)}&prop=imageinfo&iiprop=url|thumbnail&iiurlwidth=2000&format=json&origin=*`;
  fetch(url)
    .then(r => r.json())
    .then(data => {
      if (data && data.query && data.query.pages) {
        const pages = data.query.pages;
        for (const k in pages) {
          if (pages[k].imageinfo && pages[k].imageinfo[0]) {
            // Use the pre-rendered PNG thumbnail URL if available (bypasses SVG decoding issues), otherwise fallback to standard URL
            const directUrl = pages[k].imageinfo[0].thumburl || pages[k].imageinfo[0].url;
            callback(directUrl);
            return;
          }
        }
      }
      callback(null);
    })
    .catch(err => {
      console.warn('Failed to fetch direct flag URL:', err);
      callback(null);
    });
}

/// Stitch way coordinates from Overpass into closed polygon rings (O(N) optimized using index maps)
function stitchWaysToPolygons(ways) {
  if (ways.length === 0) return [];
  
  const endpointMap = new Map();
  
  function getPointKey(pt) {
    return `${pt[0].toFixed(6)},${pt[1].toFixed(6)}`;
  }
  
  function addEndpoint(key, wayRef) {
    if (!endpointMap.has(key)) {
      endpointMap.set(key, []);
    }
    endpointMap.get(key).push(wayRef);
  }
  
  const activeWays = ways.map(w => ({ coords: w.slice(), used: false }));
  
  activeWays.forEach(way => {
    const startKey = getPointKey(way.coords[0]);
    const endKey = getPointKey(way.coords[way.coords.length - 1]);
    addEndpoint(startKey, way);
    addEndpoint(endKey, way);
  });
  
  const rings = [];
  
  for (const way of activeWays) {
    if (way.used) continue;
    
    let currentRing = way.coords.slice();
    way.used = true;
    let growing = true;
    
    while (growing) {
      growing = false;
      
      const endPt = currentRing[currentRing.length - 1];
      const endKey = getPointKey(endPt);
      const candidates = endpointMap.get(endKey) || [];
      
      for (const candidate of candidates) {
        if (candidate.used) continue;
        
        const cStart = candidate.coords[0];
        const cEnd = candidate.coords[candidate.coords.length - 1];
        const cStartKey = getPointKey(cStart);
        const cEndKey = getPointKey(cEnd);
        
        if (endKey === cStartKey) {
          currentRing = currentRing.concat(candidate.coords.slice(1));
          candidate.used = true;
          growing = true;
          break;
        } else if (endKey === cEndKey) {
          currentRing = currentRing.concat(candidate.coords.slice().reverse().slice(1));
          candidate.used = true;
          growing = true;
          break;
        }
      }
      
      if (!growing) {
        const startPt = currentRing[0];
        const startKey = getPointKey(startPt);
        const startCandidates = endpointMap.get(startKey) || [];
        
        for (const candidate of startCandidates) {
          if (candidate.used) continue;
          
          const cStart = candidate.coords[0];
          const cEnd = candidate.coords[candidate.coords.length - 1];
          const cStartKey = getPointKey(cStart);
          const cEndKey = getPointKey(cEnd);
          
          if (startKey === cEndKey) {
            currentRing = candidate.coords.concat(currentRing.slice(1));
            candidate.used = true;
            growing = true;
            break;
          } else if (startKey === cStartKey) {
            currentRing = candidate.coords.slice().reverse().concat(currentRing.slice(1));
            candidate.used = true;
            growing = true;
            break;
          }
        }
      }
    }
    rings.push(currentRing);
  }
  
  return rings;
}

// Ramer-Douglas-Peucker coordinate simplification algorithm to reduce vertex count for smooth canvas rendering
function simplifyCoordinates(points, tolerance) {
  if (points.length <= 2) return points;
  
  const sqTolerance = tolerance * tolerance;
  
  function getSqSegDist(p, p1, p2) {
    let x = p1[0], y = p1[1];
    let dx = p2[0] - x, dy = p2[1] - y;
    
    if (dx !== 0 || dy !== 0) {
      let t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) {
        x = p2[0];
        y = p2[1];
      } else if (t > 0) {
        x += dx * t;
        y += dy * t;
      }
    }
    
    return (p[0] - x) ** 2 + (p[1] - y) ** 2;
  }
  
  function simplifyDPStep(points, first, last, sqTolerance, simplified) {
    let maxSqDist = sqTolerance;
    let index = -1;
    
    for (let i = first + 1; i < last; i++) {
      let sqDist = getSqSegDist(points[i], points[first], points[last]);
      if (sqDist > maxSqDist) {
        index = i;
        maxSqDist = sqDist;
      }
    }
    
    if (maxSqDist > sqTolerance) {
      if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
      simplified.push(points[index]);
      if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
  }
  
  const simplified = [points[0]];
  simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
  simplified.push(points[points.length - 1]);
  return simplified;
}

// Helper to extract polygon coordinates from a GeoJSON FeatureCollection
function extractPolygonCoords(geojson) {
  const coordsList = [];
  if (geojson && geojson.features) {
    geojson.features.forEach(f => {
      if (!f.geometry) return;
      
      if (f.geometry.type === 'Polygon') {
        const simplifiedRings = f.geometry.coordinates.map(ring => {
          return simplifyCoordinates(ring, 0.005);
        });
        coordsList.push(simplifiedRings);
      } else if (f.geometry.type === 'MultiPolygon') {
        f.geometry.coordinates.forEach(polygonCoords => {
          const simplifiedRings = polygonCoords.map(ring => {
            return simplifyCoordinates(ring, 0.005);
          });
          coordsList.push(simplifiedRings);
        });
      }
    });
  }
  return coordsList;
}

// Helper to convert Overpass JSON structure to a clean GeoJSON FeatureCollection
function parseOverpassToGeoJSON(data) {
  const features = [];
  if (!data || !data.elements) return { type: 'FeatureCollection', features };
  
  const ways = [];
  
  data.elements.forEach(element => {
    if (element.type === 'relation' && element.members) {
      element.members.forEach(member => {
        if (member.type === 'way' && member.geometry) {
          const coords = member.geometry.map(pt => [pt.lon, pt.lat]);
          ways.push(coords);
          
          features.push({
            type: 'Feature',
            geometry: {
              type: 'LineString',
              coordinates: coords
            },
            properties: { role: member.role }
          });
        }
      });
    } else if (element.type === 'way' && element.geometry) {
      const coords = element.geometry.map(pt => [pt.lon, pt.lat]);
      ways.push(coords);
      
      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords
        },
        properties: {}
      });
    }
  });

  // Reconstruct closed polygons from constituent ways for the flag fill pattern
  if (ways.length > 0) {
    try {
      const stitchedRings = stitchWaysToPolygons(ways);
      stitchedRings.forEach(ring => {
        if (ring.length >= 4) {
          const start = ring[0];
          const end = ring[ring.length - 1];
          const dx = start[0] - end[0];
          const dy = start[1] - end[1];
          const distSq = dx * dx + dy * dy;
          
          // Only create polygon if the endpoints actually meet (tolerance ~1km / 0.01 deg)
          // Otherwise, an open coastline or linear border would draw a straight line across open ocean/country!
          if (distSq < 0.0001) {
            if (start[0] !== end[0] || start[1] !== end[1]) {
              ring.push([start[0], start[1]]);
            }
            features.push({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [ring]
              },
              properties: { role: 'boundary_fill' }
            });
          }
        }
      });
    } catch (e) {
      console.warn('Failed to stitch ways to polygon:', e);
    }
  }
  
  console.log(`[Click] parseOverpassToGeoJSON: generated ${features.filter(f => f.geometry.type === 'LineString').length} LineStrings and ${features.filter(f => f.geometry.type === 'Polygon').length} Polygons.`);
  return { type: 'FeatureCollection', features };
}

// Flag to prevent map click popup from opening when clicking on an event marker
let isEventMarkerClick = false;

// ---- Popup on click to inspect boundaries ----
map.on('click', (e) => {
  if (isEventMarkerClick) {
    isEventMarkerClick = false;
    return;
  }
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

    // Query the visible viewport to find all matching boundary shapes/segments (using loose string comparisons)
    let highlightFeatures = [historicalFeature];
    try {
      const allVisibleFeatures = map.queryRenderedFeatures() || [];
      
      // Log some visible features to see what fields they contain
      console.log('[Click] Sample non-point visible features in viewport:', 
        allVisibleFeatures
          .filter(f => f.geometry && f.geometry.type !== 'Point')
          .slice(0, 10)
          .map(f => ({
            layerId: f.layer.id,
            sourceLayer: f.layer['source-layer'],
            geometryType: f.geometry.type,
            properties: f.properties
          }))
      );

      const boundaryMatches = allVisibleFeatures.filter(f => 
        f.geometry && 
        f.geometry.type !== 'Point' && 
        f.properties && 
        ((props.wikidata && f.properties.wikidata && String(f.properties.wikidata).trim().toLowerCase() === String(props.wikidata).trim().toLowerCase()) || 
         (props.osm_id && f.properties.osm_id && (
           String(f.properties.osm_id) === String(props.osm_id) || 
           Math.abs(parseInt(f.properties.osm_id)) === Math.abs(parseInt(props.osm_id))
         )) ||
         (props.name && f.properties.name && String(f.properties.name).toLowerCase() === String(props.name).toLowerCase()) ||
         (props['name:en'] && f.properties.name && String(f.properties.name).toLowerCase() === String(props['name:en']).toLowerCase()) ||
         (props['name_en'] && f.properties.name && String(f.properties.name).toLowerCase() === String(props['name_en']).toLowerCase()))
      );
      if (boundaryMatches.length > 0) {
        highlightFeatures = boundaryMatches;
        console.log(`[Click] Highlighted ${boundaryMatches.length} matching boundary shapes/segments in the viewport.`);
      } else {
        console.log('[Click] No non-point boundary matches found in viewport, highlighting original feature.');
      }
    } catch (err) {
      console.warn('Failed to query all visible features for highlighting:', err);
    }

    // Convert all matching features to a clean GeoJSON FeatureCollection
    const geojsonFeatureCollection = {
      type: 'FeatureCollection',
      features: highlightFeatures.map(f => ({
        type: 'Feature',
        geometry: f.geometry,
        properties: f.properties
      }))
    };

    console.log('[Click] Setting highlight data:', geojsonFeatureCollection);

    // Set the highlight layer data
    const highlightSource = map.getSource('clicked-highlight-source');
    if (highlightSource) {
      highlightSource.setData(geojsonFeatureCollection);
    }

    // Set immediate active polygon coords from the vector tile features as a fallback
    activePolygonCoords = extractPolygonCoords(geojsonFeatureCollection);

    // Render immediate popup with whatever is in the vector tiles
    const popup = new maplibregl.Popup({ anchor: 'bottom' })
      .setLngLat(popupLngLat)
      .setHTML(makePopupHTML(name, eraRange, description, population, wikidata, wikipedia))
      .addTo(map);

    // Clear highlight and flag pattern when popup is dismissed
    popup.on('close', () => {
      const source = map.getSource('clicked-highlight-source');
      if (source) {
        source.setData({ type: 'FeatureCollection', features: [] });
      }
      activePolygonCoords = null;
      activeFlagImage = null;
      drawFlagOverlay(); // Clears the canvas overlay
      
      try {
        if (map.getLayer('clicked-highlight-fill')) {
          map.setPaintProperty('clicked-highlight-fill', 'fill-pattern', undefined);
          map.setPaintProperty('clicked-highlight-fill', 'fill-opacity', 0.1);
        }
        if (currentFlagImageId && map.hasImage(currentFlagImageId)) {
          map.removeImage(currentFlagImageId);
          currentFlagImageId = null;
        }
      } catch (err) {
        console.warn('Failed to clear flag pattern on close:', err);
      }
    });

    // Fetch full, exact boundary borders from the OpenHistoricalMap Overpass database asynchronously
    function triggerOverpassFetch(osmIdVal, wikidataQidVal) {
      const rawOsmId = parseInt(osmIdVal);
      const qid = wikidataQidVal ? String(wikidataQidVal).trim() : null;
      if ((isNaN(rawOsmId) || rawOsmId === 0) && !qid) return;

      // Cache key includes date context for QID since boundaries change over time!
      const cacheKey = qid 
        ? `qid_${qid}_${currentYear}_${currentMonth}` 
        : `osm_${rawOsmId < 0 ? 'rel' : 'way'}_${Math.abs(rawOsmId)}`;



      if (boundaryCache.has(cacheKey)) {
        console.log(`[Click] Cache hit for boundary geometry: ${cacheKey}`);
        const cachedGeojson = boundaryCache.get(cacheKey);
        if (popup.isOpen()) {
          const source = map.getSource('clicked-highlight-source');
          if (source) {
            source.setData(cachedGeojson);
          }
          activePolygonCoords = extractPolygonCoords(cachedGeojson);
          drawFlagOverlay();
        }
        return;
      }

      // If we have a Wikidata QID, use the ultra-fast two-stage date filtered query
      if (qid) {
        const metadataQuery = `[out:json];(rel[wikidata="${qid}"];rel(r););out tags;`;
        const metadataUrl = `https://overpass-api.openhistoricalmap.org/api/interpreter?data=${encodeURIComponent(metadataQuery)}`;
        
        console.log(`[Click] Fetching boundary metadata from Overpass for QID ${qid}`);
        fetch(metadataUrl)
          .then(res => res.ok ? res.json() : Promise.reject('Metadata API Error'))
          .then(metaData => {
            let activeId = null;
            if (metaData && metaData.elements && metaData.elements.length > 0) {
              const currentDateStr = getFormattedDateString();
              const currentDate = new Date(currentDateStr);
              
              // Filter to find the active relation, skipping chronology parent relations
              for (const element of metaData.elements) {
                if (element.type !== 'relation') continue;
                const tags = element.tags || {};
                if (tags.type === 'chronology') continue;
                
                let startDate = null;
                if (tags.start_date) {
                  let sStr = tags.start_date;
                  if (sStr.match(/^\d{4}$/)) sStr += "-01-01";
                  startDate = new Date(sStr);
                }
                
                let endDate = null;
                if (tags.end_date) {
                  let eStr = tags.end_date;
                  if (eStr.match(/^\d{4}$/)) eStr += "-12-31";
                  endDate = new Date(eStr);
                }
                
                const afterStart = !startDate || isNaN(startDate.getTime()) || currentDate >= startDate;
                const beforeEnd = !endDate || isNaN(endDate.getTime()) || currentDate <= endDate;
                
                if (afterStart && beforeEnd) {
                  activeId = element.id;
                  break;
                }
              }
              
              // Fallback to first relation if no match found
              if (!activeId) {
                activeId = metaData.elements[0].id;
              }
            }
            
            if (activeId) {
              const geomQuery = `[out:json];relation(${activeId});out geom;`;
              console.log(`[Click] Fetching date-filtered relation geometry for ID ${activeId} (${qid})`);
              executeGeomFetch(geomQuery, cacheKey);
            } else {
              const fallbackQuery = `[out:json];wr[wikidata="${qid}"];out geom;`;
              executeGeomFetch(fallbackQuery, cacheKey);
            }
          })
          .catch(err => {
            console.warn('Metadata fetch failed, falling back to bulk geometry query:', err);
            const fallbackQuery = `[out:json];wr[wikidata="${qid}"];out geom;`;
            executeGeomFetch(fallbackQuery, cacheKey);
          });
      } else if (!isNaN(rawOsmId) && rawOsmId !== 0) {
        const id = Math.abs(rawOsmId);
        const type = rawOsmId < 0 ? 'relation' : 'way';
        const geomQuery = `[out:json];${type}(${id});out geom;`;
        executeGeomFetch(geomQuery, cacheKey);
      }

      function executeGeomFetch(queryStr, cKey) {
        const url = `https://overpass-api.openhistoricalmap.org/api/interpreter?data=${encodeURIComponent(queryStr)}`;
        fetch(url)
          .then(response => response.ok ? response.json() : Promise.reject('Geometry API Error'))
          .then(data => {
            const geojson = parseOverpassToGeoJSON(data);
            if (geojson.features.length > 0) {
              console.log(`[Click] Loaded ${geojson.features.length} features from Overpass.`);
              boundaryCache.set(cKey, geojson);
              if (popup.isOpen()) {
                const source = map.getSource('clicked-highlight-source');
                if (source) {
                  source.setData(geojson);
                }
                activePolygonCoords = extractPolygonCoords(geojson);
                drawFlagOverlay();
              }
            }
          })
          .catch(err => console.warn('Geometry fetch failed:', err));
      }
    }

    // Trigger immediate Overpass query if osm_id or wikidata is on the vector tile feature
    triggerOverpassFetch(props.osm_id, qid);

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

    // Helper to find the active flag claim matching the selected date using Wikidata qualifiers P580/P582
    function findActiveFlagClaim(claims, currentDateStr) {
      if (!claims || !claims.P41) return null;
      
      const currentDate = new Date(currentDateStr);
      
      for (const claim of claims.P41) {
        if (!claim.mainsnak || !claim.mainsnak.datavalue) continue;
        
        let startTime = null;
        if (claim.qualifiers && claim.qualifiers.P580 && claim.qualifiers.P580[0]) {
          const q = claim.qualifiers.P580[0];
          if (q.datavalue && q.datavalue.value && q.datavalue.value.time) {
            let tStr = q.datavalue.value.time.replace(/^\+/, '');
            startTime = new Date(tStr);
          }
        }
        
        let endTime = null;
        if (claim.qualifiers && claim.qualifiers.P582 && claim.qualifiers.P582[0]) {
          const q = claim.qualifiers.P582[0];
          if (q.datavalue && q.datavalue.value && q.datavalue.value.time) {
            let tStr = q.datavalue.value.time.replace(/^\+/, '');
            endTime = new Date(tStr);
          }
        }
        
        const afterStart = !startTime || isNaN(startTime.getTime()) || currentDate >= startTime;
        const beforeEnd = !endTime || isNaN(endTime.getTime()) || currentDate <= endTime;
        
        if (afterStart && beforeEnd) {
          return claim;
        }
      }
      
      return claims.P41[0];
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

            // Extract and load Flag Image (P41) matching selected date context if available
            if (entity.claims && entity.claims.P41) {
              const activeFlagClaim = findActiveFlagClaim(entity.claims, getFormattedDateString());
              if (activeFlagClaim && activeFlagClaim.mainsnak && activeFlagClaim.mainsnak.datavalue) {
                const flagFilename = activeFlagClaim.mainsnak.datavalue.value;
                const imageId = `flag_${targetQid}`;
                
                // Fetch the direct upload URL first to bypass 301 CORS redirect failures
                fetchFlagDirectUrl(flagFilename, (directUrl) => {
                  if (!directUrl) {
                    console.warn('[Flag] Could not resolve direct Wikimedia upload URL for:', flagFilename);
                    return;
                  }
                  
                  console.log(`[Flag] Loading direct flag image for ${targetQid} from ${directUrl}`);
                  const img = new Image();
                  img.crossOrigin = 'Anonymous';
                  img.onload = () => {
                    console.log(`[Flag] Successfully loaded flag image for ${targetQid}`);
                    
                    if (popup.isOpen()) {
                      activeFlagImage = img;
                      drawFlagOverlay();
                    } else {
                      console.log('[Flag] Popup was closed before image loaded, skipping.');
                    }
                  };
                  img.onerror = (err) => {
                    console.warn('[Flag] Failed to load flag image from URL:', directUrl, err);
                  };
                  img.src = directUrl;
                });
              }
            }

            // Trigger boundary highlight query using Wikidata QID directly (since OpenHistoricalMap
            // uses separate relation IDs from standard OpenStreetMap's P402 claims).
            triggerOverpassFetch(null, targetQid);
            
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

    function performWikidataTextSearch() {
      const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&origin=*`;
      console.log(`[Click] No Wikidata ID on feature or database tags. Searching Wikidata for name: "${name}"`);
      fetch(searchUrl)
        .then(response => response.ok ? response.json() : Promise.reject('Search Error'))
        .then(searchData => {
          if (searchData && searchData.search && searchData.search.length > 0) {
            const foundQid = searchData.search[0].id;
            console.log(`[Click] Found QID: ${foundQid} for "${name}" via text search`);
            fetchEntityDetails(foundQid);
          } else if (wikipedia) {
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

    // Main fetch orchestrator: Prioritize tile QID -> database tags lookup via osm_id -> text search fallback
    const osmIdNum = parseInt(props.osm_id);
    if (qid) {
      fetchEntityDetails(qid);
    } else if (!isNaN(osmIdNum) && osmIdNum !== 0) {
      const typeStr = historicalFeature.geometry && historicalFeature.geometry.type === 'Point' 
        ? 'node' 
        : (osmIdNum < 0 ? 'relation' : 'way');
      const elementId = Math.abs(osmIdNum);
      const query = `[out:json];${typeStr}(${elementId});out tags;`;
      const url = `https://overpass-api.openhistoricalmap.org/api/interpreter?data=${encodeURIComponent(query)}`;
      
      console.log(`[Click] No Wikidata ID on feature properties. Querying database tags for ${typeStr}(${elementId})`);
      fetch(url)
        .then(res => res.ok ? res.json() : Promise.reject('Overpass tags error'))
        .then(data => {
          let dbQid = null;
          if (data && data.elements && data.elements.length > 0) {
            const tags = data.elements[0].tags || {};
            dbQid = extractWikidataQID(tags.wikidata);
            if (tags.wikipedia && !wikipedia) {
              wikipedia = tags.wikipedia;
            }
            if (tags.note || tags.description) {
              description = tags.note || tags.description;
            }
          }
          
          if (dbQid) {
            console.log(`[Click] Successfully resolved QID from database tags: ${dbQid}`);
            fetchEntityDetails(dbQid);
          } else {
            performWikidataTextSearch();
          }
        })
        .catch(err => {
          console.warn('Overpass tags query failed, falling back to text search:', err);
          performWikidataTextSearch();
        });
    } else {
      performWikidataTextSearch();
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

// Scroll on the range bar or timeline container to shift years by 1
document.querySelector('.timeline-slider-wrapper').addEventListener('wheel', (e) => {
  e.preventDefault();
  let step = e.deltaY < 0 ? 1 : -1; // Scroll up increases year by 1, down decreases by 1
  if (e.shiftKey) step = e.deltaY < 0 ? 5 : -5; // shift key for larger jumps
  let newVal = currentYear + step;
  newVal = Math.max(-2000, Math.min(2026, newVal));
  updateYearUI(newVal, true);
}, { passive: false });

// Scroll on the year input number directly to shift years by 1
yearInput.addEventListener('wheel', (e) => {
  e.preventDefault();
  e.stopPropagation();
  let step = e.deltaY < 0 ? 1 : -1;
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
  updateGlobeMarkerVisibility();
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

// Month Selector Binding
const monthSelect = document.getElementById('timeline-month-select');
monthSelect.value = currentMonth;
monthSelect.addEventListener('change', (e) => {
  currentMonth = parseInt(e.target.value);
  applyDateFilter();
  updateCalendarUI();
  saveSettings();
});

// ---- Expandable Calendar and Historical Events Controller ----
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const calToggleBtn = document.getElementById('calendar-toggle-btn');
const calBtnLabel = document.getElementById('calendar-btn-label');
const calPopup = document.getElementById('calendar-popup');
const calMonthSelect = document.getElementById('cal-month-select');
const calYearInput = document.getElementById('cal-year-input');
const calEraToggle = document.getElementById('cal-era-toggle');
const calPrevMonthBtn = document.getElementById('cal-prev-month');
const calNextMonthBtn = document.getElementById('cal-next-month');
const calDaysGrid = document.getElementById('calendar-days-grid');
const calEventsList = document.getElementById('calendar-events-list');
const calEventsTitle = document.getElementById('calendar-events-title');
const calEventsCount = document.getElementById('calendar-events-count');

// Populate Month dropdown in calendar
MONTH_SHORT.forEach((m, idx) => {
  const opt = document.createElement('option');
  opt.value = idx + 1;
  opt.textContent = m;
  calMonthSelect.appendChild(opt);
});

// Toggle calendar popup
calToggleBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = calPopup.classList.toggle('show');
  if (isOpen) {
    updateCalendarUI();
    fetchSignificantEvents();
  }
});

calPopup.addEventListener('click', (e) => {
  e.stopPropagation();
});

document.addEventListener('click', () => {
  calPopup.classList.remove('show');
});

// Prev / Next month buttons
calPrevMonthBtn.addEventListener('click', () => {
  if (currentMonth === 1) {
    currentMonth = 12;
    currentYear -= 1;
  } else {
    currentMonth -= 1;
  }
  syncDateChange();
});

calNextMonthBtn.addEventListener('click', () => {
  if (currentMonth === 12) {
    currentMonth = 1;
    currentYear += 1;
  } else {
    currentMonth += 1;
  }
  syncDateChange();
});

calMonthSelect.addEventListener('change', (e) => {
  currentMonth = parseInt(e.target.value);
  syncDateChange();
});

calYearInput.addEventListener('change', (e) => {
  let val = Math.abs(parseInt(e.target.value));
  if (isNaN(val)) val = 1800;
  const isBC = calEraToggle.textContent === 'BC';
  currentYear = isBC ? -val : val;
  syncDateChange();
});

calEraToggle.addEventListener('click', () => {
  currentYear = -currentYear;
  syncDateChange();
});

function syncDateChange() {
  updateYearUI(currentYear, true);
  monthSelect.value = currentMonth;
  updateCalendarUI();
  fetchSignificantEvents();
}

function getDaysInMonth(year, month) {
  // Month is 1-12
  return new Date(Math.abs(year), month, 0).getDate();
}

function updateCalendarUI() {
  const eraStr = currentYear < 0 ? `${Math.abs(currentYear)} BC` : `${currentYear} AD`;
  const monthName = MONTH_SHORT[currentMonth - 1];
  calBtnLabel.textContent = `${monthName} ${currentDay}, ${eraStr}`;

  calMonthSelect.value = currentMonth;
  calYearInput.value = Math.abs(currentYear);
  calEraToggle.textContent = currentYear < 0 ? 'BC' : 'AD';

  renderDaysGrid();
}

function renderDaysGrid() {
  calDaysGrid.innerHTML = '';
  const totalDays = getDaysInMonth(currentYear, currentMonth);
  // Get starting weekday for the 1st day of month
  const testYear = currentYear > 0 ? currentYear : 2000 + (currentYear % 400); // Proxy for weekday in leap cycles
  const firstDayWeekday = new Date(testYear, currentMonth - 1, 1).getDay();

  // Blank filler cells before start of month
  for (let i = 0; i < firstDayWeekday; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day-cell other-month';
    calDaysGrid.appendChild(emptyCell);
  }

  // Days of month
  for (let d = 1; d <= totalDays; d++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'cal-day-cell';
    dayCell.textContent = d;
    if (d === currentDay) {
      dayCell.classList.add('selected');
    }

    dayCell.addEventListener('click', () => {
      currentDay = d;
      renderDaysGrid();
      const eraStr = currentYear < 0 ? `${Math.abs(currentYear)} BC` : `${currentYear} AD`;
      calBtnLabel.textContent = `${MONTH_SHORT[currentMonth - 1]} ${currentDay}, ${eraStr}`;
      applyDateFilter();
      fetchSignificantEvents();
      saveSettings();
    });

    calDaysGrid.appendChild(dayCell);
  }
}

// ---- Historical Significant Events System (Filtered strictly to current Year) ----
let eventMarkers = [];
let yearEventsCache = new Map(); // year -> parsed events array
let coordsCache = new Map(); // title -> [lon, lat]

function clearEventMarkers() {
  eventMarkers.forEach(m => {
    if (m.marker) {
      m.marker.remove();
    } else if (m.remove) {
      m.remove();
    }
  });
  eventMarkers = [];
}

// Category Colors for Historical Events
const CATEGORY_COLORS = {
  battle: '#ef4444',       // Crimson Red - Battle / Military
  treaty: '#f59e0b',       // Amber / Gold - Treaty / Pact
  geopolitical: '#a855f7', // Purple - Territorial / Geopolitical
  politics: '#3b82f6',     // Blue - Politics / Revolution / State
  disaster: '#ec4899',     // Pink - Disaster / Nature
  exploration: '#10b981',  // Emerald Green - Expedition / Foundation
  general: '#f97316'       // Orange - General Events
};

// Clean, high-contrast SVG icons for historical event categories
const CATEGORY_SVGS = {
  battle: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 17.5L3 6V3h3l11.5 11.5"/><path d="M13 19l6-6"/><path d="M16 16l4 4"/><path d="M19 21l2-2"/><path d="M9.5 17.5L21 6V3h-3L6.5 14.5"/><path d="M11 19l-6-6"/><path d="M8 16l-4 4"/><path d="M5 21l-2-2"/></svg>`,
  treaty: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h10l6 6v8a2 2 0 0 1-2 2z"/><polyline points="14 4 14 10 20 10"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>`,
  geopolitical: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="20" y2="21"/><line x1="4" y1="3" x2="20" y2="3"/><path d="M6 3v18M10 3v18M14 3v18M18 3v18"/></svg>`,
  politics: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>`,
  disaster: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>`,
  exploration: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
  general: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
};

function getEventCategory(text) {
  const lower = text.toLowerCase();
  if (/\b(battle|siege|invasion|war|bombing|offensive|attack|combat|skirmish|defeat|army|forces|troops|military|navy|fleet|front)\b/.test(lower)) {
    return { type: 'battle', label: 'Battle / Conflict', color: CATEGORY_COLORS.battle, svg: CATEGORY_SVGS.battle };
  }
  if (/\b(treaty|accord|armistice|pact|protocol|declaration|signed|convention|peace|alliance)\b/.test(lower)) {
    return { type: 'treaty', label: 'Treaty / Pact', color: CATEGORY_COLORS.treaty, svg: CATEGORY_SVGS.treaty };
  }
  if (/\b(annex|independence|partition|ceded|border|republic|empire|monarchy|coronation|proclaimed|abdicated|dissolved|ceded|territory|sovereignty)\b/.test(lower)) {
    return { type: 'geopolitical', label: 'Geopolitical / State', color: CATEGORY_COLORS.geopolitical, svg: CATEGORY_SVGS.geopolitical };
  }
  if (/\b(president|prime minister|elected|election|parliament|congress|coup|revolution|revolt|rebellion|overthrow|assassinated|assassination)\b/.test(lower)) {
    return { type: 'politics', label: 'Political Event', color: CATEGORY_COLORS.politics, svg: CATEGORY_SVGS.politics };
  }
  if (/\b(earthquake|eruption|tsunami|volcano|hurricane|flood|fire|plague|epidemic|famine)\b/.test(lower)) {
    return { type: 'disaster', label: 'Disaster / Natural', color: CATEGORY_COLORS.disaster, svg: CATEGORY_SVGS.disaster };
  }
  if (/\b(expedition|discovered|voyage|founded|established|charter|built|opened)\b/.test(lower)) {
    return { type: 'exploration', label: 'Expedition / Foundation', color: CATEGORY_COLORS.exploration, svg: CATEGORY_SVGS.exploration };
  }
  return { type: 'general', label: 'Historical Event', color: CATEGORY_COLORS.general, svg: CATEGORY_SVGS.general };
}

// Fetch events from Wikipedia's dedicated article for the currently selected year
async function fetchSignificantEvents() {
  const targetYear = currentYear;
  const targetMonth = currentMonth;
  const eraStr = targetYear < 0 ? `${Math.abs(targetYear)} BC` : `${targetYear} AD`;

  calEventsTitle.textContent = `Events in ${eraStr}`;
  calEventsList.innerHTML = `<div class="cal-event-empty">Loading ${eraStr} events...</div>`;
  calEventsCount.textContent = '...';

  try {
    let yearEvents = yearEventsCache.get(targetYear);
    if (!yearEvents) {
      const pageTitle = targetYear > 0 ? `${targetYear}` : `${Math.abs(targetYear)}_BC`;
      const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(pageTitle)}&prop=wikitext&format=json&origin=*`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      if (!data.parse || !data.parse.wikitext) {
        yearEvents = [];
      } else {
        yearEvents = parseWikitextYearEvents(data.parse.wikitext['*'], targetYear);
      }
      yearEventsCache.set(targetYear, yearEvents);
    }

    // Always display all events for the year on the map
    displayYearEvents(yearEvents, targetYear, targetMonth);
  } catch (err) {
    console.warn('Failed to load year events:', err);
    calEventsList.innerHTML = `<div class="cal-event-empty">No events recorded for ${eraStr}</div>`;
    calEventsCount.textContent = '0';
    clearEventMarkers();
  }
}

// Parse wikitext from Wikipedia Year article (e.g., 1939, 1805, 1066)
function parseWikitextYearEvents(wikitext, year) {
  const events = [];
  const eventsMatch = wikitext.match(/==\s*Events\s*==([\s\S]*?)(?:==\s*Births\s*==|==\s*Deaths\s*==|==\s*Nobel|==\s*References|$)/i);
  const textSection = eventsMatch ? eventsMatch[1] : wikitext;

  const lines = textSection.split('\n');
  let currentMonthIdx = 0;

  for (let rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Detect month header: e.g., === September === or === January–February ===
    const mHead = line.match(/^===+\s*([A-Za-z]+)/);
    if (mHead) {
      const foundIdx = MONTH_NAMES.findIndex(m => m.toLowerCase().startsWith(mHead[1].toLowerCase().slice(0, 3)));
      if (foundIdx !== -1) {
        currentMonthIdx = foundIdx + 1;
      }
      continue;
    }

    if (line.startsWith('*')) {
      // Check if bullet starts with a month or date (e.g., * September 1 – ...)
      for (let i = 0; i < MONTH_NAMES.length; i++) {
        const mRegex = new RegExp(`^\\*\\s*\\[?\\[?${MONTH_NAMES[i]}`, 'i');
        if (mRegex.test(line)) {
          currentMonthIdx = i + 1;
          break;
        }
      }

      // Extract wiki links before stripping syntax
      const linkMatches = [...line.matchAll(/\[\[(?:([^|\]]+)\|)?([^\]]+)\]\]/g)];
      const pageLinks = linkMatches
        .map(m => m[1] || m[2])
        .filter(t => !t.startsWith('File:') && !t.startsWith('Category:') && !MONTH_NAMES.some(m => t.startsWith(m)));

      // Clean wikitext formatting
      let cleaned = line.replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1');
      cleaned = cleaned.replace(/<ref[^>]*>.*?<\/ref>/gi, '');
      cleaned = cleaned.replace(/<ref[^>]*\/>/gi, '');
      cleaned = cleaned.replace(/\{\{[^}]*\}\}/g, '');
      cleaned = cleaned.replace(/''+/g, '');
      cleaned = cleaned.replace(/^\*+\s*/, '').trim();

      if (cleaned.length > 20 && !cleaned.toLowerCase().includes('in progress') && !cleaned.toLowerCase().includes('unclear')) {
        const cat = getEventCategory(cleaned);
        events.push({
          text: cleaned,
          monthIdx: currentMonthIdx || 1, // Fallback to month 1 if unspecified
          year: year,
          category: cat,
          links: pageLinks
        });
      }
    }
  }

  return events;
}

// Display all events for the entire year on the map, using category colors with black border & icon
async function displayYearEvents(allYearEvents, year, activeMonth) {
  clearEventMarkers();

  if (!allYearEvents || allYearEvents.length === 0) {
    const eraStr = year < 0 ? `${Math.abs(year)} BC` : `${year} AD`;
    calEventsList.innerHTML = `<div class="cal-event-empty">No major recorded events found in ${eraStr}</div>`;
    calEventsCount.textContent = '0';
    return;
  }

  // Prioritize battles, treaties, geopolitical events first
  const priorityOrder = { battle: 1, treaty: 2, geopolitical: 3, politics: 4, exploration: 5, disaster: 6, general: 7 };
  const sortedYearEvents = [...allYearEvents].sort((a, b) => {
    return (priorityOrder[a.category.type] || 9) - (priorityOrder[b.category.type] || 9);
  });

  // Filter list for the calendar drawer: prioritize active month, or top year events
  const monthFiltered = sortedYearEvents.filter(e => e.monthIdx === activeMonth);
  const calendarDisplayList = (monthFiltered.length > 0 ? monthFiltered : sortedYearEvents).slice(0, 35);

  calEventsCount.textContent = calendarDisplayList.length;
  calEventsList.innerHTML = '';

  // Collect candidate titles from the FULL YEAR events to query coordinates
  const titlesToFetch = [];
  sortedYearEvents.forEach(e => {
    e.links.slice(0, 4).forEach(t => {
      if (!coordsCache.has(t) && !titlesToFetch.includes(t)) {
        titlesToFetch.push(t);
      }
    });
  });

  // Batch query coordinates for titles from Wikipedia API in chunks of 50
  if (titlesToFetch.length > 0) {
    const batches = [];
    const titlesSlice = titlesToFetch.slice(0, 100);
    for (let i = 0; i < titlesSlice.length; i += 50) {
      batches.push(titlesSlice.slice(i, i + 50));
    }

    for (const batch of batches) {
      try {
        const pipeTitles = batch.join('|');
        const qUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=coordinates|pageprops&redirects=1&titles=${encodeURIComponent(pipeTitles)}&format=json&origin=*`;
        const qRes = await fetch(qUrl);
        if (qRes.ok) {
          const qData = await qRes.json();
          const pages = qData.query?.pages || {};
          const redirects = qData.query?.redirects || [];
          
          const redirectMap = new Map();
          redirects.forEach(r => redirectMap.set(r.to, r.from));

          for (const pid in pages) {
            const p = pages[pid];
            const hasCoord = p.coordinates && p.coordinates.length > 0;
            const coords = hasCoord ? [p.coordinates[0].lon, p.coordinates[0].lat] : null;
            
            coordsCache.set(p.title, coords);
            if (redirectMap.has(p.title)) {
              coordsCache.set(redirectMap.get(p.title), coords);
            }
          }
        }
      } catch (err) {
        console.warn('Coordinates batch fetch error:', err);
      }
    }
  }

  // Populate Calendar Drawer list
  calendarDisplayList.forEach(evt => {
    let coords = null;
    let mainArticle = evt.links[0] || '';

    for (const t of evt.links) {
      if (coordsCache.has(t) && coordsCache.get(t)) {
        coords = coordsCache.get(t);
        mainArticle = t;
        break;
      }
    }

    const monthLabel = MONTH_SHORT[Math.max(0, Math.min(11, (evt.monthIdx || 1) - 1))];
    const item = document.createElement('div');
    item.className = 'cal-event-item';

    const wikiUrl = mainArticle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(mainArticle.replace(/ /g, '_'))}` : null;

    item.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="cal-event-year" style="color:${evt.category.color}; display:flex; align-items:center; gap:6px;">
          <span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; background:${evt.category.color}; border:1.5px solid #111113; border-radius:50%; color:#111113;">
            ${evt.category.svg}
          </span>
          <span style="font-weight:700;">${monthLabel} &bull; ${evt.category.label}</span>
        </span>
        ${coords ? '<span style="font-size:10px; color:var(--text-dim);">📍 On Map</span>' : ''}
      </div>
      <div class="cal-event-text">${evt.text}</div>
      ${wikiUrl ? `<a href="${wikiUrl}" target="_blank" class="cal-event-link" onclick="event.stopPropagation()">Read &rarr;</a>` : ''}
    `;

    item.addEventListener('click', () => {
      if (coords && map) {
        map.flyTo({
          center: coords,
          zoom: Math.max(map.getZoom(), 6),
          essential: true,
          duration: 1200
        });
      }
    });

    calEventsList.appendChild(item);
  });

  // Render Map Markers for ALL events across the full year
  const renderedCoords = new Set();
  sortedYearEvents.forEach(evt => {
    let coords = null;
    let mainArticle = evt.links[0] || '';

    for (const t of evt.links) {
      if (coordsCache.has(t) && coordsCache.get(t)) {
        coords = coordsCache.get(t);
        mainArticle = t;
        break;
      }
    }

    if (coords && map) {
      // Slightly jitter duplicates if multiple events share exact coordinates
      const coordKey = `${coords[0].toFixed(3)},${coords[1].toFixed(3)}`;
      let finalCoords = coords;
      if (renderedCoords.has(coordKey)) {
        finalCoords = [coords[0] + (Math.random() - 0.5) * 0.05, coords[1] + (Math.random() - 0.5) * 0.05];
      }
      renderedCoords.add(coordKey);

      const monthIdx = Math.max(0, Math.min(11, (evt.monthIdx || 1) - 1));
      const monthLabel = MONTH_SHORT[monthIdx];
      const wikiUrl = mainArticle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(mainArticle.replace(/ /g, '_'))}` : null;

      const el = document.createElement('div');
      el.className = 'historical-event-marker';
      el.style.width = '26px';
      el.style.height = '26px';
      el.style.borderRadius = '50%';
      el.style.backgroundColor = evt.category.color; // Intended category color
      el.style.border = '2px solid #111113'; // Strong black border
      el.style.boxShadow = 'none'; // Shadow removed per user request
      el.style.cursor = 'pointer';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.color = '#111113'; // Black/dark grey symbol
      el.style.zIndex = '50';
      el.title = `${monthLabel} — ${evt.category.label}: ${evt.text}`;
      el.innerHTML = evt.category.svg;

      // Always anchor to 'bottom' so popup displays on the top side of the event dot
      const popup = new maplibregl.Popup({ anchor: 'bottom', offset: 16, closeButton: true })
        .setHTML(`
          <div style="font-size:12px; max-width:250px; line-height:1.4;">
            <div style="font-size:12px; font-weight:700; color:${evt.category.color}; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
              <span style="display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; background:${evt.category.color}; border:1.5px solid #111113; border-radius:50%; color:#111113;">
                ${evt.category.svg}
              </span>
              <span>${monthLabel} ${year < 0 ? `${Math.abs(year)} BC` : `${year} AD`} &bull; ${evt.category.label}</span>
            </div>
            <p style="margin:4px 0 0 0; color:var(--text);">${evt.text}</p>
            ${wikiUrl ? `<a href="${wikiUrl}" target="_blank" style="color:#3b82f6; font-size:11px; margin-top:6px; display:inline-block; text-decoration:underline;">Read Wikipedia Article &rarr;</a>` : ''}
          </div>
        `);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(finalCoords)
        .setPopup(popup)
        .addTo(map);

      // Handle click cleanly on the marker element: close other popups, toggle this popup, and stop propagation
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        isEventMarkerClick = true;
        setTimeout(() => { isEventMarkerClick = false; }, 250);

        const isAlreadyOpen = popup.isOpen();
        // Close any previously opened event popups
        eventMarkers.forEach(m => {
          const p = m.popup || (m.marker && m.marker.getPopup ? m.marker.getPopup() : null);
          if (p && p.isOpen()) p.remove();
        });

        if (!isAlreadyOpen) {
          marker.togglePopup();
        }
      });

      // Prevent map drag/mousedown from eating the click on the marker
      el.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
      });

      eventMarkers.push({ marker, el, lngLat: finalCoords, popup });
    }
  });

  updateGlobeMarkerVisibility();
}

// Hide markers that are on the back side of the Earth or obscured near the horizon in Globe projection
function updateGlobeMarkerVisibility() {
  if (!map) return;
  const proj = currentProjection;
  if (proj !== 'globe') {
    eventMarkers.forEach(item => {
      if (item.el) {
        item.el.style.display = 'flex';
        item.el.style.opacity = '1';
        item.el.style.pointerEvents = 'auto';
      }
    });
    return;
  }

  // In globe view, calculate angular distance from map camera center to each marker's lng/lat
  const center = map.getCenter();
  const pitch = map.getPitch() || 0; // pitch in degrees
  const rad = Math.PI / 180;
  const cLat = center.lat * rad;
  const cLon = center.lng * rad;

  // When camera is pitched back, the horizon facing the camera perspective shifts forward,
  // obscuring points sooner. A threshold of 0.22 - 0.35 cleanly cuts off points before they clip through the curved globe edge.
  const pitchFactor = Math.sin(pitch * rad) * 0.15;
  const threshold = Math.max(0.20, 0.22 + pitchFactor);

  eventMarkers.forEach(item => {
    if (!item.el || !item.lngLat) return;
    const mLon = item.lngLat[0] * rad;
    const mLat = item.lngLat[1] * rad;

    // Spherical dot product between center normal and marker normal
    const cosDist = Math.sin(cLat) * Math.sin(mLat) + Math.cos(cLat) * Math.cos(mLat) * Math.cos(cLon - mLon);

    // If point is near or past the horizon curve, completely hide it
    if (cosDist < threshold) {
      item.el.style.display = 'none';
      item.el.style.opacity = '0';
      item.el.style.pointerEvents = 'none';
      if (item.popup && item.popup.isOpen()) item.popup.remove();
    } else {
      item.el.style.display = 'flex';
      item.el.style.opacity = '1';
      item.el.style.pointerEvents = 'auto';
    }
  });
}

// Hook map events to update globe horizon occlusion continuously
['move', 'rotate', 'pitch', 'zoom'].forEach(evt => {
  map.on(evt, () => {
    if (currentProjection === 'globe') {
      updateGlobeMarkerVisibility();
    }
  });
});

// Hook timeline input to sync calendar and fetch year events on the map
let eventFetchTimeout = null;
const origUpdateYearUI = updateYearUI;
updateYearUI = function(year, immediate = false) {
  origUpdateYearUI(year, immediate);
  updateCalendarUI();
  if (eventFetchTimeout) clearTimeout(eventFetchTimeout);
  eventFetchTimeout = setTimeout(() => {
    fetchSignificantEvents();
  }, immediate ? 100 : 350);
};

// Initialize UI state
updateYearUI(currentYear);
updateCalendarUI();
fetchSignificantEvents();
