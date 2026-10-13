/* =========================================================
   TunTon dashboard: code shared by every page.
   Each page loads this file first, then its own script.
   ========================================================= */

/* Logged-out visitors (or expired sessions) are sent back to the home page. */
const REQUIRE_LOGIN = true;

/* Paths are relative to this dashboard folder.
   Change them if your project is laid out differently. */
const HOME = '../../../index.html';
const IMG = '../../../assets/img/';

const SESSION_KEY = 'tunton_session', REPORTS_KEY = 'tunton_reports', PROFILE_KEY = 'tunton_profile';
const DAGUPAN = [16.0433, 120.3339];
const BRGY = ['Bacayao Norte','Bacayao Sur','Barangay I (T. Bugallon)','Barangay II (Nueva)','Barangay IV (Zamora)','Bolosan','Bonuan Binloc','Bonuan Boquig','Bonuan Gueset','Calmay','Carael','Caranglaan','Herrero-Perez','Lasip Chico','Lasip Grande','Lomboy','Lucao','Malued','Mamalingling','Mangin','Mayombo','Pantal','Poblacion Oeste','Pogo Chico','Pogo Grande','Pugaro Suit','Salapingao','Salisay','Tambac','Tapuac','Tebeng'];

/* Sample reports (coordinates are approximate placeholders) */
const SAMPLES = [
  { id: 's1', kind: 'lost', name: 'White and brown dog', species: 'Dog', breed: 'Mixed breed', color: 'White and brown', size: 'Medium', markings: 'Brown patches on the back and ears, red collar', description: 'Slipped out of the gate on the evening of Oct 6 when the delivery rider left it open. Very friendly with people, but may hide under parked vehicles if scared. Answers to "Browny".', brgy: 'Pantal', date: '2026-10-06', lat: 16.0465, lng: 120.3375, zone: 1000, contact: '0917 123 4567', photo: IMG + 'Pet1.jpg', created: Date.parse('2026-10-06T08:00:00') },
  { id: 's2', kind: 'lost', name: 'Tilapia cat', species: 'Cat', breed: 'Domestic shorthair', color: 'Grey', size: 'Small', markings: 'Grey coat, lighter belly, no collar', description: 'Went out through a window left open in the afternoon. Very vocal and usually comes when called by name. Indoor cat, so it may be frightened and hiding nearby.', brgy: 'Lucao', date: '2026-10-05', lat: 16.0285, lng: 120.3465, zone: 1000, contact: 'owner.lucao@example.com', photo: IMG + 'Pet3.jpg', created: Date.parse('2026-10-05T08:00:00') },
  { id: 's3', kind: 'lost', name: 'Tabby cat', species: 'Cat', breed: '', color: 'Tabby', size: 'Small', markings: 'Orange-brown stripes, white paws, notch on left ear', description: 'Last seen leaving the yard at dusk. Shy with strangers, but will eat if food is left out quietly. Please do not chase it; call the owner instead.', brgy: 'Tapuac', date: '2026-10-03', lat: 16.0525, lng: 120.3305, zone: 500, contact: '0928 555 0199', photo: IMG + 'Pet4.jpg', created: Date.parse('2026-10-03T08:00:00') }
];

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const read = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const ago = d => { const n = Math.round((new Date(today) - new Date(d)) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n + ' days ago'; };
const niceDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const km = (a, b) => { const r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
/* Saved reports win over a sample with the same id (this is how a sample lost report gets updated). */
const mergedReports = () => { const saved = read(REPORTS_KEY, []), ids = new Set(saved.map(r => r.id)); return SAMPLES.filter(s => !ids.has(s.id)).concat(saved); };
const allReports = () => mergedReports().filter(r => r.status !== 'reunited');
/* A lost report can collect several "found" reports (finds). Each find is
   { id, by, contact, where, brgy, date, lat, lng, markings, photos, at, status }
   where status is 'pending' | 'confirmed' | 'rejected'. Only the owner of the lost report
   can confirm one. The report shows as "found" once a find is confirmed. */
const findsOf = r => Array.isArray(r.finds) ? r.finds : (r.found ? [{ ...r.found, id: 'legacy', status: 'pending' }] : []);
const confirmedFind = r => findsOf(r).find(f => f.status === 'confirmed') || null;
const reportState = r => r.kind === 'lost' && confirmedFind(r) ? 'found' : r.kind;
const isOwner = r => !!r.owner && r.owner === myId;
/* Save one report (a sample is copied into storage the first time it changes). Throws if storage is full. */
const saveReport = u => {
  const saved = read(REPORTS_KEY, []), has = saved.some(x => x.id === u.id);
  localStorage.setItem(REPORTS_KEY, JSON.stringify(has ? saved.map(x => x.id === u.id ? u : x) : saved.concat(u)));
};

/* Map helpers (only used on pages that load Leaflet) */
const pinIcon = k => L.divIcon({ className: '', html: `<div class="pin pin--${k}"><span>${k === 'lost' ? '🐾' : '🔍'}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -34] });
const tiles = m => L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);

/* ---------- Session / profile ---------- */
const logout = () => { localStorage.removeItem(SESSION_KEY); location.replace(HOME); };
const readSession = () => {
  const s = read(SESSION_KEY, null);
  if (!s?.token) return null;
  try {
    const { exp } = JSON.parse(atob(s.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return exp * 1000 > Date.now() ? s : null;
  } catch { return null; }
};
const sess = readSession();
if (REQUIRE_LOGIN && !sess) logout();

/* fetch() that attaches the JWT and logs out on 401 (token expired, revoked or account suspended). */
const API_BASE = window.TUNTON?.API_BASE ?? '/api';
const authFetch = async (path, opts = {}) => {
  const res = await fetch(API_BASE + path, { ...opts, headers: { ...opts.headers, Authorization: 'Bearer ' + sess?.token } });
  if (res.status === 401) logout();
  return res;
};

/* Confirm the session with the server (a suspended or deleted account is signed out).
   If the server can't be reached the page keeps working with the stored session. */
if (sess) authFetch('/auth/me').catch(() => {});
const prof = () => read(PROFILE_KEY, {});
const myId = sess?.sub || 'guest';
const shownName = () => prof().dname || sess?.given_name || sess?.name || 'Guest';
const applyIdentity = () => {
  const name = $('#user-name'), initial = $('#user-initial');
  if (!name || !initial) return; /* sidebar not on the page yet */
  name.textContent = shownName();
  initial.textContent = shownName()[0].toUpperCase();
};

/* Everything below touches the sidebar, which sidebar.js loads from
   sidebar.html, so it has to wait until the sidebar is on the page. */
(window.sidebarReady || Promise.resolve(false)).then(ok => {
  if (!ok) return;

  applyIdentity();
  if (sess?.picture) { const a = $('#user-avatar'); a.src = sess.picture; a.hidden = false; $('#user-initial').hidden = true; }
  $('#logout').addEventListener('click', logout);

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
});