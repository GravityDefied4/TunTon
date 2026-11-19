/* =========================================================
   Map page: lost pet reports near you.
   Optional: dashboard.html?focus=<report id> zooms to one report.
   ========================================================= */

if (typeof L === 'undefined') {
  document.getElementById('map-skel')?.remove();
  $('#side-body').innerHTML = '';
  $('#map').textContent = 'The map library failed to load. Check your internet connection.';
  throw new Error('Leaflet not loaded');
}

let me = null;
/* The site is for Dagupan City only: the map is locked to the city and opens on it. */
const map = L.map('map').setView(DAGUPAN, 13);
lockToDagupan(map);
mapSkeleton($('#map').parentElement, tiles(map));   // the static cover in dashboard.html goes away once tiles draw
const city = highlightDagupan(map);   // green outline of the city, the rest is dimmed
/* Phones (max 640px): the map is full screen with floating controls and a bottom sheet over it.
   sheetMode() is true there; every sheet / padding rule below is skipped on tablets and desktop. */
const sheetMode = () => matchMedia('(max-width: 640px)').matches;
const MINI_H = 44, PEEK_H = 156, TOP_H = 180, BOT_H = 79;   // collapsed sheet height; top bar + search + chips area; tab bar + gap under the sheet (px)
const fitTo = (bounds, pad = 20, opts = {}) => sheetMode()
  ? map.fitBounds(bounds, { paddingTopLeft: [pad, TOP_H + pad], paddingBottomRight: [pad, PEEK_H + BOT_H + pad], ...opts })
  : map.fitBounds(bounds, { padding: [pad, pad], ...opts });
const fitCity = () => sheetMode() ? fitTo(L.latLngBounds(DAGUPAN_BOUNDS), 12) : city.fit();
fitCity();
const CityControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const b = L.DomUtil.create('button', 'map-ctl');
    b.type = 'button'; b.title = 'Zoom to Dagupan City'; b.setAttribute('aria-label', 'Zoom to Dagupan City');
    b.innerHTML = ICON.pin;
    L.DomEvent.disableClickPropagation(b);
    b.addEventListener('click', () => fitCity());
    return b;
  }
});
new CityControl().addTo(map);
const cityLabelSize = () => map.getContainer().classList.toggle('zoom-far', map.getZoom() < 11);
map.on('zoomend', cityLabelSize); cityLabelSize();

const group = L.layerGroup().addTo(map);
const markers = {};
let meMarker = null, ring = null;
let visible = [], selectedId = null;   // reports shown in the panel, and the one open in the panel
let filter = 'all', query = '';
const side = $('#side'), sideBody = $('#side-body');
$('#dashboard-name').textContent = shownName();
const desktop = () => matchMedia('(min-width: 1001px)').matches;   // on desktop the panel sits beside the map
const titleOf = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const stateText = r => reportState(r) === 'lost' ? 'Missing' : 'Potentially found';
const matches = r => {
  if (filter !== 'all' && reportState(r) !== filter) return false;
  if (!query) return true;
  return [r.name, speciesOf(r), r.breed, r.color, r.brgy, r.markings].filter(Boolean).join(' ').toLowerCase().includes(query);
};

/* ---------- Search radius, limited to Dagupan ----------
   A plain circle spills over the sea and the next towns, which suggests reports from there are included.
   So the radius is drawn as "the part of Dagupan City inside the circle": a soft fill for that area and a
   dashed edge only where the circle really runs through the city. */
