/* =========================================================
   TunTon: UI + Google Sign-In (Google Identity Services)
   ========================================================= */

// The Google client ID lives in the server's .env (GOOGLE_CLIENT_ID) and is fetched from /api/auth/config.
const API = window.TUNTON?.API_BASE ?? '/api';
const SESSION_KEY = 'tunton_session';
const DASHBOARD = './pages/user/user.html';

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
   Authentication (Google Identity Services + TunTon API)
   Flow: Google button -> ID token -> POST /api/auth/google
         -> server verifies it and returns TunTon's own JWT.
   ========================================================= */
const dialog = document.getElementById('auth-dialog');
const authMsg = document.getElementById('auth-message');
const tabs = dialog.querySelectorAll('.tab');
const panels = dialog.querySelectorAll('.tab-panel');
const authOut = document.querySelector('.auth-out');
const authIn = document.querySelector('.auth-in');

let activeTab = 'login';
let pendingTarget = null; // where to scroll after login
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
  if (!googleReady) showMessage('Sign-in is not available right now. Please try again later.', true);
}

function closeAuth() { if (dialog.open) dialog.close(); }

/* Update the navigation for the current session */
function renderSession() {
  const user = getSession();
  authOut.hidden = !!user;
  authIn.hidden = !user;
  if (user) {
    document.getElementById('user-name').textContent = user.given_name || user.name;
    const avatar = document.getElementById('user-avatar');
    avatar.src = user.picture || '';
    avatar.alt = user.name;
  }
}

/* Called by Google after the user picks an account */
async function handleCredential(response) {
  showMessage('Signing you in...');
  let res, body;
  try {
    res = await fetch(`${API}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential, mode: activeTab })
    });
    body = await res.json();
  } catch {
    showMessage('Could not reach the TunTon server. Please try again.', true);
    return;
  }

  if (!res.ok || !body.success) {
    if (body?.data?.code === 'NO_ACCOUNT') setTab('signup');
    showMessage(body?.message || 'Sign-in failed. Please try again.', true);
    return;
  }

  const { token, user } = body.data;
  /* `sub` is TunTon's own user id (the dashboard uses it to tell whose reports are whose). */
  localStorage.setItem(SESSION_KEY, JSON.stringify({ token, sub: user.id, ...user }));

  /* Always go to the dashboard after login or sign up (replace = Back won't return here). */
  location.replace(DASHBOARD);
}

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
  if (dialog.open && authMsg.classList.contains('error')) showMessage('');
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
      if (googleReady) showMessage('Please log in or sign up to file a report.');
    }
  }));

renderSession();
/* The Google script is async: wait for it, then set up the buttons. */
window.addEventListener('load', initGoogle);