/* =========================================================
   TunTon: UI + Google Sign-In (Google Identity Services)
   ========================================================= */

// The Google client ID lives in the server's .env (GOOGLE_CLIENT_ID) and is fetched from /api/auth/config.
const API = window.TUNTON?.API_BASE ?? '/api';
const SESSION_KEY = 'tunton_session';
const DASHBOARD = './pages/user/user.html';
const REPORT_PAGE = './pages/user/dashboard/report.html?id=';

/* ---------- Mobile menu ---------- */
const toggle = document.querySelector('.nav-toggle');
const menu = document.getElementById('menu');

toggle.addEventListener('click', () => {
  const open = menu.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open);
});
const closeMenu = () => {
  menu.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
};
menu.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));

/* ---------- Header shadow + active section ---------- */
const header = document.getElementById('header');
const updateHeader = () => header.classList.toggle('scrolled', window.scrollY > 10);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

const links = menu.querySelectorAll(':scope > a[href^="#"]');
const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + entry.target.id));
    }
  });
}, { rootMargin: '-45% 0px -50% 0px' });
document.querySelectorAll('main section[id]').forEach(s => observer.observe(s));

document.getElementById('year').textContent = new Date().getFullYear();

/* ---------- Hero stacked cards ---------- */
const stackCards = [...document.querySelectorAll('.stack-card')];
if (stackCards.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  let front = 0;
  setInterval(() => {
    front = (front + 1) % stackCards.length;
    stackCards.forEach((card, i) => {
      card.dataset.pos = (i - front + stackCards.length) % stackCards.length;
    });
  }, 3500);
}

/* =========================================================
   Authentication (TunTon API)
   Email + password:  POST /api/auth/login     { email, password }
                      POST /api/auth/register  { name, email, password }
   Google (optional): Google button -> ID token -> POST /api/auth/google
   Every endpoint answers { success, message, data: { token, user } } and the server returns TunTon's own JWT.
   ========================================================= */
const dialog = document.getElementById('auth-dialog');
const authMsg = document.getElementById('auth-message');
const tabs = dialog.querySelectorAll('.tab');
const panels = dialog.querySelectorAll('.tab-panel');
const authOut = document.querySelector('.auth-out');
const authIn = document.querySelector('.auth-in');

let activeTab = 'login';
let pendingTarget = null; // where to scroll after login
let pendingReport = null; // report id the visitor wanted to open before logging in
let googleReady = false;

const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

/* The stored session is only trusted until the JWT's own expiry. */
function getSession() {
  const s = read(SESSION_KEY, null);
  if (!s?.token) return null;
  try {
    const { exp } = JSON.parse(atob(s.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (exp * 1000 < Date.now()) throw new Error('expired');
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
  return s;
}

function showMessage(text, isError = false) {
  authMsg.textContent = text;
  authMsg.classList.toggle('error', isError);
}

function setTab(name) {
  activeTab = name;
  tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
  panels.forEach(p => (p.hidden = p.dataset.panel !== name));
  showMessage('');
}

function openAuth(tab = 'login') {
  setTab(tab);
  closeMenu();
  if (!dialog.open) dialog.showModal();
  setTimeout(() => dialog.querySelector(`[data-panel="${tab}"] input`)?.focus(), 0);
}

function closeAuth() { if (dialog.open) dialog.close(); }

/* Update the navigation for the current session */
function renderSession() {
  const user = getSession();
  authOut.hidden = !!user;
  authIn.hidden = !user;
  if (user) {
    document.getElementById('user-name').textContent = user.given_name || user.name || user.email;
    const avatar = document.getElementById('user-avatar');
    avatar.hidden = !user.picture;   // accounts made with an email have no picture
    avatar.src = user.picture || '';
    avatar.alt = user.name || '';
  }
}

/* Save the session and open the dashboard (or the report they clicked). `replace` = Back won't return here. */
function finishLogin(body) {
  const { token, user } = body.data;
  /* `sub` is TunTon's own user id (the dashboard uses it to tell whose reports are whose). */
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, sub: user.id, ...user }));
  location.replace(pendingReport ? REPORT_PAGE + encodeURIComponent(pendingReport) : DASHBOARD);
}