function cityRing(origin, radiusKm) {
  const N = 180, dLat = radiusKm / 111.32, dLng = radiusKm / (111.32 * Math.cos(origin[0] * Math.PI / 180));
  const circle = Array.from({ length: N }, (_, i) => { const a = 2 * Math.PI * i / N; return [origin[0] + dLat * Math.sin(a), origin[1] + dLng * Math.cos(a)]; });   // [lat, lng], counter-clockwise
  /* Sutherland-Hodgman: clip the city outline (any shape) against the circle (convex) */
  const side = (p, a, b) => (b[1] - a[1]) * (p[0] - a[0]) - (b[0] - a[0]) * (p[1] - a[1]);   // >= 0: inside (left of a to b)
  const cross = (p, q, a, b) => { const t = side(p, a, b) / (side(p, a, b) - side(q, a, b)); return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; };
  let area = DAGUPAN_OUTLINE.slice();
  for (let i = 0; i < N && area.length; i++) {
    const a = circle[i], b = circle[(i + 1) % N], next = [];
    area.forEach((p, j) => {
      const q = area[(j + 1) % area.length], pin = side(p, a, b) >= 0, qin = side(q, a, b) >= 0;
      if (pin) next.push(p);
      if (pin !== qin) next.push(cross(p, q, a, b));
    });
    area = next;
  }
  if (area.length < 3) return null;
  const g = L.featureGroup().addTo(map);
  L.polygon(area, { stroke: false, fillColor: '#0f6b3f', fillOpacity: .07, interactive: false }).addTo(g);
  /* dashed edge: only the stretches of the circle that lie inside the city */
  const inside = circle.map(p => inDagupan(p[0], p[1]));
  const start = inside.indexOf(false);
  const order = start < 0 ? circle.concat([circle[0]]) : circle.slice(start).concat(circle.slice(0, start)).concat([circle[start]]);
  let run = [];
  const flush = () => { if (run.length > 1) L.polyline(run, { color: '#0f6b3f', weight: 2, opacity: .55, dashArray: '6 8', interactive: false }).addTo(g); run = []; };
  order.forEach(p => { if (inDagupan(p[0], p[1])) run.push(p); else flush(); });
  flush();
  return g;
}

function render(fit) {
  group.clearLayers();
  visible = [];
  Object.keys(markers).forEach(k => delete markers[k]);
  const val = $('#radius').value, origin = me || DAGUPAN, lim = val === 'all' ? Infinity : +val;
  if (ring) { map.removeLayer(ring); ring = null; }
  if (lim !== Infinity) ring = cityRing(origin, lim);
  const pts = [];
  allReports().forEach(r => {
    if (km(origin, [r.lat, r.lng]) > lim || !matches(r)) return;
    pts.push([r.lat, r.lng]);
    visible.push({ r, d: km(origin, [r.lat, r.lng]) });
    markers[r.id] = L.marker([r.lat, r.lng], { icon: pinIcon(reportState(r)), title: titleOf(r) }).addTo(group)
      .on('click', () => select(r.id));
  });
  if (selectedId && !markers[selectedId]) selectedId = null;   // selected report is outside the new radius
  renderSide(); markSelected();
  $('#count').textContent = pts.length + (pts.length === 1 ? ' report' : ' reports');
  if (fit) {
    if (lim === Infinity && pts.length) fitTo(L.latLngBounds(inDagupan(...origin) ? pts.concat([origin]) : pts).pad(.2), 0);
    else if (ring) fitTo(ring.getBounds(), 20);   // zoom so the whole circle is on screen
    else fitCity();
  }
}

/* ---------- Side panel: list of reports (nothing selected) or details of the selected report ---------- */

function listHTML() {
  if (!visible.length) return '<div class="side-empty"><h2>No reports here</h2><p>Try a larger radius, another filter, or press My location.</p></div>';
  const cards = visible.slice().sort((a, b) => a.d - b.d).map(({ r, d }) => {
    const st = reportState(r), meta = [speciesOf(r), r.breed, r.color].filter(Boolean).join(' · ');
    return `<li><button type="button" class="vcard" data-id="${esc(r.id)}">
      <span class="vthumb"><img src="${esc(r.photo)}" alt=""><em class="vbadge vbadge--${st}">${stateText(r)}</em></span>
      <span class="vinfo"><b class="vtitle">${short(titleOf(r), 28, 8)}</b>
        <span class="vmeta">${esc(meta)}</span>
        <span class="vmeta">${esc([r.brgy, me ? distText(d) : '', ago(r.date)].filter(Boolean).join(' · '))}</span></span></button></li>`;
  }).join('');
  return `<h2 class="side-title">Reports <small>${visible.length}</small></h2>
    <ul class="vlist">${cards}</ul>`;
}

