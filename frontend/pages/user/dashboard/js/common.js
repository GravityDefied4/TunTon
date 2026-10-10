/* =========================================================
   TunTon dashboard: code shared by every page.
   Each page loads this file first, then its own script.
   ========================================================= */

/* Set to true to send logged-out visitors back to the home page. */
const REQUIRE_LOGIN = false;

/* Paths are relative to this dashboard folder.
   Change them if your project is laid out differently. */
const HOME = '../../../index.html';
const IMG = '../../../assets/img/';

const SESSION_KEY = 'tunton_session', REPORTS_KEY = 'tunton_reports', PROFILE_KEY = 'tunton_profile';
const DAGUPAN = [16.0433, 120.3339];
const BRGY = ['Bacayao Norte','Bacayao Sur','Barangay I (T. Bugallon)','Barangay II (Nueva)','Barangay IV (Zamora)','Bolosan','Bonuan Binloc','Bonuan Boquig','Bonuan Gueset','Calmay','Carael','Caranglaan','Herrero-Perez','Lasip Chico','Lasip Grande','Lomboy','Lucao','Malued','Mamalingling','Mangin','Mayombo','Pantal','Poblacion Oeste','Pogo Chico','Pogo Grande','Pugaro Suit','Salapingao','Salisay','Tambac','Tapuac','Tebeng'];

/* Sample reports (coordinates are approximate placeholders) */
const SAMPLES = [
  { id: 's1', kind: 'lost', name: 'White and brown dog', species: 'Dog', color: 'White and brown', brgy: 'Pantal', date: '2026-10-06', lat: 16.0465, lng: 120.3375, photo: IMG + 'Pet1.jpg' },
  { id: 's2', kind: 'lost', name: 'Tilapia cat', species: 'Cat', color: 'Grey', brgy: 'Lucao', date: '2026-10-05', lat: 16.0285, lng: 120.3465, photo: IMG + 'Pet3.jpg' },
  { id: 's3', kind: 'lost', name: 'Tabby cat', species: 'Cat', color: 'Tabby', brgy: 'Tapuac', date: '2026-10-03', lat: 16.0525, lng: 120.3305, photo: IMG + 'Pet4.jpg' }
];

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const ago = d => { const n = Math.round((new Date(today) - new Date(d)) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n + ' days ago'; };
const niceDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const km = (a, b) => { const r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
const allReports = () => SAMPLES.concat(read(REPORTS_KEY, [])).filter(r => r.status !== 'reunited');

/* Map helpers (only used on pages that load Leaflet) */
const pinIcon = k => L.divIcon({ className: '', html: `<div class="pin pin--${k}"><span>${k === 'lost' ? '🐾' : '🔍'}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -34] });
const tiles = m => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);

/* ---------- Session / profile ---------- */
const sess = read(SESSION_KEY, null);
if (REQUIRE_LOGIN && !sess) location.replace(HOME);
const prof = () => read(PROFILE_KEY, {});
const myId = sess?.sub || 'guest';
const shownName = () => prof().dname || sess?.given_name || sess?.name || 'Guest';
const applyIdentity = () => {
  $('#user-name').textContent = shownName();
  $('#user-initial').textContent = shownName()[0].toUpperCase();
};

applyIdentity();
if (sess?.picture) { const a = $('#user-avatar'); a.src = sess.picture; a.hidden = false; $('#user-initial').hidden = true; }
$('#logout').addEventListener('click', () => { localStorage.removeItem(SESSION_KEY); location.href = HOME; });

/* ---------- Sidebar (mobile drawer) ---------- */
const side = $('#sidebar'), scrim = $('#scrim'), tgl = $('#side-toggle');
const setSide = open => { side.classList.toggle('open', open); scrim.classList.toggle('open', open); tgl.setAttribute('aria-expanded', open); };
tgl.addEventListener('click', () => setSide(!side.classList.contains('open')));
scrim.addEventListener('click', () => setSide(false));

/* ---------- Sidebar: minimize to icons only (desktop) ---------- */
const SIDE_KEY = 'tunton_side';
const collapseBtn = $('#side-collapse');
const syncCollapse = () => {
  const min = document.documentElement.classList.contains('side-min');
  const label = min ? 'Expand sidebar' : 'Collapse sidebar';
  collapseBtn.setAttribute('aria-expanded', String(!min));
  collapseBtn.setAttribute('aria-label', label);
  collapseBtn.title = label;
};
collapseBtn.addEventListener('click', () => {
  const min = document.documentElement.classList.toggle('side-min');
  try { localStorage.setItem(SIDE_KEY, min ? 'min' : 'full'); } catch { /* storage unavailable */ }
  syncCollapse();
});
syncCollapse();