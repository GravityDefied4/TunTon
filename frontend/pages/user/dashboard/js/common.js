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
/* Outline of Dagupan City [lat, lng]: LAND ONLY (it follows the coast, not the Lingayen Gulf).
   Source: OpenStreetMap city boundary (relation 13001749), simplified to 74 points. Data (c) OpenStreetMap contributors, ODbL. */
const DAGUPAN_OUTLINE = [[16.108713,120.373904],[16.098833,120.375877],[16.090192,120.371005],[16.089918,120.369268],[16.086719,120.364111],[16.080542,120.362541],[16.071495,120.367873],[16.067055,120.357617],[16.063304,120.355135],[16.058774,120.35533],[16.051914,120.360844],[16.050346,120.366864],[16.04972,120.367463],[16.047185,120.370305],[16.046678,120.371358],[16.041286,120.377326],[16.041266,120.37737],[16.041116,120.377536],[16.023202,120.377899],[16.022426,120.377139],[16.019752,120.370356],[16.019731,120.369971],[16.02002,120.367089],[16.022002,120.361194],[16.021314,120.35864],[16.020994,120.356296],[16.020995,120.356086],[16.021247,120.354533],[16.018139,120.346593],[16.014487,120.343284],[16.014363,120.340826],[16.017043,120.331529],[16.016955,120.329396],[16.009353,120.322529],[16.008933,120.319265],[16.016487,120.314592],[16.022726,120.313578],[16.026501,120.314928],[16.029096,120.311144],[16.03445,120.308035],[16.037113,120.307596],[16.042249,120.304292],[16.042356,120.304265],[16.046226,120.301464],[16.046665,120.301454],[16.050121,120.299982],[16.051681,120.299605],[16.059238,120.29875],[16.059555,120.300026],[16.061251,120.301666],[16.061195,120.303337],[16.062889,120.305862],[16.063749,120.309998],[16.06539,120.312469],[16.06625,120.316666],[16.069555,120.323303],[16.06875,120.328308],[16.070833,120.33036],[16.0725,120.329559],[16.076666,120.329582],[16.078306,120.330391],[16.080389,120.332497],[16.082111,120.336609],[16.089556,120.349976],[16.089556,120.350807],[16.091249,120.352531],[16.091249,120.354111],[16.097918,120.362503],[16.097918,120.363281],[16.108305,120.373779]];
/* Is this point on Dagupan's land? (point-in-polygon test; the sea is NOT inside, so reports cannot be filed on water.) */
const inDagupan = (lat, lng) => {
  let inside = false;
  for (let i = 0, j = DAGUPAN_OUTLINE.length - 1; i < DAGUPAN_OUTLINE.length; j = i++) {
    const [yi, xi] = DAGUPAN_OUTLINE[i], [yj, xj] = DAGUPAN_OUTLINE[j];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const BRGY = ['Bacayao Norte','Bacayao Sur','Barangay I (T. Bugallon)','Barangay II (Nueva)','Barangay IV (Zamora)','Bolosan','Bonuan Binloc','Bonuan Boquig','Bonuan Gueset','Calmay','Carael','Caranglaan','Herrero-Perez','Lasip Chico','Lasip Grande','Lomboy','Lucao','Malued','Mamalingling','Mangin','Mayombo','Pantal','Poblacion Oeste','Pogo Chico','Pogo Grande','Pugaro Suit','Salapingao','Salisay','Tambac','Tapuac','Tebeng'];

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Species shown to people: for "Other" pets this is the animal the user typed (e.g. Rabbit). */
const speciesOf = r => (r.species === 'Other' && r.otherSpecies) ? r.otherSpecies : (r.species || '');
const petSexLabel = sex => ({ male: 'Male', female: 'Female', unknown: 'Unknown' }[String(sex || '').toLowerCase()] || '');
const read = (k, f) => { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } };
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const ago = d => { const n = Math.round((new Date(today) - new Date(d)) / 864e5); return n <= 0 ? 'Today' : n === 1 ? 'Yesterday' : n + ' days ago'; };
const niceDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const km = (a, b) => { const r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]); const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
/* Reports come ONLY from the database (GET /api/reports). There is no sample data and nothing is read
   from localStorage. The list is loaded once per page into _reportCache (see loadReports below);
   code that needs it right away must `await reportsReady` first. */