function detailHTML(r) {
  const state = reportState(r), lost = state === 'lost', owner = isOwner(r), cf = confirmedFind(r);
  const pics = r.photos && r.photos.length ? r.photos : [r.photo];
  const desc = r.description || r.howFound || '';
  const facts = [['Species', speciesOf(r)], ['Breed', r.breed], ['Sex', petSexLabel(r.sex) || 'Not specified'], ['Color', r.color], ['Size', r.size], ['Markings', r.markings]].filter(x => x[1]);
  const verb = r.kind === 'lost' ? 'Last seen' : 'Found';
  return `<button type="button" class="side-back" id="side-back">&larr; Back to results</button>
    <div class="side-photo"><img id="side-img" src="${esc(pics[0])}" alt="Photo of ${esc(titleOf(r))}"></div>
    ${pics.length > 1 ? `<div class="side-thumbs">${pics.map((p, i) => `<button type="button" data-pic="${esc(p)}" aria-label="Photo ${i + 1}"><img src="${esc(p)}" alt=""></button>`).join('')}</div>` : ''}
    <span class="badge ${lost ? 'badge--lost' : 'badge--home'}">${lost ? 'Lost pet' : r.kind === 'lost' ? 'Pet found' : 'Found pet'}</span>
    <h2 class="side-name">${short(titleOf(r), 32, 8)}</h2>
    ${flagChipHTML(r)}
    <p class="d-sub">${esc([speciesOf(r), r.breed, r.color].filter(Boolean).join(' · '))}</p>
    ${contactCardHTML(r, r.kind === 'lost' ? 'Owner' : 'Finder')}
    <ul class="pet-info">
      <li>${ICON.pin}<span>${verb} in ${esc(r.brgy)}${me ? ' &middot; ' + esc(awayText(me, r)) : ''}</span></li>
      <li>${ICON.calendar}<span>${esc(niceDate(r.date))} &middot; ${esc(ago(r.date))}</span></li>
      ${cf ? `<li>${ICON.check}<span>Found in ${esc(cf.brgy)} &middot; ${esc(niceDate(cf.date))}</span></li>` : ''}
    </ul>
    ${desc ? `<h3>${r.kind === 'lost' ? 'Description' : 'How it was found'}</h3><p class="side-text">${esc(desc)}</p>` : ''}
    <h3>Pet details</h3><div class="fact-grid">${facts.map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
    <div class="side-actions">
      ${lost && !owner ? respondButton(r) : ''}
      ${r.kind === 'found' && !owner && !confirmedClaim(r) ? respondButton(r) : ''}
      <a class="btn btn-small" href="report.html?id=${encodeURIComponent(r.id)}">View full details</a>
    </div>`;
}

function renderSide() {
  const r = selectedId && allReports().find(x => x.id === selectedId);
  sideBody.innerHTML = r ? detailHTML(r) : listHTML();
  sideBody.scrollTop = 0;
}

function markSelected() {
  Object.entries(markers).forEach(([id, m]) => {
    m.setZIndexOffset(id === selectedId ? 1000 : 0);
    m.getElement()?.classList.toggle('is-selected', id === selectedId);
  });
}

