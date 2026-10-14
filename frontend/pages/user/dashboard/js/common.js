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
/* TunTon only covers Dagupan City. The city profile puts it at 16°01'–16°07' N, 120°18'–120°23' E;
   a small margin is added so the coast and the edge barangays are never clipped. [[south, west], [north, east]] */
const DAGUPAN_BOUNDS = [[16.005, 120.290], [16.125, 120.395]];
const inDagupan = (lat, lng) => lat >= DAGUPAN_BOUNDS[0][0] && lat <= DAGUPAN_BOUNDS[1][0] && lng >= DAGUPAN_BOUNDS[0][1] && lng <= DAGUPAN_BOUNDS[1][1];
/* Approximate outline of Dagupan City [lat, lng], clockwise from the north-west coast.
   It is hand-drawn from the city's published extent, NOT surveyed data. To make it exact, replace these points
   with the city boundary from an official/OpenStreetMap GeoJSON (swap each [lng, lat] pair to [lat, lng]). */
const DAGUPAN_OUTLINE = [[16.0950,120.3180],[16.1000,120.3330],[16.0990,120.3480],[16.0900,120.3600],[16.0780,120.3760],[16.0620,120.3830],[16.0450,120.3780],[16.0300,120.3700],[16.0200,120.3600],[16.0170,120.3450],[16.0200,120.3300],[16.0180,120.3150],[16.0300,120.3050],[16.0450,120.3000],[16.0600,120.3050],[16.0750,120.3100]];
const BRGY = ['Bacayao Norte','Bacayao Sur','Barangay I (T. Bugallon)','Barangay II (Nueva)','Barangay IV (Zamora)','Bolosan','Bonuan Binloc','Bonuan Boquig','Bonuan Gueset','Calmay','Carael','Caranglaan','Herrero-Perez','Lasip Chico','Lasip Grande','Lomboy','Lucao','Malued','Mamalingling','Mangin','Mayombo','Pantal','Poblacion Oeste','Pogo Chico','Pogo Grande','Pugaro Suit','Salapingao','Salisay','Tambac','Tapuac','Tebeng'];

/* Sample reports (coordinates are approximate placeholders) */
const SAMPLES = [
  { id: 's1', kind: 'lost', ownerName: 'Rosa Villanueva', name: 'White and brown dog', species: 'Dog', breed: 'Mixed breed', color: 'White and brown', size: 'Medium', markings: 'Brown patches on the back and ears, red collar', description: 'Slipped out of the gate on the evening of Oct 6 when the delivery rider left it open. Very friendly with people, but may hide under parked vehicles if scared. Answers to "Browny".', brgy: 'Pantal', date: '2026-10-06', lat: 16.0465, lng: 120.3375, zone: 1000, contact: '0917 123 4567', photo: IMG + 'Pet1.jpg', created: Date.parse('2026-10-06T08:00:00') },
  { id: 's2', kind: 'lost', ownerName: 'Mark Dizon', name: 'Tilapia cat', species: 'Cat', breed: 'Domestic shorthair', color: 'Grey', size: 'Small', markings: 'Grey coat, lighter belly, no collar', description: 'Went out through a window left open in the afternoon. Very vocal and usually comes when called by name. Indoor cat, so it may be frightened and hiding nearby.', brgy: 'Lucao', date: '2026-10-05', lat: 16.0285, lng: 120.3465, zone: 1000, contact: 'owner.lucao@example.com', photo: IMG + 'Pet3.jpg', created: Date.parse('2026-10-05T08:00:00') },
  { id: 's3', kind: 'lost', ownerName: 'Liza Fernandez', name: 'Tabby cat', species: 'Cat', breed: '', color: 'Tabby', size: 'Small', markings: 'Orange-brown stripes, white paws, notch on left ear', description: 'Last seen leaving the yard at dusk. Shy with strangers, but will eat if food is left out quietly. Please do not chase it; call the owner instead.', brgy: 'Tapuac', date: '2026-10-03', lat: 16.0525, lng: 120.3305, zone: 500, contact: '0928 555 0199', photo: IMG + 'Pet4.jpg', created: Date.parse('2026-10-03T08:00:00') }
];

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Species shown to people: for "Other" pets this is the animal the user typed (e.g. Rabbit). */
const speciesOf = r => (r.species === 'Other' && r.otherSpecies) ? r.otherSpecies : (r.species || '');
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
/* The mirror image: a FOUND report can collect "lost report" claims from people who say it is their pet.
   Each claim is { id, by, ownerName, status, species, name, breed, color, size, markings, description,
   brgy, date, lat, lng, zone, contact, facebook, photos, at }. Only the finder (owner of the found report)
   can confirm one. A claim never creates a lost report of its own. */
const claimsOf = r => Array.isArray(r.claims) ? r.claims : [];
const confirmedClaim = r => claimsOf(r).find(c => c.status === 'confirmed') || null;
/* The response (found report / lost report) that the CURRENT user already sent and that is still waiting.
   While one exists the buttons say "Edit my ..." and open it for editing, instead of filing another. */