let _reportCache = [];
const mergedReports = () => _reportCache;
const allReports = () => _reportCache.filter(r => r.status !== 'reunited');
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
  const href = (lost ? 'add-report.html?match=' : 'add-report.html?claim=') + encodeURIComponent(r.id);
  /* The owner rejected my response: the server allows only one claim per person per report, so no button. */
  if (!mine && (lost ? findsOf(r) : claimsOf(r)).some(c => c.by === myId && c.status === 'rejected'))
    return `<span class="pet-status" ${attrs}>Marked not a match</span>`;
  return mine
    ? `<a class="btn btn-edit" ${attrs} href="${href}&update=1">Edit my ${lost ? 'found' : 'lost'} report</a>`
    : `<a class="btn btn-sun" ${attrs} href="${href}">${lost ? 'I found this pet' : 'This is my lost pet'}</a>`;
};
/* ---------- Current location ----------
   Browsers only allow GPS on https:// pages or localhost, so over plain-http port forwarding (or a LAN address)
   navigator.geolocation is blocked. In that case, or when GPS fails for another reason, fall back to an approximate
   location from the visitor's IP (GET /api/geo/ip). A person who clicks "Block" is respected: no fallback.
   Resolves { lat, lng, approx } (approx = true for the IP estimate) or null. */
const getPosition = (opts = {}) => new Promise(resolve => {
  const viaIp = async () => {
    try {
      const j = await (await fetch((window.TUNTON?.API_BASE ?? '/api') + '/geo/ip')).json();
      resolve(j.success ? { lat: j.data.lat, lng: j.data.lng, approx: true } : null);
    } catch { resolve(null); }
  };
  if (!navigator.geolocation || !window.isSecureContext) return viaIp();
  navigator.geolocation.getCurrentPosition(
    p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, approx: false }),
    err => (err && err.code === 1 ? resolve(null) : viaIp()), opts);
});
/* ---------- Distance from the person's current location ---------- */
const distText = d => d < 1 ? Math.round(d * 1000) + ' m' : d.toFixed(1) + ' km';
/* Asked once per browser tab (the answer is kept in sessionStorage); resolves to [lat, lng] or null
   when location is blocked or unavailable, in which case no distance is shown. */
let _here = null;
const whereAmI = () => _here || (_here = new Promise(done => {
  try { const c = JSON.parse(sessionStorage.getItem('tunton_here')); if (Array.isArray(c) && c.length === 2) return done(c); } catch { /* ignore */ }
  getPosition({ maximumAge: 300000, timeout: 8000 }).then(pos => {
    if (!pos) return done(null);
    const here = [pos.lat, pos.lng];
    try { sessionStorage.setItem('tunton_here', JSON.stringify(here)); } catch { /* ignore */ }
    done(here);
  });
}));
/* "1.2 km away" for a report, or '' when the location is unknown. */
const awayText = (here, r) => here && isFinite(r.lat) && isFinite(r.lng) ? distText(km(here, [r.lat, r.lng])) + ' away' : '';
const reportState = r => r.kind === 'lost' && confirmedFind(r) ? 'found' : r.kind;
const isOwner = r => !!r.owner && r.owner === myId;
/* Map helpers (only used on pages that load Leaflet) */
/* Locks a Leaflet map to Dagupan City: it cannot be dragged outside the city, and it cannot be
   zoomed out further than the whole city (re-checked whenever the map changes size). */
const lockToDagupan = map => {
  map.setMaxBounds(DAGUPAN_BOUNDS);
  map.options.maxBoundsViscosity = 1;      // 1 = a hard wall, not a rubber band
  const fit = () => { const sz = map.getSize(); if (sz.x && sz.y) map.setMinZoom(map.getBoundsZoom(DAGUPAN_BOUNDS)); };
  fit(); map.on('resize', fit);
};
/* Draws the Dagupan City land boundary on a map (it does NOT restrict the map: people can look anywhere).
   Returns { fit() } which zooms the map to the whole city. */