/* POST to an auth endpoint. Returns the response body when it worked, otherwise shows the error and returns null. */
async function postAuth(path, payload) {
  let res, body;
  try {
    res = await fetch(`${API}/auth/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    body = await res.json();
  } catch {
    showMessage('Could not reach the TunTon server. Please try again.', true);
    return null;
  }
  if (!res.ok || !body.success) {
    if (body?.data?.code === 'NO_ACCOUNT') setTab('signup');
    showMessage(body?.message || 'Something went wrong. Please try again.', true);
    return null;
  }
  return body;
}

/* Called by Google after the user picks an account */
async function handleCredential(response) {
  showMessage('Signing you in...');
  const body = await postAuth('google', { credential: response.credential, mode: activeTab });
  if (body) finishLogin(body);
}

/* ---------- Email + password forms ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');

/* Returns the first problem found (and marks that field), or '' when the form is fine. */
function validate(form, rules) {
  form.querySelectorAll('input').forEach(i => i.removeAttribute('aria-invalid'));
  for (const [name, bad] of rules) {
    const input = form.elements[name], msg = bad(input.value.trim(), input.value);
    if (msg) { input.setAttribute('aria-invalid', 'true'); input.focus(); return msg; }
  }
  return '';
}

async function submitForm(form, path, rules, payload, busy) {
  const problem = validate(form, rules);
  if (problem) return showMessage(problem, true);
  const btn = form.querySelector('.auth-submit'), label = btn.textContent;
  btn.disabled = true; btn.textContent = busy; showMessage('');
  const body = await postAuth(path, payload());
  btn.disabled = false; btn.textContent = label;
  if (body) { showMessage(''); finishLogin(body); }
}

loginForm.addEventListener('submit', e => {
  e.preventDefault();
  submitForm(loginForm, 'login', [
    ['email', v => !v ? 'Please enter your email address.' : !EMAIL_RE.test(v) ? 'That email address does not look right.' : ''],
    ['password', (v, raw) => !raw ? 'Please enter your password.' : '']
  ], () => ({ email: loginForm.elements.email.value.trim().toLowerCase(), password: loginForm.elements.password.value }), 'Logging in...');
});

signupForm.addEventListener('submit', e => {
  e.preventDefault();
  const f = signupForm.elements;
  submitForm(signupForm, 'register', [
    ['name', v => v.length < 2 ? 'Please enter your full name.' : ''],
    ['email', v => !v ? 'Please enter your email address.' : !EMAIL_RE.test(v) ? 'That email address does not look right.' : ''],
    ['password', (v, raw) => raw.length < 8 ? 'Your password needs at least 8 characters.' : ''],
    ['confirm', (v, raw) => raw !== f.password.value ? 'The two passwords do not match.' : '']
  ], () => ({ name: f.name.value.trim(), email: f.email.value.trim().toLowerCase(), password: f.password.value }), 'Creating account...');
});

/* Show / hide password */
dialog.addEventListener('click', e => {
  const t = e.target.closest('[data-toggle-pw]'); if (!t) return;
  const input = document.getElementById(t.dataset.togglePw), show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  t.setAttribute('aria-pressed', show);
  t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
});

function logout() {
  localStorage.removeItem(SESSION_KEY);
  if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
  renderSession();
}

/* Render the official Google buttons once we know the client ID */
async function initGoogle() {
  let clientId;
  try {
    const res = await fetch(`${API}/auth/config`);
    clientId = (await res.json()).data?.googleClientId;
  } catch { return; }
  if (!clientId || clientId.startsWith('YOUR_') || !window.google?.accounts?.id) return;

  google.accounts.id.initialize({ client_id: clientId, callback: handleCredential });
  google.accounts.id.renderButton(document.getElementById('google-login'),
    { theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280 });
  google.accounts.id.renderButton(document.getElementById('google-signup'),
    { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signup_with', width: 280 });
  googleReady = true;
  dialog.querySelectorAll('.auth-alt').forEach(el => (el.hidden = false));   // Google is an extra option
}

/* ---------- Events ---------- */
document.querySelectorAll('[data-open-auth]').forEach(btn =>
  btn.addEventListener('click', () => openAuth(btn.dataset.openAuth)));

tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
document.getElementById('auth-close').addEventListener('click', closeAuth);
dialog.addEventListener('click', e => { if (e.target === dialog) closeAuth(); });
document.getElementById('logout-btn').addEventListener('click', logout);

/* Buttons that need an account (report lost / found pet) */
document.querySelectorAll('[data-requires-auth]').forEach(btn =>
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    if (getSession()) {
      document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      pendingTarget = target;
      openAuth('login');
      showMessage('Please log in or sign up to file a report.');
    }
  }));

/* =========================================================
   Reports shown on the home page
   Reads the same data the dashboard uses (sample reports + the
   reports saved in this browser). When the backend exists, swap
   loadReports() for a fetch of GET /api/reports.
   ========================================================= */
const REPORTS_KEY = 'tunton_reports';
const IMG = 'assets/img/';
const SAMPLES = [  /* keep in sync with SAMPLES in pages/user/dashboard/js/common.js */
  { id: 's1', kind: 'lost', name: 'White and brown dog', species: 'Dog', color: 'White and brown', brgy: 'Pantal', date: '2026-10-06', photo: IMG + 'Pet1.jpg' },
  { id: 's2', kind: 'lost', name: 'Tilapia cat', species: 'Cat', color: 'Grey', brgy: 'Lucao', date: '2026-10-05', photo: IMG + 'Pet3.jpg' },
  { id: 's3', kind: 'lost', name: 'Tabby cat', species: 'Cat', color: 'Tabby', brgy: 'Tapuac', date: '2026-10-03', photo: IMG + 'Pet4.jpg' }
];
/* Sample happy endings, shown only until real "reunited" reports exist */
const RECOVERED_SAMPLES = [
  { name: 'Mocha the beagle', brgy: 'Bonuan', date: '2026-10-06', photo: IMG + 'Pet2.jpg', story: 'Found by a neighbor and back home within a day.' },
  { name: 'Black cat with white paws', brgy: 'Tapuac', date: '2026-10-04', photo: IMG + 'Pet4.jpg', story: 'Matched by color and markings, claimed the same day.' },
  { name: 'Brown dog with collar', brgy: 'Mayombo', date: '2026-10-01', photo: IMG + 'Pet1.jpg', story: 'Its collar tag helped the finder reach the owner.' }
];
const PET_LIMIT = 6;
let petFilter = 'all';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const niceDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const speciesOf = r => (r.species === 'Other' && r.otherSpecies) ? r.otherSpecies : (r.species || '');
const petTitle = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const byNewest = (a, b) => new Date(b.date) - new Date(a.date) || (b.created || 0) - (a.created || 0);
const loadReports = () => { const saved = read(REPORTS_KEY, []), ids = new Set(saved.map(r => r.id)); return SAMPLES.filter(s => !ids.has(s.id)).concat(saved); };
/* A lost report that someone has found shows as "found" (same report, not a new one), but only after its owner confirms a find. */
const stateOf = r => r.kind === 'lost' && Array.isArray(r.finds) && r.finds.some(f => f.status === 'confirmed') ? 'found' : r.kind;

function petCard(r) {
  const lost = r.kind === 'lost', isFound = stateOf(r) === 'found', verb = lost ? 'Last seen' : 'Found', title = petTitle(r);
  return `
  <article class="pet-card">
    <div class="pet-thumb">
      <img src="${esc(r.photo)}" alt="${isFound ? 'Found' : 'Missing'} ${esc(title)}" loading="lazy">
      <span class="tag-missing${isFound ? ' tag-found' : ''}"><span class="tag-dot" aria-hidden="true"></span>${isFound ? 'Found' : 'Missing'}</span>
    </div>
    <div class="pet-body">
      <h3>${esc(title)}</h3>
      <ul class="pet-info">
        ${[r.species, r.color].filter(Boolean).length ? `<li><span aria-hidden="true">🐾</span> ${esc([speciesOf(r), r.breed, r.color].filter(Boolean).join(' · '))}</li>` : ''}
        <li><span aria-hidden="true">📍</span> ${verb} in ${esc(r.brgy)}</li>
        <li><span aria-hidden="true">🗓️</span> <time datetime="${esc(r.date)}">${esc(niceDate(r.date))}</time></li>
      </ul>
    </div>
    <button type="button" class="btn btn-small" data-view="${esc(r.id)}">View details</button>
  </article>`;
}

function recoveredCard(r) {
  const title = petTitle(r);
  return `
  <article class="pet-card">
    <div class="pet-thumb"><img src="${esc(r.photo)}" alt="${esc(title)}, reunited" loading="lazy"></div>
    <div class="pet-body">
      <span class="badge badge--home">&#10003; Reunited</span>
      <h3>${esc(title)}</h3>
      <p class="pet-meta">${esc(r.brgy)} &middot; <time datetime="${esc(r.date)}">${esc(niceDate(r.date))}</time></p>
      <p class="pet-story">${esc(r.story || 'Back home safe, thanks to the community.')}</p>
    </div>
    ${r.id ? `<button type="button" class="btn btn-small" data-view="${esc(r.id)}">Read story</button>` : ''}
  </article>`;
}

function renderReports() {
  const all = loadReports();

  /* Lost & found pets: active reports, newest first */
  const active = all.filter(r => r.status !== 'reunited' && (petFilter === 'all' || stateOf(r) === petFilter)).sort(byNewest);
  const shown = active.slice(0, PET_LIMIT);
  document.getElementById('pets-list').innerHTML = shown.length
    ? shown.map(petCard).join('')
    : `<p class="pet-empty">No ${petFilter === 'all' ? '' : petFilter + ' '}pet reports yet. Be the first to file one.</p>`;

  /* Recovered pets: real "reunited" reports, topped up with samples */
  const home = all.filter(r => r.status === 'reunited').sort(byNewest).slice(0, 3);
  const fill = RECOVERED_SAMPLES.slice(0, Math.max(0, 3 - home.length));
  document.getElementById('recovered-list').innerHTML = home.concat(fill).map(recoveredCard).join('');
}

/* Full details need an account: ask visitors to log in, then take them to that report. */
function requireLoginFor(id) {
  pendingReport = id || null;
  openAuth('login');
  showMessage(id ? 'Please log in or sign up to see the full details of this report.' : 'Please log in or sign up to browse all reports.');
}

document.querySelector('.pet-list#pets-list').closest('section').addEventListener('click', e => {
  const f = e.target.closest('[data-filter]');
  if (f) {
    petFilter = f.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b => b.setAttribute('aria-pressed', String(b === f)));
    renderReports();
  }
});
document.getElementById('pets').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) requireLoginFor(b.dataset.view); });
document.getElementById('recovered').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) requireLoginFor(b.dataset.view); });
document.querySelectorAll('[data-browse-all]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); requireLoginFor(null); }));

renderReports();

renderSession();
/* The Google script is async: wait for it, then set up the buttons. */
window.addEventListener('load', initGoogle);