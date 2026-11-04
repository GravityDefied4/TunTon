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

[loginForm, signupForm].forEach(form => {
  form.addEventListener('input', event => {
    if (event.target.matches('input')) clearFieldError(event.target);
  });
});

/* Returns the first problem found (and marks that field), or '' when the form is fine. */
function clearFieldError(input) {
  if (!input) return;
  input.removeAttribute('aria-invalid');
  const field = input.closest('.field');
  const error = field?.querySelector('.field-error');
  if (error) error.textContent = '';
}

function showFieldError(input, message) {
  if (!input) return;
  const field = input.closest('.field');
  if (!field) return;
  let error = field.querySelector('.field-error');
  if (!error) {
    error = document.createElement('small');
    error.className = 'field-error';
    error.setAttribute('role', 'alert');
    field.appendChild(error);
  }
  error.textContent = message;
  input.setAttribute('aria-invalid', 'true');
}

function validate(form, rules) {
  form.querySelectorAll('input').forEach(clearFieldError);
  for (const [name, bad] of rules) {
    const input = form.elements[name], msg = bad(input.value.trim(), input.value);
    if (msg) {
      showFieldError(input, msg);
      input.focus();
      return msg;
    }
  }
  return '';
}

async function submitForm(form, path, rules, payload, busy) {
  const problem = validate(form, rules);
  if (problem) { showMessage(''); return; }
  const btn = form.querySelector('.auth-submit'), label = btn.textContent;
  btn.disabled = true; btn.textContent = busy; showMessage('');
  const body = await postAuth(path, payload());
  btn.disabled = false; btn.textContent = label;
  if (body) { showMessage(''); finishLogin(body); }
}

loginForm.addEventListener('submit', e => {
  e.preventDefault();
  submitForm(loginForm, 'login', [
    ['email', v => !v ? 'Enter your email address.' : !EMAIL_RE.test(v) ? 'Enter a valid email address.' : ''],
    ['password', (v, raw) => !raw ? 'Enter your password.' : '']
  ], () => ({ email: loginForm.elements.email.value.trim().toLowerCase(), password: loginForm.elements.password.value }), 'Logging in...');
});