const CITY_STYLE = { color: '#0f6b3f', weight: 3, opacity: .95, lineJoin: 'round', fillColor: '#2fa05a', fillOpacity: .1, interactive: false };
const highlightDagupan = map => {
  const layer = L.polygon(DAGUPAN_OUTLINE, CITY_STYLE).addTo(map);
  layer.bindTooltip('Dagupan City', { permanent: true, direction: 'center', className: 'city-label' });
  return { fit: () => map.fitBounds(layer.getBounds(), { padding: [24, 24] }) };
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
/* Basemap. TILE_URL_DARK is optional: OpenStreetMap's tiles are light-only and CSS filters would hurt
   readability, so dark tiles need a provider with a dark style (most need an API key and have their own
   attribution/usage terms: check them first). Leave it empty to keep the standard tiles in dark mode. */
/* Tiles come through this server (backend/routes/tiles.js): OpenStreetMap blocks direct browser requests from
   port-forwarding/tunnel addresses with "403 Access blocked". */
const TILE_URL = (window.TUNTON?.API_BASE ?? '/api').replace(/\/api\/?$/, '') + '/tiles/{z}/{x}/{y}.png';
const TILE_URL_DARK = '';
const tileLayers = [];
const tileUrl = () => (TILE_URL_DARK && document.documentElement.dataset.theme === 'dark') ? TILE_URL_DARK : TILE_URL;
const tiles = m => { const t = L.tileLayer(tileUrl(), { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m); tileLayers.push(t); return t; };
window.addEventListener('tunton:themechange', () => tileLayers.forEach(t => t.setUrl(tileUrl())));

/* ---------- Skeleton loading placeholders (styles: css/skeleton.css) ---------- */
const sk = (cls = '') => `<span class="sk ${cls}" aria-hidden="true"></span>`;
const skeletonCards = (n = 6) => Array.from({ length: n }, () => `
  <div class="sk-card" aria-hidden="true">
    ${sk('sk-thumb')}
    <div class="sk-body">${sk('sk-line sk-line--title')}${sk('sk-line sk-line--mid')}${sk('sk-line sk-line--short')}
      <div class="sk-by">${sk('sk-circle')}${sk('sk-line')}</div></div>
    <div class="sk-actions">${sk('sk-btn')}${sk('sk-btn')}</div>
  </div>`).join('');
const skeletonList = (n = 5) => `<ul class="sk-vlist" aria-hidden="true">${Array.from({ length: n }, () => `
  <li class="sk-vcard">${sk('sk-thumb')}<div class="sk-info">${sk('sk-line sk-line--title')}${sk('sk-line sk-line--mid')}${sk('sk-line sk-line--short')}</div></li>`).join('')}</ul>`;
const skeletonDetail = () => `
  <div class="sk-detail" aria-hidden="true">
    <div class="d-top">
      <div>${sk('sk-photo')}<div class="sk-thumbs">${sk()}${sk()}${sk()}</div></div>
      <div class="box">${sk('sk-pill')}${sk('sk-line sk-line--title')}${sk('sk-line sk-line--mid')}${sk('sk-line sk-line--short')}${sk('sk-btn')}</div>
    </div>
    <div class="box">${sk('sk-line sk-line--title')}${sk('sk-line')}${sk('sk-line sk-line--mid')}${sk('sk-line')}</div>
    <div class="box">${sk('sk-line sk-line--title')}${sk('sk-block')}</div>
  </div>
  <span class="sr-only">Loading report…</span>`;
/* Map cover shown until the map's tiles have drawn. */
const mapSkeleton = (wrap, layer) => {
  if (!wrap) return;
  let cover = wrap.querySelector('.map-skel');
  if (!cover) { cover = document.createElement('div'); cover.className = 'map-skel'; cover.innerHTML = '<span>Loading map…</span>'; wrap.appendChild(cover); }
  const done = () => { cover.classList.add('is-done'); setTimeout(() => cover.remove(), 350); };
  const stop = setTimeout(done, 8000);   // never leave the cover up if tiles are blocked or offline
  layer.once('load', () => { clearTimeout(stop); done(); });
};

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

/* Admins only use the admin dashboard: any user page they open sends them straight there.
   The role is read from the signed token (not from the editable copy in localStorage). */
const ADMIN_DASHBOARD = '../../admin/dashboard.html';
const tokenRole = () => {
  try { return JSON.parse(atob(sess.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { return null; }
};
if (sess && tokenRole() === 'admin') location.replace(ADMIN_DASHBOARD);

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

/* ---------- Reports from the database ---------- */
const REPORT_SIZES = { small: 'Small', medium: 'Medium', large: 'Large', extra_large: 'Extra large' };
const REPORT_ORIGIN = API_BASE.replace(/\/api\/?$/, '');                        // '' when the API is on the same origin
const reportAsset = u => (u && u.startsWith('/') ? REPORT_ORIGIN + u : u || '');   // photos come back as /uploads/reports/...
/* One API report -> the object the pages use. The server sends the report's phone, Facebook link and the
   poster's email, which are joined into `contact` (phone first) and split again by splitContact() for the contact card.
   The owner's first name and picture come from the API too (owner_name, owner_picture). */
const toReport = row => {
  const photos = (row.photos || []).map(p => reportAsset(p.url));
  const colors = (row.colors || []).map(c => c.name);
  return {
    id: String(row.id),
    kind: row.type,
    owner: row.is_mine ? myId : 'user-' + row.user_id,
    ownerName: row.owner_name || '', ownerPicture: reportAsset(row.owner_picture),
    contact: [row.phone, row.owner_email].filter(Boolean).join(', '), facebook: row.facebook_profile_link || '',
    name: row.pet_name === 'Unknown' && row.type === 'found' ? '' : (row.pet_name || ''),   // finders may not know the name
    species: ['Dog', 'Cat'].includes(row.species) ? row.species : 'Other',   // species is free text in the database
    otherSpecies: ['Dog', 'Cat'].includes(row.species) ? '' : (row.species || ''),
    breed: row.breed_unknown ? '' : (row.breed || ''),
    color: colors.join(' and '),
    size: REPORT_SIZES[row.size] || '',
    sex: row.sex || 'unknown',
    markings: row.markings || '',
    description: row.description || '',
    brgy: row.barangay || '',
    lat: Number(row.lat),
    lng: Number(row.lng),
    date: String(row.event_date).slice(0, 10),
    zone: row.search_radius_km ? row.search_radius_km * 1000 : 0,   // metres
    photo: photos[0] || reportAsset(row.primary_photo),
    photos,
    photoIds: (row.photos || []).map(p => p.photo_id),   // needed to remove photos when editing
    status: row.status,
    flags: row.review_flags || [],          // admin flags: report_flagged_fraud and/or report_flagged_ai_generated
    flagReasons: row.flag_reasons || {},    // the admin's reason per flag, only sent to the poster
    created: row.created_at ? Date.parse(row.created_at) : 0
  };
};
/* Admin flag shown to users: a short label, a chip for cards and a banner for the report page. */
const FLAG_LABELS = { report_flagged_fraud: 'Flagged as fraud', report_flagged_ai_generated: 'Flagged as AI-generated' };
const flagsOf = r => ((r && r.flags) || []).filter(f => FLAG_LABELS[f]);   // a report can carry both flags
const flagChipHTML = r => flagsOf(r).map(f => `<span class="flag-chip" title="An admin flagged this report for review">${esc(FLAG_LABELS[f])}</span>`).join(' ');
const flagReasonsHTML = r => !isOwner(r) ? '' : flagsOf(r).filter(f => r.flagReasons && r.flagReasons[f])
  .map(f => `<span class="flag-reason">${esc(FLAG_LABELS[f])}: ${esc(r.flagReasons[f])}</span>`).join('');
const flagBannerHTML = r => !flagsOf(r).length ? '' : `<div class="flag-banner" role="status"><b>${flagsOf(r).map(f => esc(FLAG_LABELS[f])).join(' and ')}</b>
  <span>${isOwner(r) ? 'An admin flagged your report for review.' : 'An admin flagged this report for review. Be careful before sharing personal details.'}</span>
  ${flagReasonsHTML(r)}</div>`;
/* ---------- Claims from the database ----------
   Claims live on the server (/api/claims, /api/reports/:id/claims), never in the browser, so the other
   person sees them. The pages still talk about "finds" (a response to a LOST report, claim_type found_it)
   and "claims" (a response to a FOUND report, claim_type my_pet), so toClaim() turns an API claim into that
   shape: an approved claim is 'confirmed', and contact details are '' unless the server sent them
   (only to the owner of the report and to the claimant). */
const CLAIM_STATUS = { pending: 'pending', approved: 'confirmed', rejected: 'rejected' };
const toClaim = c => {
  const pet = c.pet || {}, ct = c.contact || {}, ids = (c.photos || []).map(p => p.photo_id);
  const known = ['Dog', 'Cat', 'Other'], other = pet.species && !known.includes(pet.species);
  const coord = v => v == null ? NaN : Number(v);
  return {
    id: String(c.id), reportId: String(c.report_id), type: c.type,
    by: c.is_mine ? myId : 'user-' + c.claimant.id,
    founderName: c.claimant.name, ownerName: c.claimant.name,
    status: CLAIM_STATUS[c.status] || c.status, decisionReason: c.decision_reason || '',
    contact: ct.text || [ct.phone, ct.email].filter(Boolean).join(', '), facebook: ct.facebook || '',
    where: c.pet_location || '', brgy: c.barangay || '', date: c.event_date ? String(c.event_date).slice(0, 10) : '',
    lat: coord(c.lat), lng: coord(c.lng), zone: 0,
    markings: c.markings || '', description: c.description || '', howFound: c.description || '',
    name: pet.name || '', species: other ? 'Other' : (pet.species || ''), otherSpecies: other ? pet.species : '',
    breed: pet.breed || '', color: pet.color || '', size: REPORT_SIZES[pet.size] || '',
    photos: (c.photos || []).map(p => reportAsset(p.url)), photoIds: ids,
    at: c.created_at ? Date.parse(c.created_at) : 0
  };
};
/* Where a report keeps its responses: finds on a lost report, claims on a found report. */
const claimKey = r => r.kind === 'lost' ? 'finds' : 'claims';
const claimError = async (res, fallback) => {
  const msg = (await res.json().catch(() => ({}))).message;
  return new Error(msg || fallback);
};
const ClaimsAPI = {
  /* Claims on one report: the owner gets pending + approved with contact details, everyone else approved + their own. */
  async forReport(reportId) {
    const res = await authFetch(`/reports/${encodeURIComponent(reportId)}/claims`);
    if (!res.ok) throw await claimError(res, 'Could not load the responses to this report');
    return ((await res.json()).data?.items || []).map(toClaim);
  },
  /* Every claim I sent, any status. */
  async mine() {
    const res = await authFetch('/claims/mine');
    if (!res.ok) throw await claimError(res, 'Could not load your claims');
    return ((await res.json()).data?.items || []).map(toClaim);
  },
  /* POST /claims (new) or PUT /claims/:id (edit while pending). `fd` is a FormData. */
  async save(fd, claimId) {
    const res = await authFetch(claimId ? `/claims/${encodeURIComponent(claimId)}` : '/claims', { method: claimId ? 'PUT' : 'POST', body: fd });
    if (!res.ok) throw await claimError(res, 'Could not save this. Please try again.');
    return toClaim((await res.json()).data.claim);
  },
  /* Owner of the report only: decision is 'approve' or 'reject'. */
  async decide(claimId, decision, reason) {
    const res = await authFetch(`/claims/${encodeURIComponent(claimId)}/decision`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, reason: reason || undefined })
    });
    if (!res.ok) throw await claimError(res, 'Could not save your decision. Please try again.');
    return toClaim((await res.json()).data.claim);
  }
};
/* Puts the server's claims on the reports so findsOf / claimsOf / myPendingFind / confirmedClaim keep working:
   my own reports get every claim sent to me, other people's reports get only MY claims on them (so the buttons
   say "Edit my ..." or "Marked not a match"). The full list of one report is loaded on its detail page.
   A failure here must not hide the reports, so it is swallowed. */
const attachClaims = async reports => {
  try {
    const mine = await ClaimsAPI.mine(), own = reports.filter(r => r.owner === myId);
    const received = await Promise.all(own.map(r => ClaimsAPI.forReport(r.id).catch(() => [])));
    reports.forEach(r => {
      r[claimKey(r)] = r.owner === myId ? received[own.indexOf(r)] : mine.filter(c => c.reportId === r.id);
    });
  } catch (err) { console.error(err); }
  return reports;
};

/* Fetches every active report (the server pages at 100) and replaces the cache. Never falls back to
   sample data: if the server can't be reached the promise rejects and each page shows its own error. */
const loadReports = async () => {
  const items = [];
  for (let total = Infinity; items.length < total;) {
    const res = await authFetch(`/reports?limit=100&offset=${items.length}`);
    if (!res.ok) throw new Error('Could not load reports');
    const d = (await res.json()).data || {};
    if (!d.items?.length) break;
    items.push(...d.items);
    total = d.total ?? items.length;
  }
  return (_reportCache = await attachClaims(items.map(toReport)));
};
let reportsReady = loadReports();
reportsReady.catch(() => {});   // pages handle the error themselves; this only silences the "unhandled" warning

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
  const logoutDialog = $('#logout-dialog');
  const cancelLogout = $('#cancel-logout');
  const confirmLogout = $('#confirm-logout');
  $('#logout').addEventListener('click', () => {
    if (logoutDialog?.showModal) { logoutDialog.showModal(); cancelLogout?.focus(); }   /* focus the safe choice */
    else if (window.confirm('Are you sure you want to log out of TunTon?')) logout();
  });
  cancelLogout?.addEventListener('click', () => logoutDialog?.close());
  confirmLogout?.addEventListener('click', logout);
  logoutDialog?.addEventListener('click', event => {
    if (event.target === logoutDialog) logoutDialog.close();
  });

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