const myPendingFind = r => findsOf(r).find(f => f.by === myId && f.status === 'pending') || null;
const myPendingClaim = r => claimsOf(r).find(c => c.by === myId && c.status === 'pending') || null;
/* The "respond" button for a report, the same everywhere (cards, detail page, map panel):
   yellow  = start something new   (I found this pet / This is my lost pet)
   mint    = you already did it    (Edit my found report / Edit my lost report) */
const respondButton = (r, attrs = '') => {
  const lost = r.kind === 'lost', mine = lost ? myPendingFind(r) : myPendingClaim(r);
  const href = (lost ? 'found.html?match=' : 'lost.html?claim=') + encodeURIComponent(r.id);
  return mine
    ? `<a class="btn btn-edit" ${attrs} href="${href}&update=1">Edit my ${lost ? 'found' : 'lost'} report</a>`
    : `<a class="btn btn-sun" ${attrs} href="${href}">${lost ? 'I found this pet' : 'This is my lost pet'}</a>`;
};
/* ---------- Distance from the person's current location ---------- */
const distText = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km';
/* Asked once per browser tab (the answer is kept in sessionStorage); resolves to [lat, lng] or null
   when location is blocked or unavailable, in which case no distance is shown. */
let _here = null;
const whereAmI = () => _here || (_here = new Promise(done => {
  try { const c = JSON.parse(sessionStorage.getItem('tunton_here')); if (Array.isArray(c) && c.length === 2) return done(c); } catch { /* ignore */ }
  if (!navigator.geolocation) return done(null);
  navigator.geolocation.getCurrentPosition(p => {
    const here = [p.coords.latitude, p.coords.longitude];
    try { sessionStorage.setItem('tunton_here', JSON.stringify(here)); } catch { /* ignore */ }
    done(here);
  }, () => done(null), { maximumAge: 300000, timeout: 8000 });
}));
/* "1.2 km away" for a report, or '' when the location is unknown. */
const awayText = (here, r) => here && isFinite(r.lat) && isFinite(r.lng) ? distText(km(here, [r.lat, r.lng])) + ' away' : '';
const reportState = r => r.kind === 'lost' && confirmedFind(r) ? 'found' : r.kind;
const isOwner = r => !!r.owner && r.owner === myId;
/* Save one report (a sample is copied into storage the first time it changes). Throws if storage is full. */
const saveReport = u => {
  const saved = read(REPORTS_KEY, []), has = saved.some(x => x.id === u.id);
  localStorage.setItem(REPORTS_KEY, JSON.stringify(has ? saved.map(x => x.id === u.id ? u : x) : saved.concat(u)));
};

/* Map helpers (only used on pages that load Leaflet) */
/* Locks a Leaflet map to Dagupan City: it cannot be dragged outside the city, and it cannot be
   zoomed out further than the whole city (re-checked whenever the map changes size). */
