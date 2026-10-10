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

function render(fit) {
  group.clearLayers();
  Object.keys(markers).forEach(k => delete markers[k]);
  const val = $('#radius').value, origin = me || DAGUPAN, lim = val === 'all' ? Infinity : +val;
  if (ring) { map.removeLayer(ring); ring = null; }
  if (lim !== Infinity) ring = L.circle(origin, { radius: lim * 1000, color: '#0f6b3f', weight: 2, fillOpacity: .06, interactive: false }).addTo(map);
  const pts = [];
  allReports().forEach(r => {
    if (km(origin, [r.lat, r.lng]) > lim) return;
    pts.push([r.lat, r.lng]);
    const meta = [r.species, r.breed, r.color].filter(Boolean).join(' · ');
    markers[r.id] = L.marker([r.lat, r.lng], { icon: pinIcon(r.kind) }).addTo(group).bindPopup(
      `<div class="pop"><img src="${esc(r.photo)}" alt=""><h3>${esc(r.name || (r.kind === 'lost' ? 'Missing pet' : 'Pet found'))}</h3>` +
      `<p><b>${r.kind === 'lost' ? 'Missing' : 'Potentially found'}</b> · ${esc(ago(r.date))}</p><p>${esc(meta)}</p><p>${esc(r.brgy)}</p>` +
      (r.contact ? `<p>Contact: ${esc(r.contact)}</p>` : '') + '</div>');
  });
  $('#count').textContent = pts.length + (pts.length === 1 ? ' report' : ' reports');
  if (fit) {
    if (lim === Infinity && pts.length) map.fitBounds(L.latLngBounds(pts.concat([origin])).pad(.2));
    else map.setView(origin, lim <= 1 ? 15 : lim <= 3 ? 14 : 13);
  }
}

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
  markers[focused.id]?.openPopup();
} else {
  locate();
}