signupForm.addEventListener('submit', e => {
  e.preventDefault();
  const f = signupForm.elements;
  submitForm(signupForm, 'register', [
    ['name', v => v.length < 2 ? 'Enter your name.' : ''],
    ['email', v => !v ? 'Enter your email address.' : !EMAIL_RE.test(v) ? 'Enter a valid email address.' : ''],
    ['password', (v, raw) => raw.length < 8 ? 'Use at least 8 characters.' : ''],
    ['confirm', (v, raw) => raw !== f.password.value ? 'Passwords do not match.' : '']
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
   Only reports that exist in the database are shown (GET /api/reports/public, no login needed). There is no sample data.
   Visitors see a safe preview; full details still need an account.
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
  created: row.created_at ? Date.parse(row.created_at) : 0,
  story: row.recovery_story || row.story || row.resolution_notes || row.description || ''
});
let homeReports = [], homeRecovered = [], homeState = 'loading';   // 'loading' | 'ready' | 'error'
async function loadReports() {
  /* Public preview endpoint: works for visitors and logged-in users alike (no contact details or exact pins). */
  const get = async q => {
    const res = await fetch(`${API}/reports/public?${q}`);
    if (!res.ok) throw new Error('Could not load reports');
    return ((await res.json()).data?.items || []).map(homeReport);
  };
  try {
    [homeReports, homeRecovered] = await Promise.all([get('status=active&limit=30'), get('status=resolved&limit=3')]);
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

function recoveredCard(r, index) {
  const title = petTitle(r);
  const story = r.story || `After ${title} was reported missing, the details in the report helped the community keep an eye out. A neighbor recognized the pet and shared the sighting with the person who filed the report. The owner was able to confirm the match, arrange a safe handover, and bring ${title} home.`;
  recoveryStories[index] = { ...r, title, story };
  return `
  <article class="pet-card recovered-card">
    <div class="pet-thumb"><img src="${esc(r.photo)}" alt="${esc(title)}, safely reunited" loading="lazy"></div>
    <div class="pet-body">
      <span class="badge badge--home">&#10003; Reunited</span>
      <h3>${esc(title)}</h3>
      <p class="pet-meta">${esc(r.brgy || 'Dagupan City')} &middot; <time datetime="${esc(r.date)}">${esc(niceDate(r.date))}</time></p>
      <p class="pet-story">${esc(story.length > 150 ? story.slice(0, 147) + '…' : story)}</p>
    </div>
    <button type="button" class="btn btn-small" data-recovery-story="${index}">View details</button>
  </article>`;
}

/* Illustrative examples appear until real resolved reports are available. */
const sampleRecoveries = [
  { id:'sample-mocha', kind:'lost', name:'Mocha', species:'Dog', breed:'Beagle', color:'Brown and white', brgy:'Bonuan Gueset', date:'2026-10-18', photo:'assets/img/Pet2.jpg', sample:true,
    story:'Mocha slipped out through an open gate while the family was bringing groceries inside. His family posted a lost-pet report with his photo and distinctive brown-and-white coat. The next morning, a resident near the neighborhood market spotted a dog matching the description and contacted the family through the report. They checked Mocha’s markings together before bringing him home. After a quick check for injuries, Mocha was back with his favorite people.' },
  { id:'sample-miming', kind:'found', name:'Miming', species:'Cat', breed:'Domestic shorthair', color:'Gray tabby', brgy:'Tapuac', date:'2026-10-12', photo:'assets/img/Pet3.jpg', sample:true,
    story:'A gray tabby began staying near a small store in Tapuac. The finder shared a found-pet report instead of assuming the cat was a stray. A family searching for their indoor cat recognized the markings and reached out. They confirmed the cat’s identity with familiar photos and details, then safely reunited. The finder kept the cat sheltered and provided water while the family made their way over.' },
  { id:'sample-brownie', kind:'lost', name:'Brownie', species:'Dog', breed:'Mixed breed', color:'Light brown', brgy:'Pantal', date:'2026-10-06', photo:'assets/img/Pet1.jpg', sample:true,
    story:'Brownie was frightened by a loud noise and wandered farther than usual. His owner posted a report with his approximate last-seen area and a clear photo. Community members shared the alert with nearby residents, and someone recognized Brownie resting outside a neighborhood home. The owner verified his collar and unique markings before taking him home. The family thanked everyone who shared the report and helped keep Brownie safe.' }
];
let recoveryStories = [];

function renderReports() {
  const petsEl = document.getElementById('pets-list'), homeEl = document.getElementById('recovered-list');
  const note = text => `<p class="pet-empty">${esc(text)}</p>`;
  if (homeState !== 'ready') {
    const text = homeState === 'error' ? 'Could not load reports. Please try again later.' : 'Loading reports…';
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
  recoveryStories = [];
  const recovered = homeRecovered.slice().sort(byNewest);
  homeEl.innerHTML = recovered.length
    ? recovered.map((r, i) => recoveredCard(r, i)).join('')
    : sampleRecoveries.map((r, i) => recoveredCard(r, i)).join('');
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
const recoveryDialog = document.getElementById('recovery-dialog');
function openRecoveryStory(entry) {
  if (!entry) return;
  const story = entry.story || 'This pet has been safely reunited with its family.';
  const sentences = story.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [story];
  const paragraphs = [];
  for (let i = 0; i < sentences.length; i += 2) paragraphs.push(sentences.slice(i, i + 2).join(' ').trim());
  const photo = document.getElementById('recovery-photo');
  photo.src = entry.photo || '';
  photo.alt = `${entry.title}, safely reunited with its family`;
  document.getElementById('recovery-title').textContent = `${entry.title} is home again`;
  document.getElementById('recovery-location').textContent = `${entry.brgy || 'Dagupan City'}${entry.sample ? ' · Illustrative story' : ' · Dagupan City'}`;
  document.getElementById('recovery-date').textContent = entry.date ? `Reunited ${niceDate(entry.date)}` : 'A community recovery story';
  document.getElementById('recovery-dek').textContent = `${entry.name || entry.title}’s journey home is a reminder that a little attention and a helping hand can bring a family back together.`;
  document.getElementById('recovery-readtime').textContent = `${Math.max(1, Math.ceil(story.split(/\s+/).length / 180))} min read`;
  const storyEl = document.getElementById('recovery-story');
  storyEl.replaceChildren(...paragraphs.map((paragraph, index) => {
    const p = document.createElement('p');
    if (index === 0) p.className = 'recovery-story__lead';
    p.textContent = paragraph;
    return p;
  }));
  recoveryDialog.showModal();
}
document.getElementById('recovered').addEventListener('click', e => {
  const b = e.target.closest('[data-recovery-story]');
  if (b) openRecoveryStory(recoveryStories[Number(b.dataset.recoveryStory)]);
});
document.querySelectorAll('[data-close-recovery]').forEach(b => b.addEventListener('click', () => recoveryDialog.close()));
recoveryDialog.addEventListener('click', e => { if (e.target === recoveryDialog) recoveryDialog.close(); });
document.querySelectorAll('[data-browse-all]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); requireLoginFor(null); }));

renderReports();   // placeholder text until the database answers
loadReports().then(renderReports);

renderSession();
/* The Google script is async: wait for it, then set up the buttons. */
window.addEventListener('load', initGoogle);