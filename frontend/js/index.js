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

/* ---------- Hero stacked cards (+ caption, status badge and dots) ---------- */
const stackCards = [...document.querySelectorAll('.stack-card')];
if (stackCards.length > 1) {
  const visual = document.querySelector('.hero-visual');
  const dots = [...document.querySelectorAll('.hero-dot')];
  const statusEl = visual.querySelector('[data-hero-status]');
  const titleEl = visual.querySelector('[data-hero-title]');
  const metaEl = visual.querySelector('[data-hero-meta]');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const n = stackCards.length;
  let front = 0, timer;

  function showFront(i) {
    front = (i + n) % n;
    stackCards.forEach((card, k) => { card.dataset.pos = (k - front + n) % n; });
    const card = stackCards[front];
    visual.dataset.state = card.dataset.state;
    statusEl.textContent = card.dataset.state === 'home' ? 'Reunited' : 'Missing';
    titleEl.textContent = card.dataset.title;
    metaEl.textContent = card.dataset.meta;
    dots.forEach((d, k) => d.setAttribute('aria-current', String(k === front)));
  }
  function startRotation() {
    clearInterval(timer);
    if (!reduceMotion) timer = setInterval(() => showFront(front + 1), 3500);
  }
  dots.forEach((d, k) => d.addEventListener('click', () => { showFront(k); startRotation(); }));
  startRotation();
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

/* Text that changes with the tab: the green panel on the left and the heading above the form */
const AUTH_COPY = {
  login:  { kicker: 'Welcome back to', tag: 'Check on your reports and see new matches.', heading: 'Log in to your account', sub: 'Pick up where you left off.' },
  signup: { kicker: 'Welcome to',      tag: 'Help every lost pet find the way home.',   heading: 'Create your account',   sub: 'It only takes a minute.' }
};

function setTab(name) {
  activeTab = name;
  dialog.querySelectorAll('[data-copy]').forEach(el => { el.textContent = AUTH_COPY[name][el.dataset.copy]; });
  tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
  panels.forEach(p => (p.hidden = p.dataset.panel !== name));
  showMessage('');
}

function openAuth(tab = 'login') {
  setTab(tab);
  closeMenu();
  if (!dialog.open) dialog.showModal();
  renderGoogleButtons();
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

/* Sign up: password strength bar + "passwords match" hint */
const pwInput = signupForm.elements.password;
const pwConfirm = signupForm.elements.confirm;
const pwMeter = document.getElementById('pw-meter');
const pwText = document.getElementById('pw-strength-text');
const PW_LABELS = ['', 'Too short', 'Weak', 'Good', 'Strong'];

function passwordLevel(v) {
  if (!v) return 0;
  if (v.length < 8) return 1;
  const points = (v.length >= 12) + (/[a-z]/.test(v) && /[A-Z]/.test(v)) + /\d/.test(v) + /[^A-Za-z0-9]/.test(v);
  return points <= 1 ? 2 : points === 2 ? 3 : 4;
}
function updatePasswordHints() {
  const level = passwordLevel(pwInput.value);
  pwMeter.dataset.level = level;
  pwText.textContent = PW_LABELS[level];
  pwText.dataset.level = level;
  const a = pwInput.value, b = pwConfirm.value, wrap = pwConfirm.closest('.pw-wrap');
  wrap.classList.toggle('is-match', !!b && a === b);
  wrap.classList.toggle('is-mismatch', !!b && b.length >= a.length && a !== b);
}
pwInput.addEventListener('input', updatePasswordHints);
pwConfirm.addEventListener('input', updatePasswordHints);

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
  googleReady = true;
  dialog.querySelectorAll('.auth-alt').forEach(el => (el.hidden = false));   // Google is an extra option
  if (dialog.open) renderGoogleButtons();
}

/* Google's own button can only say "Sign in with Google" / "Sign up with Google" / "Continue with Google".
   With this on, we draw our own face ("Log in with Google") and lay Google's real button invisibly on top,
   so clicks still go through Google's official flow. Set to false to show Google's button as-is. */
const GOOGLE_CUSTOM_LABEL = true;

/* Same outlined pill on both tabs, as wide as the form (Google allows 200-400px).
   Needs the dialog to be open so the slot has a real width; called from openAuth(). */
function renderGoogleButtons() {
  if (!googleReady) return;
  // Google only offers fixed labels: signin_with = "Sign in with Google", signup_with = "Sign up with Google"
  [['google-login', 'signin_with'], ['google-signup', 'signup_with']].forEach(([id, label]) => {
    const slot = document.getElementById(id);
    slot.closest('.google-btn')?.classList.toggle('google-btn--custom', GOOGLE_CUSTOM_LABEL);
    const w = Math.min(400, Math.max(200, Math.floor(slot.getBoundingClientRect().width) || 360));
    slot.innerHTML = '';
    google.accounts.id.renderButton(slot,
      { theme: 'outline', size: 'large', shape: 'pill', text: label, logo_alignment: 'left', width: w });
  });
}

/* ---------- Events ---------- */
document.querySelectorAll('[data-open-auth]').forEach(btn =>
  btn.addEventListener('click', () => openAuth(btn.dataset.openAuth)));

tabs.forEach(t => t.addEventListener('click', () => setTab(t.dataset.tab)));
dialog.addEventListener('click', e => {
  const link = e.target.closest('[data-switch-tab]'); if (!link) return;
  setTab(link.dataset.switchTab);
  dialog.querySelector(`[data-panel="${link.dataset.switchTab}"] input`)?.focus();
});
document.getElementById('auth-close').addEventListener('click', closeAuth);
dialog.addEventListener('click', e => { if (e.target === dialog) closeAuth(); });
document.getElementById('logout-btn').addEventListener('click', logout);

/* Buttons that need an account (report lost / found pet) */
document.querySelectorAll('[data-requires-auth]').forEach(btn =>
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    if (getSession()) {
      if (btn.dataset.href) location.href = btn.dataset.href;      // hero buttons open the report form
      else document.querySelector(target)?.scrollIntoView({ behavior: 'smooth' });
    } else {
      pendingTarget = target;
      openAuth('login');
      showMessage('Please log in or sign up to file a report.');
    }
  }));

