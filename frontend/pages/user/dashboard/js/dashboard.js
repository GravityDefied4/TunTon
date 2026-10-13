/* =========================================================
   Map page: lost pet reports near you.
   Optional: dashboard.html?focus=<report id> zooms to one report.
   ========================================================= */

if (typeof L === 'undefined') {
  $('#map').textContent = 'The map library failed to load. Check your internet connection.';
  throw new Error('Leaflet not loaded');
}

let me = null;
const map = L.map('map').setView(DAGUPAN, 13);
tiles(map);
const group = L.layerGroup().addTo(map);
const markers = {};
let meMarker = null, ring = null;
let visible = [], selectedId = null;   // reports inside the radius, and the one shown in the side panel
const side = $('#side'), sideBody = $('#side-body'), sideToggle = $('#side-toggle');
const desktop = () => matchMedia('(min-width: 1001px)').matches;   // on desktop the panel floats over the map
const titleOf = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const distText = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km';
const stateText = r => reportState(r) === 'lost' ? 'Missing' : 'Potentially found';

function render(fit) {
  group.clearLayers();
  visible = [];
  Object.keys(markers).forEach(k => delete markers[k]);
  const val = $('#radius').value, origin = me || DAGUPAN, lim = val === 'all' ? Infinity : +val;
  if (ring) { map.removeLayer(ring); ring = null; }
  if (lim !== Infinity) ring = L.circle(origin, { radius: lim * 1000, color: '#0f6b3f', weight: 2, fillOpacity: .06, interactive: false }).addTo(map);
  const pts = [];
  allReports().forEach(r => {
    if (km(origin, [r.lat, r.lng]) > lim) return;
    pts.push([r.lat, r.lng]);
    visible.push({ r, d: km(origin, [r.lat, r.lng]) });
    markers[r.id] = L.marker([r.lat, r.lng], { icon: pinIcon(reportState(r)), title: titleOf(r) }).addTo(group)
      .on('click', () => select(r.id));
  });
  if (selectedId && !markers[selectedId]) selectedId = null;   // selected report is outside the new radius
  renderSide(); markSelected();
  $('#side-n').textContent = pts.length;
  $('#count').textContent = pts.length + (pts.length === 1 ? ' report' : ' reports');
  if (fit) {
    if (lim === Infinity && pts.length) map.fitBounds(L.latLngBounds(pts.concat([origin])).pad(.2));
    else map.setView(origin, lim <= 1 ? 15 : lim <= 3 ? 14 : 13);
  }
}

/* ---------- Side panel: list of reports (nothing selected) or details of the selected report ---------- */
const contactLink = c => {
  if (!c) return '<p class="hint">The reporter did not leave contact details.</p>';
  const href = /@/.test(c) ? 'mailto:' + c : /^[+\d][\d\s()-]{6,}$/.test(c) ? 'tel:' + c.replace(/[^\d+]/g, '') : '';
  return href ? `<a class="side-contact" href="${esc(href)}">${esc(c)}</a>` : `<p class="side-contact">${esc(c)}</p>`;
};

function listHTML() {
  if (!visible.length) return '<div class="side-empty"><h2>No reports here</h2><p>Try a larger radius or press My location.</p></div>';
  const rows = visible.slice().sort((a, b) => a.d - b.d).map(({ r, d }) => {
    const meta = [speciesOf(r), r.breed, r.color].filter(Boolean).join(' · ');
    return `<li><button type="button" class="side-item" data-id="${esc(r.id)}">
      <img src="${esc(r.photo)}" alt="">
      <span class="si-body"><b>${esc(titleOf(r))}</b><span>${esc(meta)}</span>
      <span class="si-sub"><em class="si-state si-state--${reportState(r)}">${stateText(r)}</em> ${esc(r.brgy)} · ${esc(ago(r.date))}${me ? ' · ' + distText(d) : ''}</span></span></button></li>`;
  }).join('');
  return `<h2 class="side-title">Reports nearby <small>${visible.length}</small></h2>
    <p class="hint">Tap a pin on the map, or pick a report here, to see its details.</p><ul class="side-list">${rows}</ul>`;
}