const lockToDagupan = map => {
  map.setMaxBounds(DAGUPAN_BOUNDS);
  map.options.maxBoundsViscosity = 1;      // 1 = a hard wall, not a rubber band
  const fit = () => { const sz = map.getSize(); if (sz.x && sz.y) map.setMinZoom(map.getBoundsZoom(DAGUPAN_BOUNDS)); };
  fit(); map.on('resize', fit);
};
/* Highlights Dagupan City: everything outside the outline is dimmed, and the city itself gets a green outline + light tint. */
const highlightDagupan = map => {
  const world = [[-90, -180], [-90, 180], [90, 180], [90, -180]];
  L.polygon([world, DAGUPAN_OUTLINE], { stroke: false, fillColor: '#1d2b24', fillOpacity: .45, interactive: false }).addTo(map);
  const city = L.polygon(DAGUPAN_OUTLINE, { color: '#0f6b3f', weight: 3, dashArray: '8 6', fillColor: '#0f6b3f', fillOpacity: .07, interactive: false }).addTo(map);
  city.bindTooltip('Dagupan City', { permanent: true, direction: 'center', className: 'city-label' });
  return city;
};
/* Small line icons used instead of emoji (decorative, so hidden from screen readers). */
const ico = d => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  pin: ico('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>'),
  calendar: ico('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
  check: ico('<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>'),
  bell: ico('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  phone: ico('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/>'),
  mail: ico('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 7L2 7"/>'),
  user: ico('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  paw: ico('<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.05Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>'),
  info: ico('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  doc: ico('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>'),
  map: ico('<path d="M9 3 3 5v16l6-2 6 2 6-2V3l-6 2Z"/><path d="M9 3v16M15 5v16"/>'),
  more: ico('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'),
  edit: ico('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  trash: ico('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m19 6-1 14H6L5 6"/><path d="M10 10v6M14 10v6"/>'),
  facebook: ico('<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3Z"/>'),
  lock: ico('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  search: ico('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>')
};

/* Owner / finder contact card. Shown at the TOP of a report because it is the most important detail.
   It only DISPLAYS the details (name, number, email, barangay): this is a PWA, so there are no call/email buttons.
   A report stores one `contact` string, so it is split here into a phone number and an email. */
const splitContact = c => {
  const text = String(c || ''), email = (text.match(/[^\s,;/|]+@[^\s,;/|]+/) || [''])[0];
  const rest = text.replace(email, '').replace(/^[\s,;/|]+|[\s,;/|]+$/g, '');
  const phone = rest.replace(/\D/g, '').length >= 7 ? rest : '';
  return { email, phone, other: phone ? '' : rest };
};
/* Turns what someone typed ("facebook.com/juan", "@juan", a full link) into a safe Facebook link.
   Only facebook.com / fb.com / fb.me links are accepted. Text that can't be a link (e.g. "Juan Dela Cruz") is shown as plain text. */
const facebookLink = v => {
  let t = String(v || '').trim().replace(/^@/, '');
  if (!t) return null;
  if (/\s/.test(t) && !/^https?:\/\//i.test(t)) return { url: '', text: t };
  if (!/^https?:\/\//i.test(t)) t = /^((www\.|m\.|web\.)?(facebook|fb)\.com|fb\.me)\//i.test(t) ? 'https://' + t : 'https://www.facebook.com/' + t;
  try {
    const u = new URL(t), host = u.hostname.replace(/^(www|m|web)\./i, '').toLowerCase();
    if (!['facebook.com', 'fb.com', 'fb.me'].includes(host) || !/^https?:$/.test(u.protocol)) return { url: '', text: String(v).trim() };
    return { url: u.href, text: (host + u.pathname + u.search).replace(/\/$/, '') };
  } catch { return { url: '', text: String(v).trim() }; }
};
const facebookHTML = v => {
  const fb = facebookLink(v);
  if (!fb) return '';
  return fb.url ? `<a class="cc-link" href="${esc(fb.url)}" target="_blank" rel="noopener noreferrer" title="Open Facebook profile">${esc(fb.text)}</a>` : esc(fb.text);
};

/* Owner / finder card, at the TOP of a report because it is the most important detail.
   The title is the person's name, with their role and the date the report was posted underneath.
   It only DISPLAYS details (this is a PWA, so no call/email buttons); Facebook is a normal link. */
const contactCardHTML = (r, role) => {
  const { email, phone, other } = splitContact(r.contact);
  const name = r.ownerName || userInfo(r.owner).name || '';
  const picture = r.ownerPicture || userInfo(r.owner).picture || '';
  const posted = r.created ? new Date(r.created).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const row = (icon, label, html) => `<div class="cc-row"><dt>${icon}<span>${label}</span></dt><dd class="${html ? '' : 'cc-missing'}">${html || 'Not provided'}</dd></div>`;
  return `<section class="contact-card" aria-label="${esc(role)} details">
    <header class="cc-head"><span class="cc-avatar" aria-hidden="true">${esc((name || role)[0].toUpperCase())}${picture ? `<img src="${esc(picture)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</span><div><h2 class="cc-title">${esc(name || role)}</h2><p class="cc-note">${esc(role)}${posted ? ' &middot; Posted ' + esc(posted) : ''}</p></div></header>
    <dl class="cc-list">
      ${row(ICON.phone, 'Contact no.', esc(phone))}
      ${row(ICON.mail, 'Email', esc(email))}
      ${row(ICON.facebook, 'Facebook', facebookHTML(r.facebook))}
      ${row(ICON.pin, 'Barangay', esc(r.brgy || ''))}
      ${other ? row(ICON.info, 'Other contact', esc(other)) : ''}
    </dl></section>`;
};

const pinIcon = k => L.divIcon({ className: '', html: `<div class="pin pin--${k}"><span>${k === 'lost' ? ICON.paw : ICON.search}</span></div>`, iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -34] });
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
/* The profile (display name, picture, phone...) belongs to ONE account, so it is stored
   under that account's id. (The old shared key 'tunton_profile' is no longer read.) */
const profileKey = id => PROFILE_KEY + ':' + id;
const prof = () => read(profileKey(myId), {});
const myId = sess?.sub || 'guest';
const shownName = () => prof().dname || sess?.given_name || sess?.name || 'Guest';
/* Local stand-in for the users table: remembers each account's name and Google picture,
   so a report card can show who filed it. (With the backend, the API sends owner_name and
   owner_picture and this is no longer needed.) */
const USERS_KEY = 'tunton_users';
const readUsers = () => read(USERS_KEY, {});
const rememberMe = () => {
  if (!sess) return;
  const users = readUsers(), entry = { name: shownName(), picture: sess.picture || '' };
  if (JSON.stringify(users[myId]) === JSON.stringify(entry)) return;
  try { localStorage.setItem(USERS_KEY, JSON.stringify({ ...users, [myId]: entry })); } catch { /* storage full */ }
};
/* Name and picture of any account known on this browser (their own profile wins). */
const userInfo = id => {
  const known = (id && readUsers()[id]) || {}, own = id ? read(profileKey(id), {}) : {};
  return { name: own.dname || known.name || '', picture: own.picture || known.picture || '' };
};
rememberMe();

const applyIdentity = () => {
  rememberMe();
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
  const customPicture = prof().picture;
  if (customPicture || sess?.picture) { const a = $('#user-avatar'); a.src = customPicture || sess.picture; a.hidden = false; $('#user-initial').hidden = true; }
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