/* Set to true to send logged-out visitors back to the home page. */
const REQUIRE_LOGIN = false;

const SESSION_KEY = 'tunton_session', REPORTS_KEY = 'tunton_reports';
const DAGUPAN = [16.0433, 120.3339];
const BRGY = ['Bacayao Norte','Bacayao Sur','Barangay I (T. Bugallon)','Barangay II (Nueva)','Barangay IV (Zamora)','Bolosan','Bonuan Binloc','Bonuan Boquig','Bonuan Gueset','Calmay','Carael','Caranglaan','Herrero-Perez','Lasip Chico','Lasip Grande','Lomboy','Lucao','Malued','Mamalingling','Mangin','Mayombo','Pantal','Poblacion Oeste','Pogo Chico','Pogo Grande','Pugaro Suit','Salapingao','Salisay','Tambac','Tapuac','Tebeng'];

/* Sample reports (coordinates are approximate placeholders) */
const SAMPLES = [
  { id: 's1', kind: 'lost', name: 'White and brown dog', species: 'Dog', color: 'White and brown', brgy: 'Pantal', date: '2026-10-06', lat: 16.0465, lng: 120.3375, photo: 'img/Pet1.jpg' },
  { id: 's2', kind: 'lost', name: 'Tilapia cat', species: 'Cat', color: 'Grey', brgy: 'Lucao', date: '2026-10-05', lat: 16.0285, lng: 120.3465, photo: 'img/Pet3.jpg' },
  { id: 's3', kind: 'lost', name: 'Tabby cat', species: 'Cat', color: 'Tabby', brgy: 'Tapuac', date: '2026-10-03', lat: 16.0525, lng: 120.3305, photo: 'img/Pet4.jpg' }
];

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const ago = d => { const n = Math.round((new Date(today) - new Date(d)) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n + ' days ago'; };
const km = (a, b) => { const r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const allReports = () => SAMPLES.concat(read(REPORTS_KEY, []));
const pinIcon = k => L.divIcon({ className: '', html: `<div class="pin pin--${k}"><span>${k === 'lost' ? '🐾' : '🔍'}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -34] });
const tiles = m => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);

/* ---------- Session / sidebar ---------- */
const sess = read(SESSION_KEY, null);
if (REQUIRE_LOGIN && !sess) location.replace('index.html');
if (sess) {
  $('#user-name').textContent = sess.given_name || sess.name || 'Guest';
  if (sess.picture) { const a = $('#user-avatar'); a.src = sess.picture; a.hidden = false; }
}
$('#logout').addEventListener('click', () => { localStorage.removeItem(SESSION_KEY); location.href = 'index.html'; });
const side = $('#sidebar'), scrim = $('#scrim'), tgl = $('#side-toggle');
const setSide = open => { side.classList.toggle('open', open); scrim.classList.toggle('open', open); tgl.setAttribute('aria-expanded', open); };
tgl.addEventListener('click', () => setSide(!side.classList.contains('open')));
scrim.addEventListener('click', () => setSide(false));

/* ---------- Map view ---------- */
let me = null;
const map = L.map('map').setView(DAGUPAN, 13);
tiles(map);
const group = L.layerGroup().addTo(map);
let meMarker = null, ring = null;

function render(fit) {
  group.clearLayers();
  const val = $('#radius').value, origin = me || DAGUPAN, lim = val === 'all' ? Infinity : +val;
  if (ring) { map.removeLayer(ring); ring = null; }
  if (lim !== Infinity) ring = L.circle(origin, { radius: lim * 1000, color: '#0f6b3f', weight: 2, fillOpacity: .06, interactive: false }).addTo(map);
  const pts = [];
  allReports().forEach(r => {
    if (km(origin, [r.lat, r.lng]) > lim) return;
    pts.push([r.lat, r.lng]);
    const meta = [r.species, r.breed, r.color].filter(Boolean).join(' · ');
    L.marker([r.lat, r.lng], { icon: pinIcon(r.kind) }).addTo(group).bindPopup(
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
$('#radius').addEventListener('change', () => render(true));
$('#locate').addEventListener('click', locate);
locate();

/* ---------- Report forms ---------- */
const chips = (name, opts) => `<div class="chips">${opts.map(o => `<label><input type="radio" name="${name}" value="${o}" required><span>${o}</span></label>`).join('')}</div>`;

function formHTML(k) {
  const L_ = k === 'lost';
  return `
  <div class="view-head"><h1>${L_ ? 'File a lost pet report' : 'File a found pet report'}</h1>
    <p>${L_ ? 'Tell us about your pet and where it was last seen. We will compare it with found reports nearby.' : 'Found a pet that might belong to someone? Describe it and drop a pin where you found it.'}</p></div>
  <div class="box"><form class="form" novalidate>
    <label class="drop full"><b>Add a clear photo of the pet</b><span class="hint">Tap to upload (JPG or PNG)</span>
      <input type="file" name="photo" accept="image/*" required></label>
    <fieldset class="full"><legend>Species</legend>${chips('species', ['Dog', 'Cat', 'Other'])}</fieldset>
    ${L_ ? '<div><label for="' + k + '-name">Pet\'s name</label><input type="text" id="' + k + '-name" name="name" maxlength="40"></div>' : ''}
    <div><label for="${k}-breed">Breed</label><input type="text" id="${k}-breed" name="breed" maxlength="40" placeholder="Unknown or mixed is fine"></div>
    <div><label for="${k}-color">Main color</label><input type="text" id="${k}-color" name="color" maxlength="40" required></div>
    <fieldset><legend>Size</legend>${chips('size', ['Small', 'Medium', 'Large'])}</fieldset>
    <div class="full"><label for="${k}-marks">Markings and other details</label><textarea id="${k}-marks" name="markings" rows="3" maxlength="300" placeholder="Collar, scars, spots, behavior&hellip;"></textarea></div>
    <div><label for="${k}-brgy">Barangay</label><select id="${k}-brgy" name="brgy" required><option value="">Select&hellip;</option>${BRGY.map(b => `<option>${b}</option>`).join('')}</select></div>
    <div><label for="${k}-date">${L_ ? 'Date last seen' : 'Date found'}</label><input type="date" id="${k}-date" name="date" value="${today}" max="${today}" required></div>
    ${L_ ? `<div><label for="lost-zone">Search zone (geofence)</label><select id="lost-zone" name="zone"><option value="500">500 m</option><option value="1000" selected>1 km</option><option value="2000">2 km</option><option value="5000">5 km</option></select></div>`
         : `<div><label for="found-where">Where is the pet now?</label><select id="found-where" name="where"><option>With me</option><option>At a shelter or vet</option><option>Left where I found it</option></select></div>`}
    <div><label for="${k}-contact">Contact (phone or email)</label><input type="text" id="${k}-contact" name="contact" maxlength="80" required value="${esc(sess?.email || '')}"></div>
    <div class="full"><label>${L_ ? 'Where was it last seen?' : 'Where did you find it?'}</label>
      <div class="pick"></div>
      <p class="hint pick-hint">Tap the map to drop a pin${L_ ? '. The red circle is your search zone' : ''}, or <button type="button" class="btn btn-small locate-pin">use my current location</button></p>
      <input type="hidden" name="lat"><input type="hidden" name="lng"></div>
    <p class="form-note error full err" role="alert"></p>
    <div class="full"><button type="submit" class="btn btn-sun">${L_ ? 'Submit lost report' : 'Submit found report'}</button></div>
  </form>
  <div class="done" hidden><h2>Report filed</h2><p style="margin-inline:auto">${L_ ? 'Your lost pet report is now on the map.' : 'Thank you! Your found report is now on the map.'}</p>
    <div class="actions"><a href="#map" class="btn btn-sun">View on map</a><button type="button" class="btn btn-small again">File another</button></div></div></div>`;
}

const pickers = {};
function setupForm(k) {
  const host = $('#view-' + k), form = host.querySelector('form'), err = host.querySelector('.err');
  const m = L.map(host.querySelector('.pick')).setView(me || DAGUPAN, 15);
  tiles(m);
  const zone = form.elements.zone;
  let pin = null, circle = null, photo = '';
  const draw = () => {
    const ll = pin.getLatLng();
    form.elements.lat.value = ll.lat; form.elements.lng.value = ll.lng;
    if (zone) { if (circle) circle.setLatLng(ll).setRadius(+zone.value); else circle = L.circle(ll, { radius: +zone.value, color: '#d93636', weight: 2, fillOpacity: .1, interactive: false }).addTo(m); }
  };
  const put = (ll, pan) => {
    if (!pin) { pin = L.marker(ll, { draggable: true, icon: pinIcon(k) }).addTo(m); pin.on('drag', draw); }
    else pin.setLatLng(ll);
    draw(); if (pan) m.setView(ll, 16);
  };
  m.on('click', e => put(e.latlng));
  zone?.addEventListener('change', () => pin && draw());
  host.querySelector('.locate-pin').addEventListener('click', () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(p => put(L.latLng(p.coords.latitude, p.coords.longitude), true), () => { err.textContent = 'Could not get your location. Tap the map instead.'; });
  });

  /* Photo: preview + downscale so it fits in browser storage */
  const drop = form.querySelector('.drop');
  form.elements.photo.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 900 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = img.width * s; c.height = img.height * s;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      photo = c.toDataURL('image/jpeg', .75);
      drop.querySelector('img')?.remove();
      const p = new Image(); p.src = photo; p.alt = 'Selected photo'; drop.prepend(p);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });

  form.addEventListener('submit', e => {
    e.preventDefault(); err.textContent = '';
    if (!form.checkValidity()) { form.reportValidity(); return; }
    if (!photo) { err.textContent = 'Please add a photo of the pet.'; return; }
    if (!pin) { err.textContent = 'Please drop a pin on the map.'; return; }
    const f = new FormData(form);
    const r = { id: 'u' + Date.now(), kind: k, species: f.get('species'), size: f.get('size'), name: f.get('name') || '', breed: f.get('breed'), color: f.get('color'), markings: f.get('markings'), brgy: f.get('brgy'), date: f.get('date'), contact: f.get('contact'), lat: +f.get('lat'), lng: +f.get('lng'), photo, created: Date.now() };
    try { localStorage.setItem(REPORTS_KEY, JSON.stringify(read(REPORTS_KEY, []).concat(r))); }
    catch { err.textContent = 'Could not save this report (browser storage is full).'; return; }
    form.hidden = true; host.querySelector('.done').hidden = false;
    render(false); window.scrollTo(0, 0);
  });

  host.querySelector('.again').addEventListener('click', () => {
    form.reset(); photo = ''; drop.querySelector('img')?.remove();
    if (pin) { m.removeLayer(pin); pin = null; } if (circle) { m.removeLayer(circle); circle = null; }
    form.hidden = false; host.querySelector('.done').hidden = true;
  });
  return m;
}

/* ---------- Views ---------- */
['lost', 'found'].forEach(k => { $('#view-' + k).innerHTML = formHTML(k); });
function show() {
  const v = ['map', 'lost', 'found'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'map';
  document.querySelectorAll('.view').forEach(s => s.hidden = s.id !== 'view-' + v);
  document.querySelectorAll('.side-nav a').forEach(a => {
    if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  if (v === 'map') map.invalidateSize();
  else { (pickers[v] ||= setupForm(v)).invalidateSize(); }
  setSide(false); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', show);
show();