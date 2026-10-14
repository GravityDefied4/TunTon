/* =========================================================
   Map page: lost pet reports near you.
   Optional: dashboard.html?focus=<report id> zooms to one report.
   ========================================================= */

if (typeof L === 'undefined') {
  $('#map').textContent = 'The map library failed to load. Check your internet connection.';
  throw new Error('Leaflet not loaded');
}

let me = null;
/* The map can be viewed anywhere (only FILING a report is limited to Dagupan City). */
const map = L.map('map', { minZoom: 6 }).setView(DAGUPAN, 13);
tiles(map);
const city = highlightDagupan(map);   // green outline of the city, no restriction
const CityControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const b = L.DomUtil.create('button', 'map-ctl');
    b.type = 'button'; b.title = 'Zoom to Dagupan City'; b.setAttribute('aria-label', 'Zoom to Dagupan City');
    b.innerHTML = ICON.pin;
    L.DomEvent.disableClickPropagation(b);
    b.addEventListener('click', () => city.fit());
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
const desktop = () => matchMedia('(min-width: 1001px)').matches;   // on desktop the panel sits beside the map
const titleOf = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const stateText = r => reportState(r) === 'lost' ? 'Missing' : 'Potentially found';
const matches = r => {
  if (filter !== 'all' && reportState(r) !== filter) return false;
  if (!query) return true;
  return [r.name, speciesOf(r), r.breed, r.color, r.brgy, r.markings].filter(Boolean).join(' ').toLowerCase().includes(query);
};

function render(fit) {
  group.clearLayers();
  visible = [];
  Object.keys(markers).forEach(k => delete markers[k]);
  const val = $('#radius').value, origin = me || DAGUPAN, lim = val === 'all' ? Infinity : +val;
  if (ring) { map.removeLayer(ring); ring = null; }
  if (lim !== Infinity) ring = L.circle(origin, { radius: lim * 1000, color: '#0f6b3f', weight: 2, fillOpacity: .06, interactive: false }).addTo(map);
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
    if (lim === Infinity && pts.length) map.fitBounds(L.latLngBounds(inDagupan(...origin) ? pts.concat([origin]) : pts).pad(.2));
    else if (ring) map.fitBounds(ring.getBounds(), { padding: [20, 20] });   // zoom so the whole circle is on screen
    else map.setView(origin, 13);
  }
}

/* ---------- Side panel: list of reports (nothing selected) or details of the selected report ---------- */

function listHTML() {
  if (!visible.length) return '<div class="side-empty"><h2>No reports here</h2><p>Try a larger radius, another filter, or press My location.</p></div>';
  const cards = visible.slice().sort((a, b) => a.d - b.d).map(({ r, d }) => {
    const st = reportState(r), meta = [speciesOf(r), r.breed, r.color].filter(Boolean).join(' · ');
    return `<li><button type="button" class="vcard" data-id="${esc(r.id)}">
      <span class="vthumb"><img src="${esc(r.photo)}" alt=""><em class="vbadge vbadge--${st}">${stateText(r)}</em></span>
      <span class="vinfo"><b class="vtitle">${esc(titleOf(r))}</b>
        <span class="vmeta">${esc(meta)}</span>
        <span class="vmeta">${esc(r.brgy)}${me ? ' · ' + distText(d) : ''}</span>
        <span class="vmeta">${esc(ago(r.date))}</span></span></button></li>`;
  }).join('');
  return `<h2 class="side-title">Reports <small>${visible.length}</small></h2>
    <ul class="vlist">${cards}</ul>`;
}

function detailHTML(r) {
  const state = reportState(r), lost = state === 'lost', owner = isOwner(r), cf = confirmedFind(r);
  const pics = r.photos && r.photos.length ? r.photos : [r.photo];
  const desc = r.kind === 'lost' ? (r.description || r.markings || '') : (r.howFound || r.markings || '');
  const facts = [['Species', speciesOf(r)], ['Breed', r.breed], ['Color', r.color], ['Size', r.size], ['Markings', r.kind === 'lost' && r.description ? r.markings : '']].filter(x => x[1]);
  const verb = r.kind === 'lost' ? 'Last seen' : 'Found';
  return `<button type="button" class="side-back" id="side-back">&larr; Back to results</button>
    <div class="side-photo"><img id="side-img" src="${esc(pics[0])}" alt="Photo of ${esc(titleOf(r))}"></div>
    ${pics.length > 1 ? `<div class="side-thumbs">${pics.map((p, i) => `<button type="button" data-pic="${esc(p)}" aria-label="Photo ${i + 1}"><img src="${esc(p)}" alt=""></button>`).join('')}</div>` : ''}
    <span class="badge ${lost ? 'badge--lost' : 'badge--home'}">${lost ? 'Lost pet' : r.kind === 'lost' ? 'Pet found' : 'Found pet'}</span>
    <h2 class="side-name">${esc(titleOf(r))}</h2>
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
  if (zoom) map.setView([r.lat, r.lng], Math.max(map.getZoom(), 15), { animate: true });
  else map.panInside([r.lat, r.lng], { padding: [60, 60] });
  if (!desktop()) side.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function backToList() { selectedId = null; renderSide(); markSelected(); }

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
map.on('click', backToList);   // click on empty map: back to the list

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
  if (!navigator.geolocation) return fallback('Location not supported. Showing Dagupan City.');
  navigator.geolocation.getCurrentPosition(p => {
    me = [p.coords.latitude, p.coords.longitude];
    if (meMarker) meMarker.setLatLng(me);
    else meMarker = L.marker(me, { icon: L.divIcon({ className: '', html: '<div class="me"></div>', iconSize: [18, 18] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    if (!inDagupan(...me)) {   // you can still look around, but all reports are in Dagupan City
      $('#radius').value = 'all'; $('#status').textContent = 'You are outside Dagupan City. Showing all reports.';
    } else $('#status').textContent = 'Using your current location';
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