/* =========================================================
   Reports shown on the home page
   Only reports that exist in the database are shown (GET /api/reports). There is no sample data.
   The API needs a login, so a visitor who is not signed in sees a prompt instead of reports.
   ========================================================= */
const PET_LIMIT = 6;
let petFilter = 'all';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const niceDate = d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const speciesOf = r => (r.species === 'Other' && r.otherSpecies) ? r.otherSpecies : (r.species || '');
const petTitle = r => r.name || [r.color, speciesOf(r)].filter(Boolean).join(' ') || 'Pet';
const byNewest = (a, b) => new Date(b.date) - new Date(a.date) || (b.created || 0) - (a.created || 0);
/* One API report -> the small object the home page cards use. */
const REPORT_ORIGIN = API.replace(/\/api\/?$/, '');
const homeReport = row => ({
  id: String(row.id), kind: row.type, name: row.pet_name || '', species: row.species,
  breed: row.breed_unknown ? '' : (row.breed || ''), color: (row.colors || []).map(c => c.name).join(' and '),
  brgy: row.barangay || '', date: String(row.event_date).slice(0, 10), status: row.status,
  photo: row.primary_photo ? (row.primary_photo.startsWith('/') ? REPORT_ORIGIN + row.primary_photo : row.primary_photo) : '',
  created: row.created_at ? Date.parse(row.created_at) : 0
});
let homeReports = [], homeRecovered = [], homeState = 'loading';   // 'loading' | 'ready' | 'login' | 'error'
async function loadReports() {
  const session = getSession();
  if (!session) { homeState = 'login'; return; }
  const get = async q => {
    const res = await fetch(`${API}/reports?${q}`, { headers: { Authorization: 'Bearer ' + session.token } });
    if (!res.ok) throw new Error('Could not load reports');
    return ((await res.json()).data?.items || []).map(homeReport);
  };
  try {
    [homeReports, homeRecovered] = await Promise.all([get('status=active&limit=100'), get('status=resolved&limit=3')]);
    homeState = 'ready';
  } catch (err) { console.error(err); homeState = 'error'; }
}
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
  const petsEl = document.getElementById('pets-list'), homeEl = document.getElementById('recovered-list');
  const note = text => `<p class="pet-empty">${esc(text)}</p>`;
  if (homeState !== 'ready') {
    const text = homeState === 'login' ? 'Log in to see the latest lost and found reports.' : homeState === 'error' ? 'Could not load reports. Please try again later.' : 'Loading reports…';
    petsEl.innerHTML = note(text);
    homeEl.innerHTML = '';
    return;
  }

  /* Lost & found pets: active reports, newest first */
  const active = homeReports.filter(r => petFilter === 'all' || stateOf(r) === petFilter).sort(byNewest);
  const shown = active.slice(0, PET_LIMIT);
  petsEl.innerHTML = shown.length
    ? shown.map(petCard).join('')
    : note(`No ${petFilter === 'all' ? '' : petFilter + ' '}pet reports yet. Be the first to file one.`);

  /* Recovered pets: resolved reports from the database only */
  homeEl.innerHTML = homeRecovered.length ? homeRecovered.sort(byNewest).map(recoveredCard).join('') : note('No reunited pets yet.');
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

renderReports();   // placeholder text until the database answers
loadReports().then(renderReports);

renderSession();
/* The Google script is async: wait for it, then set up the buttons. */
window.addEventListener('load', initGoogle);