function select(id, zoom) {
  selectedId = id;
  renderSide(); markSelected();
  const r = id && allReports().find(x => x.id === id);
  if (!r) return;
  if (sheetMode()) {
    setSheet(true);
    /* the sheet covers the bottom of the map, so put the pin in the middle of what is still visible */
    const z = zoom ? Math.max(map.getZoom(), 15) : map.getZoom(), shift = (sheetPx() + BOT_H - TOP_H) / 2;
    map.setView(map.unproject(map.project([r.lat, r.lng], z).add([0, shift]), z), z, { animate: true });
    return;
  }
  if (zoom) map.setView([r.lat, r.lng], Math.max(map.getZoom(), 15), { animate: true });
  else map.panInside([r.lat, r.lng], { padding: [60, 60] });
  if (!desktop()) side.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function backToList() { selectedId = null; renderSide(); markSelected(); if (typeof paintSheet === 'function') paintSheet(); }

side.addEventListener('click', e => {
  const item = e.target.closest('.vcard'), pic = e.target.closest('[data-pic]');
  if (item) select(item.dataset.id, true);
  else if (e.target.closest('#side-back')) backToList();
  else if (pic) $('#side-img').src = pic.dataset.pic;
});
/* Hovering a card bounces its pin, like Google Maps */
const hoverPin = (e, on) => {
  const c = e.target.closest('.vcard'); if (!c || !markers[c.dataset.id]) return;
  markers[c.dataset.id].getElement()?.classList.toggle('is-hover', on);
};
side.addEventListener('mouseover', e => hoverPin(e, true));
side.addEventListener('mouseout', e => hoverPin(e, false));
map.on('click', () => { backToList(); if (sheetMode() && sheetState > 1) setSheet(false); });   // click on empty map: back to the list (phones: an open sheet drops to the peek, a hidden one stays hidden)

/* ---------- Phones: the report list is a bottom sheet over the map ----------
   Collapsed = a "peek" with the count; open = the list (or one report's details).
   Tap or swipe the handle to toggle. The status line (#status / #count) is moved into the handle,
   moved, not copied, so the ids stay unique and the existing code keeps updating it. */
const statusEl = document.querySelector('.map-status'), statusHome = statusEl.parentNode, statusNext = statusEl.nextSibling;
const sheetHead = document.createElement('div');
sheetHead.className = 'sheet-head';
sheetHead.setAttribute('role', 'button');
sheetHead.tabIndex = 0;
sheetHead.setAttribute('aria-controls', 'side-body');
sheetHead.innerHTML = '<span class="sheet-grab" aria-hidden="true"></span>';
/* Three heights: 0 = minimised (a small pill with the count, the whole map is visible), 1 = peek, 2 = open */
let sheetState = 1;
const sheetOpen = () => sheetState === 2;
/* open height: most of the screen, but never tall enough to cover the top bar, search and chips (they end ~180px from the top) */
const sheetPx = () => sheetState === 0 ? MINI_H : sheetState === 1 ? PEEK_H : Math.round(Math.max(PEEK_H + 60, Math.min(innerHeight * (selectedId ? .56 : .64), 640, innerHeight - 270)));
/* The sheet and the tab bar cover the bottom of the map, and the top bar + search cover the top. The map is locked to Dagupan,
   so without this the southern edge of the city could never be panned out from under them. On phones the "wall" is moved out by
   exactly the covered height (in pixels at the current zoom), so every part of the city can be brought into the visible area. */
function lockBounds() {
  const base = L.latLngBounds(DAGUPAN_BOUNDS);
  if (!sheetMode()) { map.setMaxBounds(base); return; }
  const z = map.getZoom(), sw = map.project(base.getSouthWest(), z), ne = map.project(base.getNorthEast(), z);
  map.setMaxBounds(L.latLngBounds(map.unproject(sw.add([0, BOT_H + sheetPx()]), z), map.unproject(ne.subtract([0, TOP_H]), z)));
}
map.on('zoomend resize', lockBounds);
function paintSheet() {
  const on = sheetMode();
  document.body.style.setProperty('--sheet-h', (on ? sheetPx() : PEEK_H) + 'px');
  side.classList.toggle('is-open', on && sheetState === 2);
  side.classList.toggle('is-mini', on && sheetState === 0);
  document.body.classList.toggle('sheet-open', on && sheetState === 2);
  sheetHead.setAttribute('aria-expanded', String(sheetState === 2));
  sheetHead.setAttribute('aria-label', sheetState === 0 ? 'Show reports' : sheetState === 1 ? 'Expand reports list' : 'Collapse reports list');
  lockBounds();
}
function setSheetState(n) { sheetState = Math.max(0, Math.min(2, n)); paintSheet(); }
function setSheet(open) { setSheetState(open ? 2 : 1); }
function placeSheet() {   // phones: header + status inside the sheet; elsewhere everything is back where it was
  if (sheetMode()) { side.prepend(sheetHead); sheetHead.append(statusEl); }
  else { sheetHead.remove(); statusHome.insertBefore(statusEl, statusNext); }
  paintSheet();
}
/* tap = next size up (minimised -> peek -> open -> peek), swipe up = one size up, swipe down = one size down */
let dragY = null;
sheetHead.addEventListener('pointerdown', e => { dragY = e.clientY; sheetHead.setPointerCapture?.(e.pointerId); });
sheetHead.addEventListener('pointerup', e => {
  if (dragY == null) return;
  const dy = e.clientY - dragY; dragY = null;
  setSheetState(Math.abs(dy) < 10 ? (sheetState === 2 ? 1 : sheetState + 1) : sheetState + (dy < 0 ? 1 : -1));
});
sheetHead.addEventListener('pointercancel', () => { dragY = null; });
sheetHead.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSheetState(sheetState === 2 ? 1 : sheetState + 1); } });
matchMedia('(max-width: 640px)').addEventListener('change', placeSheet);
addEventListener('resize', paintSheet);
placeSheet();