function detailHTML(r) {
  const state = reportState(r), lost = state === 'lost', owner = isOwner(r), cf = confirmedFind(r);
  const pics = r.photos && r.photos.length ? r.photos : [r.photo];
  const desc = r.kind === 'lost' ? (r.description || r.markings || '') : (r.howFound || r.markings || '');
  const facts = [['Species', speciesOf(r)], ['Breed', r.breed], ['Color', r.color], ['Size', r.size], ['Markings', r.kind === 'lost' && r.description ? r.markings : '']].filter(x => x[1]);
  const verb = r.kind === 'lost' ? 'Last seen' : 'Found';
  return `<button type="button" class="side-back" id="side-back">&larr; All reports</button>
    <div class="side-photo"><img id="side-img" src="${esc(pics[0])}" alt="Photo of ${esc(titleOf(r))}"></div>
    ${pics.length > 1 ? `<div class="side-thumbs">${pics.map((p, i) => `<button type="button" data-pic="${esc(p)}" aria-label="Photo ${i + 1}"><img src="${esc(p)}" alt=""></button>`).join('')}</div>` : ''}
    <span class="badge ${lost ? 'badge--lost' : 'badge--home'}">${lost ? 'Lost pet' : r.kind === 'lost' ? 'Pet found' : 'Found pet'}</span>
    <h2 class="side-name">${esc(titleOf(r))}</h2>
    <p class="d-sub">${esc([speciesOf(r), r.breed, r.color].filter(Boolean).join(' · '))}</p>
    <ul class="pet-info">
      <li><span aria-hidden="true">📍</span> ${verb} in ${esc(r.brgy)}</li>
      <li><span aria-hidden="true">🗓️</span> ${esc(niceDate(r.date))} &middot; ${esc(ago(r.date))}</li>
      ${cf ? `<li><span aria-hidden="true">✅</span> Found in ${esc(cf.brgy)} &middot; ${esc(niceDate(cf.date))}</li>` : ''}
    </ul>
    ${desc ? `<h3>${r.kind === 'lost' ? 'Description' : 'How it was found'}</h3><p class="side-text">${esc(desc)}</p>` : ''}
    <h3>Pet details</h3><dl class="side-dl">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <h3>${r.kind === 'lost' ? "Owner's contact" : 'Contact'}</h3>${contactLink(r.contact)}
    <div class="side-actions">
      ${lost && !owner ? `<a class="btn btn-sun" href="found.html?match=${encodeURIComponent(r.id)}">I found this pet</a>` : ''}
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

function setPanel(open) {
  side.classList.toggle('open', open);
  sideToggle.hidden = open;
}

/* Keep the chosen pin out from under the floating panel. */
function keepVisible(r) {
  if (desktop()) map.panInside([r.lat, r.lng], { paddingTopLeft: [30, 70], paddingBottomRight: [390, 50] });
}

function select(id, zoom) {
  selectedId = id;
  renderSide(); markSelected();
  const r = id && allReports().find(x => x.id === id);
  if (!r) return;
  setPanel(true);
  if (zoom) map.setView([r.lat, r.lng], Math.max(map.getZoom(), 15), { animate: false });
  keepVisible(r);
  if (!desktop()) side.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closePanel() { selectedId = null; renderSide(); markSelected(); setPanel(false); }

side.addEventListener('click', e => {
  const item = e.target.closest('.side-item'), pic = e.target.closest('[data-pic]');
  if (item) select(item.dataset.id, true);
  else if (e.target.closest('#side-back')) { selectedId = null; renderSide(); markSelected(); }   // back to the list
  else if (pic) $('#side-img').src = pic.dataset.pic;
});
map.on('click', closePanel);   // click on empty map: close the panel
$('#side-close').addEventListener('click', closePanel);
sideToggle.addEventListener('click', () => setPanel(true));
setPanel(false);

function locate() {
  $('#status').textContent = 'Finding your location…';
  if (!navigator.geolocation) return fallback('Location not supported. Showing Dagupan City.');
  navigator.geolocation.getCurrentPosition(p => {
    me = [p.coords.latitude, p.coords.longitude];
    if (meMarker) meMarker.setLatLng(me);
    else meMarker = L.marker(me, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    if (km(me, DAGUPAN) > 15) { $('#radius').value = 'all'; $('#status').textContent = 'You are outside Dagupan City. Showing all reports.'; }
    else $('#status').textContent = 'Using your current location';
    render(true);
  }, () => fallback('Location unavailable. Showing Dagupan City.'), { enableHighAccuracy: true, timeout: 10000 });
}
function fallback(msg) { me = null; $('#status').textContent = msg; render(true); }

new ResizeObserver(() => map.invalidateSize()).observe($('#map'));   // sidebar minimize/expand
$('#radius').addEventListener('change', () => render(true));
$('#locate').addEventListener('click', locate);

/* Opened from another page with ?focus=<id>: zoom to that report. Otherwise find the user. */
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