/* Search + filter chips */
$('#q').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); render(false); });
document.querySelector('.chip-row').addEventListener('click', e => {
  const b = e.target.closest('.fchip'); if (!b) return;
  filter = b.dataset.filter;
  document.querySelectorAll('.fchip').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-pressed', x === b); });
  render(false);
});

function locate() {
  $('#status').textContent = 'Finding your location…';
  getPosition({ enableHighAccuracy: true, timeout: 10000 }).then(p => {
    if (!p) return fallback('Location unavailable. Showing Dagupan City.');
    if (!inDagupan(p.lat, p.lng)) {   // outside the city: the map stays on Dagupan and shows every report
      me = null;
      if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
      $('#radius').value = 'all'; $('#status').textContent = 'You are outside Dagupan City. Showing all of Dagupan.';
      return render(true);
    }
    me = [p.lat, p.lng];
    if (meMarker) meMarker.setLatLng(me);
    else meMarker = L.marker(me, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    $('#status').textContent = p.approx ? 'Using your approximate location (GPS needs https)' : 'Using your current location';
    render(true);
  });
}
function fallback(msg) { me = null; $('#status').textContent = msg; render(true); }

new ResizeObserver(() => map.invalidateSize()).observe($('#map'));   // sidebar minimize/expand
$('#radius').addEventListener('change', () => render(true));
$('#locate').addEventListener('click', locate);

/* Opened from another page with ?focus=<id>: zoom to that report. Otherwise find the user.
   The reports are loaded from the database first; nothing is drawn until they arrive. */
$('#count').textContent = 'Loading…';
reportsReady.then(() => {
  const focusId = new URLSearchParams(location.search).get('focus');
  const focused = focusId && allReports().find(r => r.id === focusId);
  if (focused) {
    $('#radius').value = 'all';
    $('#status').textContent = 'Showing the report you selected';
    render(false);
    map.setView([focused.lat, focused.lng], 16);
    select(focused.id, false);
  } else {
    locate();
  }
}).catch(err => {
  console.error(err);
  $('#count').textContent = '';
  $('#status').textContent = 'Could not load reports. Please try again.';
  sideBody.innerHTML = '<div class="side-empty"><h2>Could not load reports</h2><p>Check your connection and refresh the page.</p></div>';
});